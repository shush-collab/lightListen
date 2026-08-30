import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter, useSegments } from "expo-router";
import React from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { resolveMediaUrl } from "@/src/api/client";
import { usePlayer, usePlayerStatus } from "@/src/context/PlayerContext";
import { tabBarOffset } from "@/src/hooks/use-bottom-padding";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, MINI_PLAYER_HEIGHT, radius, spacing } from "@/src/theme/tokens";

/** Floating glass mini-player. Mounted once in the root layout so it survives navigation. */
export function MiniPlayer() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const { novel, chapter, togglePlay, next, isOffline } = usePlayer();
  const { playing, buffering, position, duration } = usePlayerStatus();

  const top = segments[0] as string | undefined;
  const hidden =
    !novel ||
    !chapter ||
    top === "(auth)" ||
    top === "player" ||
    (segments[segments.length - 1] as string | undefined) === "player";

  if (hidden) return null;

  const isTabRoute = top === "(tabs)";
  const bottom = isTabRoute ? tabBarOffset(insets.bottom) + spacing.xs : insets.bottom + spacing.md;
  const cover = resolveMediaUrl(novel.cover_image_url);
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <View testID="mini-player" style={[styles.wrap, { bottom, borderColor: colors.border }]}>
      <BlurView
        intensity={Platform.OS === "android" ? 40 : 60}
        tint={isDark ? "dark" : "light"}
        style={styles.blur}
      >
        <View style={[styles.inner, { backgroundColor: `${colors.surfaceSecondary}D9` }]}>
          <Pressable
            testID="mini-player-open"
            style={styles.tap}
            onPress={() => router.push("/player")}
          >
            <View style={[styles.art, { backgroundColor: colors.surfaceTertiary }]}>
              {cover ? (
                <Image source={{ uri: cover }} style={styles.fill} contentFit="cover" />
              ) : (
                <Feather name="music" size={16} color={colors.onSurfaceSecondary} />
              )}
            </View>
            <View style={styles.text}>
              <Text numberOfLines={1} style={[styles.title, { color: colors.onSurface }]}>
                {chapter.title}
              </Text>
              <View style={styles.metaRow}>
                {isOffline ? <Feather name="download" size={10} color={colors.success} /> : null}
                <Text numberOfLines={1} style={[styles.meta, { color: colors.onSurfaceSecondary }]}>
                  {novel.title}
                </Text>
              </View>
            </View>
          </Pressable>
          <Pressable
            testID="mini-player-toggle"
            hitSlop={8}
            style={[styles.btn, { backgroundColor: colors.brand }]}
            onPress={() => {
              if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              togglePlay();
            }}
          >
            {buffering ? (
              <ActivityIndicator size="small" color={colors.onBrand} />
            ) : (
              <Feather name={playing ? "pause" : "play"} size={18} color={colors.onBrand} />
            )}
          </Pressable>
          <Pressable testID="mini-player-next" hitSlop={8} style={styles.skip} onPress={next}>
            <Feather name="skip-forward" size={18} color={colors.onSurface} />
          </Pressable>
        </View>
        <View style={[styles.track, { backgroundColor: colors.border }]}>
          <View style={[styles.fillBar, { width: `${ratio * 100}%`, backgroundColor: colors.brand }]} />
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    height: MINI_PLAYER_HEIGHT,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  blur: { flex: 1, justifyContent: "space-between" },
  inner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  tap: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  art: { width: 44, height: 44, borderRadius: radius.sm, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  fill: { width: "100%", height: "100%" },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: fontSize.base },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  meta: { fontFamily: fonts.regular, fontSize: fontSize.sm - 1, flex: 1 },
  btn: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  skip: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  track: { height: 2, width: "100%" },
  fillBar: { height: 2 },
});
