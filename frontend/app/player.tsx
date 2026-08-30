import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, resolveMediaUrl } from "@/src/api/client";
import type { Bookmark } from "@/src/api/types";
import { track as trackEvent } from "@/src/analytics";
import { Sheet } from "@/src/components/Sheet";
import { SPEEDS, SleepOption, usePlayer, usePlayerStatus } from "@/src/context/PlayerContext";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, formatDuration, radius, spacing } from "@/src/theme/tokens";

const SLEEP_OPTIONS: { label: string; value: SleepOption }[] = [
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "45 minutes", value: 45 },
  { label: "60 minutes", value: 60 },
  { label: "End of chapter", value: "chapter" },
  { label: "Off", value: null },
];

export default function PlayerScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const {
    novel,
    chapter,
    track,
    rate,
    sleep,
    sleepRemaining,
    isOffline,
    togglePlay,
    next,
    previous,
    seekBy,
    seekTo,
    setRate,
    setSleep,
    playChapter,
  } = usePlayer();
  const { playing, buffering, position, duration } = usePlayerStatus();

  const [dragging, setDragging] = useState<number | null>(null);
  const [speedSheet, setSpeedSheet] = useState(false);
  const [sleepSheet, setSleepSheet] = useState(false);
  const [chapterSheet, setChapterSheet] = useState(false);
  const [bookmarkSheet, setBookmarkSheet] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [illustrationOpen, setIllustrationOpen] = useState(false);

  const novelId = novel?.id ?? null;

  const loadBookmarks = useCallback(async () => {
    if (!novelId) return;
    try {
      setBookmarks(await api.bookmarks(novelId));
    } catch {
      /* offline */
    }
  }, [novelId]);

  useEffect(() => {
    void loadBookmarks();
  }, [loadBookmarks]);

  // The most recent illustration whose cue has already passed.
  const currentIllustration = useMemo(() => {
    const list = chapter?.illustrations ?? [];
    if (list.length === 0) return null;
    const passed = list.filter((item) => item.timestamp_seconds <= position);
    return passed.length > 0 ? passed[passed.length - 1] : null;
  }, [chapter, position]);

  const addBookmark = async () => {
    if (!novel || !chapter) return;
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const created = await api.createBookmark(novel.id, chapter.id, Math.floor(position));
      trackEvent("bookmark_created", { novel_id: novel.id, chapter_id: chapter.id });
      setBookmarks((prev) =>
        prev.some((b) => b.id === created.id) ? prev : [created, ...prev],
      );
      toast(`Bookmarked at ${formatDuration(created.position_seconds)}`, "success");
    } catch {
      toast("Could not save this bookmark", "error");
    }
  };

  const openBookmark = (bookmark: Bookmark) => {
    setBookmarkSheet(false);
    if (!novel) return;
    if (bookmark.chapter_id === chapter?.id) {
      seekTo(bookmark.position_seconds);
      return;
    }
    const index = (track?.chapters ?? []).findIndex((c) => c.id === bookmark.chapter_id);
    if (index >= 0) playChapter(novel, track?.chapters ?? [], index, bookmark.position_seconds);
  };

  const removeBookmark = async (bookmark: Bookmark) => {
    try {
      await api.deleteBookmark(bookmark.id);
      setBookmarks((prev) => prev.filter((b) => b.id !== bookmark.id));
    } catch {
      toast("Could not remove the bookmark", "error");
    }
  };

  if (!novel || !chapter) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
        <Feather name="music" size={30} color={colors.onSurfaceSecondary} />
        <Text style={[styles.emptyText, { color: colors.onSurfaceSecondary }]}>
          Nothing is playing right now.
        </Text>
        <Pressable
          testID="player-close-empty"
          onPress={() => router.back()}
          style={[styles.emptyBtn, { backgroundColor: colors.brand }]}
        >
          <Text style={[styles.emptyBtnText, { color: colors.onBrand }]}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const cover = resolveMediaUrl(novel.cover_image_url);
  const displayPosition = dragging ?? position;
  const total = duration > 0 ? duration : chapter.duration_seconds || 1;
  const chapters = track?.chapters ?? [];
  const currentIndex = track?.index ?? 0;

  const tap = () => {
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      {cover ? (
        <Image
          source={{ uri: cover }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          blurRadius={38}
        />
      ) : null}
      <LinearGradient
        colors={
          isDark
            ? ["rgba(13,15,18,0.6)", "rgba(13,15,18,0.92)", "#0D0F12"]
            : ["rgba(249,248,246,0.7)", "rgba(249,248,246,0.94)", "#F9F8F6"]
        }
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          testID="player-close"
          onPress={() => router.back()}
          hitSlop={10}
          style={[styles.circle, { backgroundColor: colors.surfaceSecondary }]}
        >
          <Feather name="chevron-down" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={[styles.headerNovel, { color: colors.onSurfaceSecondary }]}>
            {novel.title}
          </Text>
          {isOffline ? (
            <View style={styles.offlineRow}>
              <Feather name="download" size={10} color={colors.success} />
              <Text style={[styles.offlineText, { color: colors.success }]}>Playing offline</Text>
            </View>
          ) : null}
        </View>
        <Pressable
          testID="player-bookmark-add"
          onPress={addBookmark}
          hitSlop={10}
          style={[styles.circle, { backgroundColor: colors.surfaceSecondary }]}
        >
          <Feather name="bookmark" size={18} color={colors.brand} />
        </Pressable>
        <Pressable
          testID="player-chapters"
          onPress={() => setChapterSheet(true)}
          hitSlop={10}
          style={[styles.circle, { backgroundColor: colors.surfaceSecondary }]}
        >
          <Feather name="list" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.artWrap, { borderColor: colors.border }]}>
          {cover ? (
            <Image source={{ uri: cover }} style={styles.art} contentFit="cover" transition={260} />
          ) : (
            <View style={[styles.art, styles.artFallback, { backgroundColor: colors.surfaceTertiary }]}>
              <Feather name="book-open" size={40} color={colors.onSurfaceSecondary} />
            </View>
          )}
        </View>

        <View style={styles.titles}>
          <Text numberOfLines={2} style={[styles.chapterTitle, { color: colors.onSurface }]}>
            {chapter.title}
          </Text>
          <Text style={[styles.chapterMeta, { color: colors.onSurfaceSecondary }]}>
            Chapter {chapter.chapter_number} · {novel.author}
          </Text>
        </View>

        <View style={styles.scrub}>
          <Slider
            testID="player-scrubber"
            style={styles.slider}
            minimumValue={0}
            maximumValue={total}
            value={displayPosition}
            minimumTrackTintColor={colors.brand}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.brand}
            onSlidingStart={() => setDragging(position)}
            onValueChange={(v) => setDragging(v)}
            onSlidingComplete={(v) => {
              seekTo(v);
              setDragging(null);
            }}
          />
          <View style={styles.times}>
            <Text style={[styles.time, { color: colors.onSurfaceSecondary }]}>
              {formatDuration(displayPosition)}
            </Text>
            <Text style={[styles.time, { color: colors.onSurfaceSecondary }]}>
              -{formatDuration(Math.max(0, total - displayPosition))}
            </Text>
          </View>
        </View>

        <View style={styles.controls}>
          <Pressable
            testID="player-prev-chapter"
            onPress={() => {
              tap();
              previous();
            }}
            hitSlop={8}
            style={styles.ctrlSmall}
          >
            <Feather name="skip-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Pressable
            testID="player-back-15"
            onPress={() => {
              tap();
              seekBy(-15);
            }}
            hitSlop={8}
            style={styles.ctrlSmall}
          >
            <Feather name="rotate-ccw" size={24} color={colors.onSurface} />
            <Text style={[styles.ctrlLabel, { color: colors.onSurfaceSecondary }]}>15</Text>
          </Pressable>
          <Pressable
            testID="player-toggle"
            onPress={() => {
              tap();
              togglePlay();
            }}
            style={[styles.playBtn, { backgroundColor: colors.brand }]}
          >
            {buffering ? (
              <ActivityIndicator color={colors.onBrand} />
            ) : (
              <Feather name={playing ? "pause" : "play"} size={30} color={colors.onBrand} />
            )}
          </Pressable>
          <Pressable
            testID="player-forward-30"
            onPress={() => {
              tap();
              seekBy(30);
            }}
            hitSlop={8}
            style={styles.ctrlSmall}
          >
            <Feather name="rotate-cw" size={24} color={colors.onSurface} />
            <Text style={[styles.ctrlLabel, { color: colors.onSurfaceSecondary }]}>30</Text>
          </Pressable>
          <Pressable
            testID="player-next-chapter"
            onPress={() => {
              tap();
              next();
            }}
            hitSlop={8}
            style={styles.ctrlSmall}
          >
            <Feather name="skip-forward" size={22} color={colors.onSurface} />
          </Pressable>
        </View>

        {currentIllustration ? (
          <Pressable
            testID="player-illustration-button"
            onPress={() => setIllustrationOpen(true)}
            style={[
              styles.illustration,
              { backgroundColor: colors.brandTertiary, borderColor: colors.brand },
            ]}
          >
            <Feather name="image" size={15} color={colors.onBrandTertiary} />
            <Text numberOfLines={1} style={[styles.illustrationText, { color: colors.onBrandTertiary }]}>
              {currentIllustration.caption ?? "View illustration"}
            </Text>
            <Feather name="chevron-right" size={15} color={colors.onBrandTertiary} />
          </Pressable>
        ) : null}

        <View style={styles.extras}>
          <Pressable
            testID="player-speed-button"
            onPress={() => setSpeedSheet(true)}
            style={[styles.pill, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          >
            <Feather name="zap" size={14} color={colors.brand} />
            <Text style={[styles.pillText, { color: colors.onSurface }]}>{rate}x</Text>
          </Pressable>
          <Pressable
            testID="player-sleep-button"
            onPress={() => setSleepSheet(true)}
            style={[
              styles.pill,
              {
                backgroundColor: sleep ? colors.brandTertiary : colors.surfaceSecondary,
                borderColor: sleep ? colors.brand : colors.border,
              },
            ]}
          >
            <Feather name="moon" size={14} color={colors.brand} />
            <Text style={[styles.pillText, { color: colors.onSurface }]}>
              {sleep === "chapter"
                ? "End of chapter"
                : typeof sleep === "number" && sleepRemaining
                  ? formatDuration(sleepRemaining)
                  : "Sleep timer"}
            </Text>
          </Pressable>
          <Pressable
            testID="player-bookmarks-button"
            onPress={() => {
              void loadBookmarks();
              setBookmarkSheet(true);
            }}
            style={[styles.pill, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          >
            <Feather name="bookmark" size={14} color={colors.brand} />
            <Text style={[styles.pillText, { color: colors.onSurface }]}>
              Bookmarks{bookmarks.length > 0 ? ` · ${bookmarks.length}` : ""}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <Sheet
        testID="speed-sheet"
        visible={speedSheet}
        onClose={() => setSpeedSheet(false)}
        title="Playback speed"
      >
        {SPEEDS.map((value) => (
          <Pressable
            key={value}
            testID={`speed-option-${value}`}
            onPress={() => {
              setRate(value);
              setSpeedSheet(false);
            }}
            style={[styles.option, { borderColor: colors.divider }]}
          >
            <Text style={[styles.optionText, { color: colors.onSurface }]}>{value}x</Text>
            {rate === value ? <Feather name="check" size={18} color={colors.brand} /> : null}
          </Pressable>
        ))}
      </Sheet>

      <Sheet
        testID="sleep-sheet"
        visible={sleepSheet}
        onClose={() => setSleepSheet(false)}
        title="Sleep timer"
      >
        {SLEEP_OPTIONS.map((opt) => (
          <Pressable
            key={String(opt.value)}
            testID={`sleep-option-${opt.value ?? "off"}`}
            onPress={() => {
              setSleep(opt.value);
              setSleepSheet(false);
            }}
            style={[styles.option, { borderColor: colors.divider }]}
          >
            <Text style={[styles.optionText, { color: colors.onSurface }]}>{opt.label}</Text>
            {sleep === opt.value ? <Feather name="check" size={18} color={colors.brand} /> : null}
          </Pressable>
        ))}
      </Sheet>

      <Sheet
        testID="chapter-sheet"
        visible={chapterSheet}
        onClose={() => setChapterSheet(false)}
        title={novel.title}
        scroll
      >
        {chapters.map((item, index) => (
          <Pressable
            key={item.id}
            testID={`player-chapter-${item.id}`}
            onPress={() => {
              playChapter(novel, chapters, index, 0);
              setChapterSheet(false);
            }}
            style={[styles.option, { borderColor: colors.divider }]}
          >
            <View style={styles.optionBody}>
              <Text
                numberOfLines={1}
                style={[
                  styles.optionText,
                  { color: index === currentIndex ? colors.brand : colors.onSurface },
                ]}
              >
                {item.chapter_number}. {item.title}
              </Text>
              <Text style={[styles.optionMeta, { color: colors.onSurfaceSecondary }]}>
                {formatDuration(item.duration_seconds)}
              </Text>
            </View>
            {index === currentIndex ? (
              <Feather name="volume-2" size={16} color={colors.brand} />
            ) : null}
          </Pressable>
        ))}
      </Sheet>

      <Sheet
        testID="bookmarks-sheet"
        visible={bookmarkSheet}
        onClose={() => setBookmarkSheet(false)}
        title="Bookmarks"
        scroll
      >
        {bookmarks.length === 0 ? (
          <Text style={[styles.emptyBookmark, { color: colors.onSurfaceSecondary }]}>
            No bookmarks yet. Tap the bookmark icon while listening to save the exact moment.
          </Text>
        ) : (
          bookmarks.map((bookmark) => (
            <View key={bookmark.id} style={[styles.option, { borderColor: colors.divider }]}>
              <Pressable
                testID={`bookmark-open-${bookmark.id}`}
                onPress={() => openBookmark(bookmark)}
                style={styles.optionBody}
              >
                <Text numberOfLines={1} style={[styles.optionText, { color: colors.onSurface }]}>
                  Chapter {bookmark.chapter_number ?? "?"} · {formatDuration(bookmark.position_seconds)}
                </Text>
                <Text numberOfLines={1} style={[styles.optionMeta, { color: colors.onSurfaceSecondary }]}>
                  {bookmark.chapter_title ?? ""}
                </Text>
              </Pressable>
              <Pressable
                testID={`bookmark-delete-${bookmark.id}`}
                onPress={() => void removeBookmark(bookmark)}
                hitSlop={8}
                style={styles.bookmarkDelete}
              >
                <Feather name="trash-2" size={16} color={colors.error} />
              </Pressable>
            </View>
          ))
        )}
      </Sheet>

      <Modal
        visible={illustrationOpen && Boolean(currentIllustration)}
        transparent
        animationType="fade"
        onRequestClose={() => setIllustrationOpen(false)}
      >
        <Pressable
          testID="illustration-modal"
          style={styles.imageBackdrop}
          onPress={() => setIllustrationOpen(false)}
        >
          <Image
            source={{ uri: resolveMediaUrl(currentIllustration?.image_url) ?? "" }}
            style={styles.fullImage}
            contentFit="contain"
            transition={200}
          />
          {currentIllustration?.caption ? (
            <Text style={[styles.imageCaption, { color: "#F3F4F6" }]}>
              {currentIllustration.caption}
            </Text>
          ) : null}
          <Pressable
            testID="illustration-close"
            onPress={() => setIllustrationOpen(false)}
            style={[styles.imageClose, { top: insets.top + spacing.md }]}
          >
            <Feather name="x" size={22} color="#F3F4F6" />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  emptyText: { fontFamily: fonts.regular, fontSize: fontSize.lg },
  emptyBtn: { paddingHorizontal: spacing.xl, minHeight: 46, justifyContent: "center", borderRadius: radius.pill },
  emptyBtnText: { fontFamily: fonts.semibold, fontSize: fontSize.base },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerText: { flex: 1, alignItems: "center", gap: 2 },
  headerNovel: { fontFamily: fonts.medium, fontSize: fontSize.base },
  offlineRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  offlineText: { fontFamily: fonts.medium, fontSize: fontSize.sm - 1 },
  circle: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: spacing.xl, gap: spacing.xl, alignItems: "center" },
  artWrap: {
    width: "100%",
    maxWidth: 320,
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
    marginTop: spacing.sm,
  },
  art: { width: "100%", height: "100%" },
  artFallback: { alignItems: "center", justifyContent: "center" },
  titles: { alignItems: "center", gap: spacing.xs, width: "100%" },
  chapterTitle: { fontFamily: fonts.display, fontSize: fontSize.xxl, textAlign: "center", lineHeight: 31 },
  chapterMeta: { fontFamily: fonts.regular, fontSize: fontSize.base, textAlign: "center" },
  scrub: { width: "100%", gap: spacing.xs },
  slider: { width: "100%", height: 36 },
  times: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.xs },
  time: { fontFamily: fonts.medium, fontSize: fontSize.sm },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    maxWidth: 340,
  },
  ctrlSmall: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  ctrlLabel: { fontFamily: fonts.semibold, fontSize: 9, marginTop: -2 },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  extras: { flexDirection: "row", gap: spacing.sm, justifyContent: "center", flexWrap: "wrap" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { fontFamily: fonts.semibold, fontSize: fontSize.base },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  optionBody: { flex: 1, gap: 2 },
  optionText: { fontFamily: fonts.medium, fontSize: fontSize.lg },
  optionMeta: { fontFamily: fonts.regular, fontSize: fontSize.sm },
  illustration: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "stretch",
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  illustrationText: { flex: 1, fontFamily: fonts.semibold, fontSize: fontSize.base },
  emptyBookmark: {
    fontFamily: fonts.regular,
    fontSize: fontSize.base,
    lineHeight: 20,
    paddingVertical: spacing.md,
  },
  bookmarkDelete: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  imageBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  fullImage: { width: "100%", height: "80%" },
  imageCaption: {
    fontFamily: fonts.regular,
    fontSize: fontSize.base,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  imageClose: { position: "absolute", right: spacing.lg, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
