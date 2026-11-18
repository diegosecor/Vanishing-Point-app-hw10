import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { makeId } from '@/lib/geometry';
import {
  DEFAULT_SETTINGS,
  deletePhotoFile,
  importPhoto,
  loadPhotos,
  loadSettings,
  savePhotos,
  saveSettings,
} from '@/lib/storage';
import type { Draft, DrawnLine, PhotoEntry, Settings } from '@/lib/types';

type AppStore = {
  ready: boolean;
  settings: Settings;
  photos: PhotoEntry[];
  draft: Draft | null;
  updateSettings: (patch: Partial<Settings>) => void;
  setDraft: (draft: Draft | null) => void;
  /** Saves a draft as a new gallery photo, returns its id. */
  saveDraft: (draft: Draft, lines: DrawnLine[]) => Promise<string>;
  updatePhotoLines: (id: string, lines: DrawnLine[]) => Promise<void>;
  deletePhoto: (id: string) => Promise<void>;
};

const StoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Latest photos list, so async actions never work from a stale copy.
  const photosRef = useRef<PhotoEntry[]>([]);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, p] = await Promise.all([loadSettings(), loadPhotos()]);
      if (cancelled) return;
      photosRef.current = p;
      settingsRef.current = s;
      setSettings(s);
      setPhotos(p);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const commitPhotos = useCallback(async (next: PhotoEntry[]) => {
    const previous = photosRef.current;
    photosRef.current = next;
    setPhotos(next);
    try {
      await savePhotos(next);
    } catch (e) {
      photosRef.current = previous;
      setPhotos(previous);
      throw e;
    }
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next).catch((e) => console.warn('Could not save settings', e));
  }, []);

  const saveDraft = useCallback(
    async (d: Draft, lines: DrawnLine[]) => {
      const id = makeId();
      const fileName = await importPhoto(d.uri, id);
      const now = Date.now();
      const entry: PhotoEntry = {
        id,
        fileName,
        createdAt: d.createdAt,
        updatedAt: now,
        perspective: d.perspective,
        overlay: d.overlay,
        lines,
      };
      try {
        await commitPhotos([entry, ...photosRef.current]);
      } catch (e) {
        deletePhotoFile(fileName);
        throw e;
      }
      return id;
    },
    [commitPhotos],
  );

  const updatePhotoLines = useCallback(
    async (id: string, lines: DrawnLine[]) => {
      const next = photosRef.current.map((p) => (p.id === id ? { ...p, lines, updatedAt: Date.now() } : p));
      await commitPhotos(next);
    },
    [commitPhotos],
  );

  const deletePhoto = useCallback(
    async (id: string) => {
      const target = photosRef.current.find((p) => p.id === id);
      if (!target) return;
      await commitPhotos(photosRef.current.filter((p) => p.id !== id));
      try {
        deletePhotoFile(target.fileName);
      } catch (e) {
        console.warn('Photo removed from gallery but file could not be deleted', e);
      }
    },
    [commitPhotos],
  );

  const value = useMemo<AppStore>(
    () => ({
      ready,
      settings,
      photos,
      draft,
      updateSettings,
      setDraft,
      saveDraft,
      updatePhotoLines,
      deletePhoto,
    }),
    [ready, settings, photos, draft, updateSettings, saveDraft, updatePhotoLines, deletePhoto],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAppStore(): AppStore {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useAppStore must be used inside AppStoreProvider');
  return ctx;
}
