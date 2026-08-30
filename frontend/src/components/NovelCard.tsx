import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { resolveMediaUrl } from "@/src/api/client";
import type { Novel } from "@/src/api/types";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, formatDuration, radius, spacing } from "@/src/theme/tokens";

const POSTER_W = 148;

type PosterProps = {
  novel: Novel;
  progress?: number;
  subtitle?: string;
  testID: string;
};

export function PosterCard({ novel, progress, subtitle, testID }: PosterProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const cover = resolveMediaUrl(novel.cover_image_url);

  return (
    <Pressable
      testID={testID}
      onPress={() => router.push(`/novel/${novel.id}`)}
      style={({ pressed }) => [styles.poster, { opacity: pressed ? 0.82 : 1 }]}
    >
      <View style={[styles.posterArt, { backgroundColor: colors.surfaceTertiary }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={styles.fill} contentFit="cover" transition={220} />
        ) : (
          <View style={[styles.fill, styles.center]}>
            <Feather name="book-open" size={26} color={colors.onSurfaceSecondary} />
          </View>
        )}
        {typeof progress === "number" ? (
          <>
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.75)"]}
              style={[styles.posterScrim, { pointerEvents: "none" }]}
            />
            <View style={[styles.progressTrack, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.min(100, Math.max(2, progress * 100))}%`, backgroundColor: colors.brand },
                ]}
              />
            </View>
          </>
        ) : null}
      </View>
      <Text numberOfLines={2} style={[styles.posterTitle, { color: colors.onSurface }]}>
        {novel.title}
      </Text>
      <Text numberOfLines={1} style={[styles.posterMeta, { color: colors.onSurfaceSecondary }]}>
        {subtitle ?? novel.author}
      </Text>
    </Pressable>
  );
}

export function NovelListRow({
  novel,
  testID,
  right,
  subtitle,
}: {
  novel: Novel;
  testID: string;
  right?: React.ReactNode;
  subtitle?: string;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const cover = resolveMediaUrl(novel.cover_image_url);

  return (
    <Pressable
      testID={testID}
      onPress={() => router.push(`/novel/${novel.id}`)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={[styles.rowArt, { backgroundColor: colors.surfaceTertiary }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={styles.fill} contentFit="cover" transition={200} />
        ) : (
          <View style={[styles.fill, styles.center]}>
            <Feather name="book" size={18} color={colors.onSurfaceSecondary} />
          </View>
        )}
      </View>
      <View style={styles.rowBody}>
        <Text numberOfLines={2} style={[styles.rowTitle, { color: colors.onSurface }]}>
          {novel.title}
        </Text>
        <Text numberOfLines={1} style={[styles.rowMeta, { color: colors.onSurfaceSecondary }]}>
          {subtitle ?? novel.author}
        </Text>
        <View style={styles.rowStats}>
          <Feather name="headphones" size={12} color={colors.brand} />
          <Text style={[styles.rowStat, { color: colors.onSurfaceSecondary }]}>
            {novel.chapter_count} ch
          </Text>
          <Text style={[styles.rowStat, { color: colors.onSurfaceSecondary }]}>·</Text>
          <Text style={[styles.rowStat, { color: colors.onSurfaceSecondary }]}>
            {formatDuration(novel.total_duration_seconds)}
          </Text>
        </View>
      </View>
      {right ?? <Feather name="chevron-right" size={18} color={colors.onSurfaceSecondary} />}
    </Pressable>
  );
}

export function GridCard({ novel, testID, width }: { novel: Novel; testID: string; width: number }) {
  const { colors } = useTheme();
  const router = useRouter();
  const cover = resolveMediaUrl(novel.cover_image_url);

  return (
    <Pressable
      testID={testID}
      onPress={() => router.push(`/novel/${novel.id}`)}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.gridArt, { backgroundColor: colors.surfaceTertiary }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={styles.fill} contentFit="cover" transition={220} />
        ) : (
          <View style={[styles.fill, styles.center]}>
            <Feather name="book-open" size={24} color={colors.onSurfaceSecondary} />
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={[styles.posterTitle, { color: colors.onSurface }]}>
        {novel.title}
      </Text>
      <Text numberOfLines={1} style={[styles.posterMeta, { color: colors.onSurfaceSecondary }]}>
        {novel.author}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { width: "100%", height: "100%" },
  center: { alignItems: "center", justifyContent: "center" },
  poster: { width: POSTER_W, gap: spacing.sm },
  posterArt: {
    width: POSTER_W,
    height: POSTER_W * 1.42,
    borderRadius: radius.md,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  posterScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "45%" },
  progressTrack: {
    height: 3,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  progressFill: { height: 3, borderRadius: radius.pill },
  posterTitle: { fontFamily: fonts.semibold, fontSize: fontSize.base, lineHeight: 19 },
  posterMeta: { fontFamily: fonts.regular, fontSize: fontSize.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowArt: { width: 56, height: 78, borderRadius: radius.sm, overflow: "hidden" },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { fontFamily: fonts.semibold, fontSize: fontSize.lg, lineHeight: 21 },
  rowMeta: { fontFamily: fonts.regular, fontSize: fontSize.sm },
  rowStats: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: 2 },
  rowStat: { fontFamily: fonts.medium, fontSize: fontSize.sm - 1 },
  gridArt: {
    width: "100%",
    aspectRatio: 0.7,
    borderRadius: radius.md,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
});
