import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, resolveMediaUrl } from "@/src/api/client";
import type { AnimeMapping, CatchUp, Chapter, NovelDetail } from "@/src/api/types";
import { track } from "@/src/analytics";
import { ChapterRow } from "@/src/components/ChapterRow";
import { ChipRow } from "@/src/components/Chips";
import { Sheet } from "@/src/components/Sheet";
import { ErrorState } from "@/src/components/States";
import { useDownloads } from "@/src/context/DownloadsContext";
import { usePlayer, usePlayerStatus } from "@/src/context/PlayerContext";
import { useToast } from "@/src/context/ToastContext";
import { useBottomPadding } from "@/src/hooks/use-bottom-padding";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, formatBytes, formatDuration, radius, spacing } from "@/src/theme/tokens";

const HERO_HEIGHT = 340;

export default function NovelDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { playChapter, chapter: activeChapter, completionTick } = usePlayer();
  const { playing } = usePlayerStatus();
  const { download, downloadMany, supported, records } = useDownloads();
  const bottomPadding = useBottomPadding(false);

  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [volumeId, setVolumeId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [catchUp, setCatchUp] = useState<CatchUp | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);
  const [volumeSheet, setVolumeSheet] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [data, completed, recap] = await Promise.all([
        api.novel(id),
        api.completedChapters(id).catch(() => ({ chapter_ids: [] as string[] })),
        api.catchup(id).catch(() => null),
      ]);
      setDetail(data);
      setCompletedIds(completed.chapter_ids);
      setCatchUp(recap);
      setVolumeId((prev) => prev ?? data.volumes[0]?.id ?? null);
      track("novel_viewed", { novel_id: id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this novel");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // A chapter finishing in the player must tick the list here too.
  useEffect(() => {
    if (!id || completionTick === 0) return;
    void api
      .completedChapters(id)
      .then((res) => setCompletedIds(res.chapter_ids))
      .catch(() => undefined);
  }, [completionTick, id]);

  const allChapters = useMemo<Chapter[]>(
    () => (detail ? detail.volumes.flatMap((v) => v.chapters) : []),
    [detail],
  );
  const visibleChapters = useMemo<Chapter[]>(() => {
    if (!detail) return [];
    if (detail.volumes.length <= 1) return allChapters;
    return detail.volumes.find((v) => v.id === volumeId)?.chapters ?? [];
  }, [detail, volumeId, allChapters]);

  const selectedVolume = useMemo(
    () => detail?.volumes.find((v) => v.id === volumeId) ?? null,
    [detail, volumeId],
  );
  const completedSet = useMemo(() => new Set(completedIds), [completedIds]);
  const animeMappings = useMemo(
    () => (detail?.novel.anime_mappings ?? []).filter((m) => Boolean(m.continue_chapter_id)),
    [detail],
  );
  const chapterLabel = useCallback(
    (chapterId?: string | null) => {
      const found = allChapters.find((c) => c.id === chapterId);
      return found ? `chapter ${found.chapter_number}` : "the recommended chapter";
    },
    [allChapters],
  );
  const estimatedBytes = useMemo(
    () =>
      visibleChapters.reduce(
        (sum, c) => sum + (c.file_size_bytes || c.duration_seconds * 16000),
        0,
      ),
    [visibleChapters],
  );
  const volumeProgress = useMemo(() => {
    const tracked = visibleChapters
      .map((c) => records[c.id])
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    return {
      active: tracked.filter((r) => r.state === "queued" || r.state === "downloading").length,
      done: tracked.filter((r) => r.state === "complete").length,
      total: visibleChapters.length,
    };
  }, [visibleChapters, records]);

  const resumeChapterIndex = useMemo(() => {
    if (!detail?.progress) return 0;
    const idx = allChapters.findIndex((c) => c.id === detail.progress?.chapter_id);
    return idx < 0 ? 0 : idx;
  }, [detail, allChapters]);

  const startPlayback = (chapterId?: string) => {
    if (!detail || allChapters.length === 0) {
      toast("No chapters available yet", "info");
      return;
    }
    const index = chapterId
      ? allChapters.findIndex((c) => c.id === chapterId)
      : resumeChapterIndex;
    const startAt =
      !chapterId && detail.progress && allChapters[index]?.id === detail.progress.chapter_id
        ? detail.progress.position_seconds
        : 0;
    playChapter(detail.novel, allChapters, index < 0 ? 0 : index, startAt);
    router.push("/player");
  };

  const toggleSave = async () => {
    if (!detail || saving) return;
    setSaving(true);
    try {
      if (detail.saved) {
        await api.unsave(detail.novel.id);
        setDetail({ ...detail, saved: false });
        toast("Removed from saved", "info");
      } else {
        await api.save(detail.novel.id);
        setDetail({ ...detail, saved: true });
        toast("Saved to your library", "success");
      }
    } catch {
      toast("Could not update saved list", "error");
    } finally {
      setSaving(false);
    }
  };

  const startDownload = async (chapter: Chapter) => {
    if (!detail) return;
    if (!supported) {
      toast("Downloads work in the mobile app, not the web preview", "info");
      return;
    }
    try {
      await download(detail.novel, chapter);
      toast(`Ch. ${chapter.chapter_number} added to downloads`, "info");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Download failed", "error");
    }
  };

  const startVolumeDownload = async () => {
    setVolumeSheet(false);
    if (!detail) return;
    if (!supported) {
      toast("Downloads work in the mobile app, not the web preview", "info");
      return;
    }
    try {
      await downloadMany(detail.novel, visibleChapters, "manual");
      toast(`Queued ${visibleChapters.length} chapters`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Download failed", "error");
    }
  };

  const continueFromAnime = (mapping: AnimeMapping) => {
    if (!mapping.continue_chapter_id) return;
    track("anime_continue_used", {
      novel_id: detail?.novel.id,
      chapter_id: mapping.continue_chapter_id,
      properties: { label: mapping.label },
    });
    startPlayback(mapping.continue_chapter_id);
  };

  const openRecap = () => {
    setRecapOpen((open) => !open);
    if (!recapOpen && detail) track("catchup_used", { novel_id: detail.novel.id });
  };

  const headerOpacity = scrollY.interpolate({
    inputRange: [HERO_HEIGHT - 200, HERO_HEIGHT - 90],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={[styles.root, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
        <ErrorState testID="novel-error" message={error ?? "Novel not found"} onRetry={load} />
      </View>
    );
  }

  const { novel } = detail;
  const cover = resolveMediaUrl(novel.cover_image_url);
  const hasProgress = Boolean(detail.progress);

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <Animated.View
        style={[
          styles.stickyHeader,
          {
            height: insets.top + 54,
            backgroundColor: colors.surface,
            borderColor: colors.divider,
            opacity: headerOpacity,
            pointerEvents: "none",
          },
        ]}
      />
      <View style={[styles.headerControls, { top: insets.top + spacing.sm }]}>
        <Pressable
          testID="novel-back-button"
          onPress={() => router.back()}
          hitSlop={10}
          style={[styles.circleBtn, { backgroundColor: colors.scrim, borderColor: colors.border }]}
        >
          <Feather name="chevron-left" size={20} color={colors.onSurface} />
        </Pressable>
        <Animated.Text
          numberOfLines={1}
          style={[styles.headerTitle, { color: colors.onSurface, opacity: headerOpacity }]}
        >
          {novel.title}
        </Animated.Text>
        <Pressable
          testID="novel-save-button"
          onPress={toggleSave}
          hitSlop={10}
          style={[styles.circleBtn, { backgroundColor: colors.scrim, borderColor: colors.border }]}
        >
          <Feather
            name="bookmark"
            size={18}
            color={detail.saved ? colors.brand : colors.onSurfaceSecondary}
          />
        </Pressable>
      </View>

      <Animated.ScrollView
        testID="novel-scroll"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        contentContainerStyle={{ paddingBottom: bottomPadding }}
      >
        <View style={[styles.hero, { backgroundColor: colors.surfaceTertiary }]}>
          {cover ? (
            <Image source={{ uri: cover }} style={styles.heroImage} contentFit="cover" transition={260} />
          ) : null}
          <LinearGradient
            colors={[
              isDark ? "rgba(13,15,18,0.15)" : "rgba(249,248,246,0.1)",
              isDark ? "rgba(13,15,18,0.75)" : "rgba(249,248,246,0.75)",
              colors.surface,
            ]}
            style={styles.heroScrim}
          />
          <View style={styles.heroContent}>
            <View style={styles.genreRow}>
              {novel.genres.slice(0, 3).map((g) => (
                <View
                  key={g}
                  style={[styles.genreTag, { backgroundColor: colors.brandTertiary }]}
                >
                  <Text style={[styles.genreText, { color: colors.onBrandTertiary }]}>{g}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.heroTitle, { color: colors.onSurface }]}>{novel.title}</Text>
            {novel.alt_title ? (
              <Text style={[styles.heroAlt, { color: colors.onSurfaceSecondary }]}>
                {novel.alt_title}
              </Text>
            ) : null}
            <Text style={[styles.heroAuthor, { color: colors.onSurfaceSecondary }]}>
              by {novel.author}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <Stat icon="list" label={`${novel.chapter_count} chapters`} />
          <Stat icon="clock" label={formatDuration(novel.total_duration_seconds)} />
          <Stat icon="headphones" label={`${novel.play_count} plays`} />
        </View>

        {novel.narration_mode === "full_cast" ? (
          <View
            testID="novel-cast-badge"
            style={[styles.castBadge, { backgroundColor: colors.brandTertiary }]}
          >
            <Feather name="users" size={13} color={colors.onBrandTertiary} />
            <Text style={[styles.castText, { color: colors.onBrandTertiary }]}>
              Full-cast narration · {novel.cast_count} voices
            </Text>
          </View>
        ) : null}

        <View style={styles.ctaRow}>
          <Pressable
            testID="novel-play-button"
            onPress={() => startPlayback()}
            style={({ pressed }) => [
              styles.playCta,
              { backgroundColor: colors.brand, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Feather name="play" size={17} color={colors.onBrand} />
            <Text style={[styles.playText, { color: colors.onBrand }]}>
              {hasProgress
                ? `Resume ch. ${allChapters[resumeChapterIndex]?.chapter_number ?? 1}`
                : "Play chapter 1"}
            </Text>
          </Pressable>
          <Pressable
            testID="novel-save-cta"
            onPress={toggleSave}
            style={[styles.saveCta, { borderColor: detail.saved ? colors.brand : colors.borderStrong }]}
          >
            <Feather
              name={detail.saved ? "check" : "bookmark"}
              size={18}
              color={detail.saved ? colors.brand : colors.onSurfaceSecondary}
            />
          </Pressable>
        </View>

        {catchUp?.available ? (
          <View
            testID="novel-catchup-card"
            style={[
              styles.catchup,
              { backgroundColor: colors.surfaceSecondary, borderColor: colors.brand },
            ]}
          >
            <View style={styles.catchupTop}>
              <Feather name="rotate-ccw" size={15} color={colors.brand} />
              <Text style={[styles.catchupTitle, { color: colors.onSurface }]}>
                It&apos;s been {Math.max(1, Math.round(catchUp.days_since ?? 0))} days
              </Text>
            </View>
            {recapOpen ? (
              <Text testID="novel-catchup-text" style={[styles.catchupText, { color: colors.onSurfaceSecondary }]}>
                {catchUp.text}
              </Text>
            ) : (
              <Text style={[styles.catchupText, { color: colors.onSurfaceSecondary }]}>
                Want a spoiler-safe reminder of where you left off
                {catchUp.through_chapter ? ` (through chapter ${catchUp.through_chapter})` : ""}?
              </Text>
            )}
            <View style={styles.catchupRow}>
              <Pressable
                testID="novel-catchup-button"
                onPress={openRecap}
                style={[styles.catchupPrimary, { backgroundColor: colors.brand }]}
              >
                <Text style={[styles.catchupPrimaryText, { color: colors.onBrand }]}>
                  {recapOpen ? "Hide recap" : "Catch me up"}
                </Text>
              </Pressable>
              <Pressable
                testID="novel-catchup-continue"
                onPress={() => startPlayback()}
                style={[styles.catchupSecondary, { borderColor: colors.borderStrong }]}
              >
                <Text style={[styles.catchupSecondaryText, { color: colors.onSurface }]}>Continue</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {animeMappings.length > 0 ? (
          <View style={styles.block} testID="novel-anime-block">
            <Text style={[styles.blockTitle, { color: colors.onSurface }]}>Watched the anime?</Text>
            {animeMappings.map((mapping) => (
              <Pressable
                key={`${mapping.label}-${mapping.continue_chapter_id}`}
                testID={`novel-anime-${mapping.label.toLowerCase().replace(/\s+/g, "-")}`}
                onPress={() => continueFromAnime(mapping)}
                style={({ pressed }) => [
                  styles.animeRow,
                  {
                    backgroundColor: colors.surfaceSecondary,
                    borderColor: colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={styles.animeBody}>
                  <Text style={[styles.animeLabel, { color: colors.onSurface }]}>
                    {mapping.label}
                    {mapping.through_episode ? ` · through ep. ${mapping.through_episode}` : ""}
                  </Text>
                  <Text style={[styles.animeNote, { color: colors.onSurfaceSecondary }]}>
                    {mapping.note ?? `Continue from ${chapterLabel(mapping.continue_chapter_id)}`}
                  </Text>
                </View>
                <Feather name="arrow-right" size={16} color={colors.brand} />
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.block}>
          <Text
            numberOfLines={expanded ? undefined : 4}
            style={[styles.description, { color: colors.onSurfaceSecondary }]}
          >
            {novel.description || "No synopsis yet."}
          </Text>
          {novel.description.length > 180 ? (
            <Pressable testID="novel-toggle-description" onPress={() => setExpanded((e) => !e)}>
              <Text style={[styles.more, { color: colors.brand }]}>
                {expanded ? "Show less" : "Read more"}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {detail.volumes.length > 1 ? (
          <ChipRow
            options={detail.volumes.map((v) => `Volume ${v.volume_number}`)}
            selected={
              volumeId
                ? `Volume ${detail.volumes.find((v) => v.id === volumeId)?.volume_number}`
                : null
            }
            onSelect={(label) => {
              if (!label) {
                setVolumeId(null);
                return;
              }
              const num = Number(label.replace("Volume ", ""));
              const match = detail.volumes.find((v) => v.volume_number === num);
              setVolumeId(match?.id ?? null);
            }}
            testIDPrefix="novel-volume"
            allLabel="All volumes"
          />
        ) : null}

        <View style={styles.chapterBlock}>
          <View style={styles.chapterHeader}>
            <Text style={[styles.blockTitle, { color: colors.onSurface }]}>
              {selectedVolume && detail.volumes.length > 1
                ? `Volume ${selectedVolume.volume_number}`
                : "Chapters"}
            </Text>
            {visibleChapters.length > 0 ? (
              <Pressable
                testID="novel-download-volume"
                onPress={() => setVolumeSheet(true)}
                style={[styles.volumeBtn, { borderColor: colors.brand }]}
              >
                <Feather
                  name={volumeProgress.active > 0 ? "loader" : "download"}
                  size={13}
                  color={colors.brand}
                />
                <Text style={[styles.volumeBtnText, { color: colors.brand }]}>
                  {volumeProgress.active > 0
                    ? `Downloading ${volumeProgress.done} / ${volumeProgress.total}`
                    : "Download volume"}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {visibleChapters.length === 0 ? (
            <Text style={[styles.description, { color: colors.onSurfaceSecondary }]}>
              No chapters published yet.
            </Text>
          ) : (
            visibleChapters.map((chapter, index) => (
              <ChapterRow
                key={chapter.id}
                chapter={chapter}
                index={index}
                isCurrent={activeChapter?.id === chapter.id}
                isPlaying={playing}
                isCompleted={completedSet.has(chapter.id)}
                onPress={() => startPlayback(chapter.id)}
                onDownload={() => void startDownload(chapter)}
              />
            ))
          )}
        </View>
      </Animated.ScrollView>

      <Sheet
        testID="volume-download-sheet"
        visible={volumeSheet}
        onClose={() => setVolumeSheet(false)}
        title={
          selectedVolume && detail.volumes.length > 1
            ? `Download Volume ${selectedVolume.volume_number}?`
            : "Download all chapters?"
        }
      >
        <Text style={[styles.sheetText, { color: colors.onSurfaceSecondary }]}>
          {visibleChapters.length} chapter{visibleChapters.length === 1 ? "" : "s"} · ~
          {formatBytes(estimatedBytes)}
          {supported
            ? ". They download one at a time and anything already offline is skipped."
            : ". Downloads only work in the installed app, not the web preview."}
        </Text>
        <Pressable
          testID="volume-download-confirm"
          onPress={() => void startVolumeDownload()}
          style={[styles.sheetPrimary, { backgroundColor: colors.brand }]}
        >
          <Feather name="download" size={16} color={colors.onBrand} />
          <Text style={[styles.sheetPrimaryText, { color: colors.onBrand }]}>Download</Text>
        </Pressable>
        <Pressable
          testID="volume-download-cancel"
          onPress={() => setVolumeSheet(false)}
          style={styles.sheetCancel}
        >
          <Text style={[styles.sheetCancelText, { color: colors.onSurfaceSecondary }]}>Cancel</Text>
        </Pressable>
      </Sheet>
    </View>
  );
}

function Stat({ icon, label }: { icon: string; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, { borderColor: colors.border }]}>
      <Feather name={icon as never} size={13} color={colors.brand} />
      <Text style={[styles.statText, { color: colors.onSurfaceSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  stickyHeader: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    zIndex: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerControls: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  headerTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: fontSize.lg, textAlign: "center" },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: { height: HERO_HEIGHT, justifyContent: "flex-end" },
  heroImage: { ...StyleSheet.absoluteFillObject },
  heroScrim: { ...StyleSheet.absoluteFillObject },
  heroContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.xs },
  genreRow: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.xs },
  genreTag: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  genreText: { fontFamily: fonts.medium, fontSize: fontSize.sm - 1 },
  heroTitle: { fontFamily: fonts.display, fontSize: fontSize.xxl + 4, lineHeight: 34 },
  heroAlt: { fontFamily: fonts.displayRegular, fontSize: fontSize.base },
  heroAuthor: { fontFamily: fonts.medium, fontSize: fontSize.base },
  statsRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statText: { fontFamily: fonts.medium, fontSize: fontSize.sm },
  ctaRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  playCta: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 50,
    borderRadius: radius.pill,
  },
  playText: { fontFamily: fonts.semibold, fontSize: fontSize.lg },
  saveCta: {
    width: 50,
    height: 50,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  block: { paddingHorizontal: spacing.lg, marginTop: spacing.lg, gap: spacing.xs },
  blockTitle: { fontFamily: fonts.display, fontSize: fontSize.xl, marginBottom: spacing.xs },
  description: { fontFamily: fonts.regular, fontSize: fontSize.base, lineHeight: 21 },
  more: { fontFamily: fonts.semibold, fontSize: fontSize.base, marginTop: spacing.xs },
  chapterBlock: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  chapterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  volumeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.xs,
  },
  volumeBtnText: { fontFamily: fonts.semibold, fontSize: fontSize.sm },
  castBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  castText: { fontFamily: fonts.medium, fontSize: fontSize.sm },
  catchup: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    gap: spacing.sm,
  },
  catchupTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  catchupTitle: { fontFamily: fonts.semibold, fontSize: fontSize.lg },
  catchupText: { fontFamily: fonts.regular, fontSize: fontSize.base, lineHeight: 21 },
  catchupRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  catchupPrimary: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  catchupPrimaryText: { fontFamily: fonts.semibold, fontSize: fontSize.base },
  catchupSecondary: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  catchupSecondaryText: { fontFamily: fonts.semibold, fontSize: fontSize.base },
  animeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.xs,
  },
  animeBody: { flex: 1, gap: 2 },
  animeLabel: { fontFamily: fonts.semibold, fontSize: fontSize.base },
  animeNote: { fontFamily: fonts.regular, fontSize: fontSize.sm, lineHeight: 18 },
  sheetText: { fontFamily: fonts.regular, fontSize: fontSize.base, lineHeight: 21 },
  sheetPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  sheetPrimaryText: { fontFamily: fonts.semibold, fontSize: fontSize.lg },
  sheetCancel: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  sheetCancelText: { fontFamily: fonts.medium, fontSize: fontSize.base },
});
