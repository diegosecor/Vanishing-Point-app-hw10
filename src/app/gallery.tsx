import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Alert, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OverlayLayer } from '@/components/overlay-layer';
import { LinkButton, ScreenHeader, textStyles } from '@/components/ui';
import { DANGER, Fonts, HAIRLINE, MUTED, WHITE } from '@/constants/style';
import { formatDate } from '@/lib/geometry';
import { photoUri } from '@/lib/storage';
import { OVERLAY_WIDTH, type PhotoEntry } from '@/lib/types';
import { useAppStore } from '@/store/app-store';

const COLUMNS = 3;
const GAP = 10;
const PADDING = 14;

export default function GalleryScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { photos, deletePhoto } = useAppStore();
  const cellW = (width - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

  function confirmDelete(photo: PhotoEntry) {
    Alert.alert('Delete this photo?', `Taken ${formatDate(photo.createdAt)}. This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deletePhoto(photo.id).catch((e) =>
            Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.'),
          );
        },
      },
    ]);
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="GALLERY" />
      {photos.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[textStyles.body, styles.emptyText]}>No photos yet</Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(p) => p.id}
          numColumns={COLUMNS}
          contentContainerStyle={{ padding: PADDING, paddingBottom: insets.bottom + 24, gap: GAP + 6 }}
          columnWrapperStyle={{ gap: GAP }}
          renderItem={({ item }) => {
            const cellH = cellW * (item.overlay.height / OVERLAY_WIDTH);
            return (
              <View style={{ width: cellW }}>
                <Pressable
                  onPress={() => router.push({ pathname: '/editor', params: { id: item.id } })}
                  onLongPress={() => confirmDelete(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open photo from ${formatDate(item.createdAt)}`}
                  style={({ pressed }) => [styles.thumb, { height: cellH, opacity: pressed ? 0.7 : 1 }]}
                >
                  <Image
                    source={{ uri: photoUri(item.fileName) }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    recyclingKey={item.id}
                  />
                  <OverlayLayer overlay={item.overlay} lines={item.lines} compact />
                </Pressable>
                <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
                <LinkButton
                  label="Delete"
                  onPress={() => confirmDelete(item)}
                  color={DANGER}
                  textStyle={styles.deleteText}
                  accessibilityLabel={`Delete photo from ${formatDate(item.createdAt)}`}
                />
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WHITE },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: MUTED, fontSize: 17 },
  thumb: {
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#F4F5F7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
  },
  date: { fontFamily: Fonts.mono, fontSize: 10, color: '#3A3F47', marginTop: 5 },
  deleteText: { fontSize: 12 },
});
