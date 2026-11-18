/**
 * Persistence: everything lives in the app's private document folder (never the
 * camera roll, never the network). Photos are JPEG files; metadata is JSON.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { LINE_PALETTE, LINE_STYLES, LINE_WIDTHS, STAR_LABELS } from '@/constants/style';

import { FAN_LINE_COUNT, fanAngle } from './geometry';
import { clipRay } from './projection';
import {
  OVERLAY_WIDTH,
  type DrawnLine,
  type Guide,
  type Overlay,
  type Perspective,
  type PhotoEntry,
  type SavedStar,
  type Settings,
} from './types';

const ROOT = 'vanishing-point';
const SETTINGS_FILE = 'settings.json';
const PHOTOS_FILE = 'photos.json';

export const DEFAULT_SETTINGS: Settings = {
  perspective: 1,
  lineWidth: LINE_WIDTHS[1].value,
  lineStyle: 'solid',
  lineColor: LINE_PALETTE[0],
};

function rootDir() {
  return new Directory(Paths.document, ROOT);
}

function photosDir() {
  return new Directory(Paths.document, ROOT, 'photos');
}

function ensureDirs() {
  const root = rootDir();
  if (!root.exists) root.create({ intermediates: true, idempotent: true });
  const photos = photosDir();
  if (!photos.exists) photos.create({ intermediates: true, idempotent: true });
}

async function readJson(name: string): Promise<unknown> {
  const file = new File(rootDir(), name);
  if (!file.exists) return undefined;
  const text = await file.text();
  return JSON.parse(text);
}

// Writes are chained so two quick saves can never interleave.
let writeQueue: Promise<void> = Promise.resolve();

function writeJson(name: string, data: unknown): Promise<void> {
  const run = async () => {
    ensureDirs();
    const content = JSON.stringify(data);
    const tmp = new File(rootDir(), `${name}.tmp`);
    if (tmp.exists) tmp.delete();
    tmp.create();
    await tmp.write(content);
    const target = new File(rootDir(), name);
    if (target.exists) target.delete();
    tmp.moveSync(target);
  };
  const next = writeQueue.then(run, run);
  writeQueue = next.catch(() => undefined);
  return next;
}

// ---------- validation (never trust what's on disk) ----------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function isPerspective(v: unknown): v is Perspective {
  return v === 1 || v === 2 || v === 3;
}

function parseSettings(raw: unknown): Settings {
  if (!isObj(raw)) return DEFAULT_SETTINGS;
  return {
    perspective: isPerspective(raw.perspective) ? raw.perspective : DEFAULT_SETTINGS.perspective,
    lineWidth:
      isNum(raw.lineWidth) && raw.lineWidth > 0 && raw.lineWidth <= 100
        ? raw.lineWidth
        : DEFAULT_SETTINGS.lineWidth,
    lineStyle: (LINE_STYLES as readonly unknown[]).includes(raw.lineStyle)
      ? (raw.lineStyle as Settings['lineStyle'])
      : DEFAULT_SETTINGS.lineStyle,
    lineColor:
      isStr(raw.lineColor) && /^#[0-9a-fA-F]{6}$/.test(raw.lineColor)
        ? raw.lineColor
        : DEFAULT_SETTINGS.lineColor,
  };
}

function parseGuide(raw: unknown): Guide | null {
  if (!isObj(raw)) return null;
  const { x1, y1, x2, y2, color, width, opacity } = raw;
  if (!isNum(x1) || !isNum(y1) || !isNum(x2) || !isNum(y2) || !isNum(width) || !isNum(opacity)) return null;
  if (!isStr(color)) return null;
  return { x1, y1, x2, y2, color, width, opacity };
}

/** Photos saved by the first version stored a fan angle per star; rebuild its guide lines. */
function legacyFan(star: Record<string, unknown>, color: string, rect: { w: number; h: number }): Guide[] {
  if (!isNum(star.angle) || !isNum(star.x) || !isNum(star.y)) return [];
  const sel = isNum(star.selectedLine) ? star.selectedLine : null;
  const guides: Guide[] = [];
  for (let i = 0; i < FAN_LINE_COUNT; i++) {
    const a = fanAngle(star.angle, i);
    const seg = clipRay({ x: star.x, y: star.y }, { x: Math.cos(a), y: Math.sin(a) }, rect);
    if (!seg) continue;
    const selected = sel === i;
    guides.push({
      ...seg,
      color,
      width: selected ? 7.5 : 2.5,
      opacity: sel !== null && !selected ? 0.22 : 0.9,
    });
  }
  return guides;
}

function parseOverlay(raw: unknown): Overlay | null {
  if (!isObj(raw) || !isNum(raw.height) || raw.height <= 0) return null;
  const height = raw.height;
  const h = raw.horizon;
  const horizon =
    isObj(h) && isNum(h.x1) && isNum(h.y1) && isNum(h.x2) && isNum(h.y2)
      ? { x1: h.x1, y1: h.y1, x2: h.x2, y2: h.y2 }
      : null;
  const stars: SavedStar[] = [];
  const guides: Guide[] = Array.isArray(raw.guides)
    ? raw.guides.map(parseGuide).filter((g): g is Guide => g !== null)
    : [];
  const legacy = !Array.isArray(raw.guides);
  if (Array.isArray(raw.stars)) {
    for (const s of raw.stars) {
      if (!isObj(s) || !isStr(s.id) || !isNum(s.x) || !isNum(s.y) || !isStr(s.color)) continue;
      if (!(STAR_LABELS as readonly unknown[]).includes(s.label)) continue;
      stars.push({
        id: s.id,
        label: s.label as SavedStar['label'],
        color: s.color,
        x: s.x,
        y: s.y,
        visible: typeof s.visible === 'boolean' ? s.visible : true,
      });
      if (legacy) guides.push(...legacyFan(s, s.color, { w: OVERLAY_WIDTH, h: height }));
    }
  }
  return { height, horizon, stars, guides };
}

function parseLine(raw: unknown): DrawnLine | null {
  if (!isObj(raw)) return null;
  const { id, x1, y1, x2, y2, width, style, color } = raw;
  if (!isStr(id) || !isNum(x1) || !isNum(y1) || !isNum(x2) || !isNum(y2) || !isNum(width)) return null;
  if (!(LINE_STYLES as readonly unknown[]).includes(style) || !isStr(color)) return null;
  return { id, x1, y1, x2, y2, width, style: style as DrawnLine['style'], color };
}

function parsePhoto(raw: unknown): PhotoEntry | null {
  if (!isObj(raw)) return null;
  const { id, fileName, createdAt, updatedAt, perspective } = raw;
  if (!isStr(id) || !isStr(fileName) || !isNum(createdAt)) return null;
  // File names are generated by us; reject anything that could escape the folder.
  if (!/^[A-Za-z0-9_-]+\.jpg$/.test(fileName)) return null;
  const overlay = parseOverlay(raw.overlay);
  if (!overlay) return null;
  const lines = Array.isArray(raw.lines)
    ? raw.lines.map(parseLine).filter((l): l is DrawnLine => l !== null)
    : [];
  return {
    id,
    fileName,
    createdAt,
    updatedAt: isNum(updatedAt) ? updatedAt : createdAt,
    perspective: isPerspective(perspective) ? perspective : 1,
    overlay,
    lines,
  };
}

// ---------- public API ----------

export async function loadSettings(): Promise<Settings> {
  try {
    return parseSettings(await readJson(SETTINGS_FILE));
  } catch (e) {
    console.warn('Could not read settings, using defaults', e);
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): Promise<void> {
  return writeJson(SETTINGS_FILE, settings);
}

export async function loadPhotos(): Promise<PhotoEntry[]> {
  try {
    const raw = await readJson(PHOTOS_FILE);
    if (!Array.isArray(raw)) return [];
    return raw
      .map(parsePhoto)
      .filter((p): p is PhotoEntry => p !== null && new File(photosDir(), p.fileName).exists)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (e) {
    console.warn('Could not read photo library', e);
    return [];
  }
}

export function savePhotos(photos: PhotoEntry[]): Promise<void> {
  return writeJson(PHOTOS_FILE, photos);
}

/** Copies a temporary camera capture into the app's private photo folder. */
export async function importPhoto(sourceUri: string, id: string): Promise<string> {
  ensureDirs();
  const fileName = `${id}.jpg`;
  const dest = new File(photosDir(), fileName);
  if (dest.exists) dest.delete();
  await new File(sourceUri).copy(dest);
  return fileName;
}

export function deletePhotoFile(fileName: string) {
  const file = new File(photosDir(), fileName);
  if (file.exists) file.delete();
}

export function photoUri(fileName: string): string {
  return new File(photosDir(), fileName).uri;
}
