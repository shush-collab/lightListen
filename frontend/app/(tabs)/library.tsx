import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api/client";
import type { ContinueItem, Novel } from "@/src/api/types";
import { SegmentedControl } from "@/src/components/Chips";
import { NovelListRow } from "@/src/components/NovelCard";
import { EmptyState } from "@/src/components/States";
import { useDownloads } from "@/src/context/DownloadsContext";
import { usePlayer } from "@/src/context/PlayerContext";
import { useToast } from "@/src/context/ToastContext";
import { useBottomPadding } from "@/src/hooks/use-bottom-padding";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, formatBytes, formatDuration, radius, spacing } from "@/src/theme/tokens";

type Tab = "continue" | "saved" | "downloads";

export default function LibraryScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { playChapter } = usePlayer();
  const { records, supported } = useDownloads();
  const bottomPadding = useBottomPadding(true);

  const [tab, setTab] = useState<Tab>("continue");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [continueItems, setContinueItems] = useState<ContinueItem[]>([]);
  const [saved, setSaved] = useState<Novel[]>([]);

  const load = useCallback(async () => {
    try {
      const [cont, savedList] = await Promise.all([
        api.continueListening().catch(() => []),
        api.saved().catch(() => []),
      ]);
      setContinueItems(cont);
      setSaved(savedList);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const downloadGroups = useMemo(() => {
    const groups = new Map<
      string,
      { novel_id: string; novel_title: string; chapters: number; bytes: number }
    >();
    Object.values(records).forEach((rec) => {
      if (rec.state !== "complete") return;
      const existing = groups.get(rec.novel_id) ?? {
        novel_id: rec.novel_id,
        novel_title: rec.novel_title,
        chapters: 0,
        bytes: 0,
      };
      existing.chapters += 1;
      existing.bytes += rec.file_size;
      groups.set(rec.novel_id, existing);
    });
    return Array.from(groups.values());
  }, [records]);

  const resume = async (item: ContinueItem) => {
    if (!item.chapter) {
      router.push(`/novel/${item.novel.id}`);
      return;
    }
    try {
      const chapters = await api.chapters(item.novel.id);
      const index = chapters.findIndex((c) => c.id === item.chapter?.id);
      playChapter(item.novel, chapters, index < 0 ? 0 : index, item.position_seconds);
      router.push("/player");
    } catch {
      toast("Could not start playback", "error");
    }
  };

  const unsave = async (novel: Novel) => {
    try {
      await api.unsave(novel.id);
      setSaved((prev) => prev.filter((n) => n.id !== novel.id));
      toast(`Removed “${novel.title}” from saved`, "info");
    } catch {
      toast("Could not update saved list", "error");
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm, borderColor: colors.divider }]}>
        <Text style={[styles.title, { color: colors.onSurface }]}>Library</Text>
        <SegmentedControl<Tab>
          testIDPrefix="library-tab"
          value={tab}
          onChange={setTab}
          options={[
            { key: "continue", label: "Continue" },
            { key: "saved", label: "Saved" },
            { key: "downloads", label: "Downloads" },
          ]}
        />
      </View>

      <ScrollView
        testID="library-scroll"
        contentContainerStyle={[styles.body, { paddingBottom: bottomPadding }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : tab === "continue" ? (
          continueItems.length === 0 ? (
            <EmptyState
              testID="library-empty-continue"
              icon="headphones"
              title="Nothing in progress"
              message="Start any chapter and it will show up here so you can pick up where you left off."
              actionLabel="Browse the catalog"
              onAction={() => router.push("/(tabs)/explore")}
            />
          ) : (
            continueItems.map((item) => (
              <NovelListRow
                key={item.novel.id}
                testID={`library-continue-${item.novel.id}`}
                novel={item.novel}
                subtitle={
                  item.chapter
                    ? `Ch. ${item.chapter.chapter_number} · ${formatDuration(item.position_seconds)}`
                    : item.novel.author
                }
                right={
                  <Pressable
                    testID={`library-resume-${item.novel.id}`}
                    onPress={() => resume(item)}
                    hitSlop={8}
                    style={[styles.iconBtn, { backgroundColor: colors.brand }]}
                  >
                    <Feather name="play" size={16} color={colors.onBrand} />
                  </Pressable>
                }
              />
            ))
          )
        ) : tab === "saved" ? (
          saved.length === 0 ? (
            <EmptyState
              testID="library-empty-saved"
              icon="bookmark"
              title="No saved novels yet"
              message="Tap the bookmark on any novel to keep it here for later."
              actionLabel="Find something to read"
              onAction={() => router.push("/(tabs)/explore")}
            />
          ) : (
            saved.map((novel) => (
              <NovelListRow
                key={novel.id}
                testID={`library-saved-${novel.id}`}
                novel={novel}
                right={
                  <Pressable
                    testID={`library-unsave-${novel.id}`}
                    onPress={() => unsave(novel)}
                    hitSlop={8}
                    style={[styles.iconBtn, { backgroundColor: colors.surfaceTertiary }]}
                  >
                    <Feather name="bookmark" size={16} color={colors.brand} />
                  </Pressable>
                }
              />
            ))
          )
        ) : downloadGroups.length === 0 ? (
          <EmptyState
            testID="library-empty-downloads"
            icon="download"
            title={supported ? "No downloads yet" : "Downloads live on your phone"}
            message={
              supported
                ? "Tap the download icon next to any chapter to keep it offline."
                : "Open LightListen in Expo Go or an installed build to download chapters for offline listening."
            }
            actionLabel={supported ? "Manage storage" : undefined}
            onAction={supported ? () => router.push("/downloads") : undefined}
          />
        ) : (
          <>
            {downloadGroups.map((group) => (
              <Pressable
                key={group.novel_id}
                testID={`library-download-${group.novel_id}`}
                onPress={() => router.push(`/novel/${group.novel_id}`)}
                style={[
                  styles.downloadRow,
                  { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                ]}
              >
                <View style={[styles.downloadIcon, { backgroundColor: colors.brandTertiary }]}>
                  <Feather name="download" size={18} color={colors.onBrandTertiary} />
                </View>
                <View style={styles.downloadBody}>
                  <Text numberOfLines={1} style={[styles.downloadTitle, { color: colors.onSurface }]}>
                    {group.novel_title}
                  </Text>
                  <Text style={[styles.downloadMeta, { color: colors.onSurfaceSecondary }]}>
                    {group.chapters} chapter{group.chapters === 1 ? "" : "s"} · {formatBytes(group.bytes)}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.onSurfaceSecondary} />
              </Pressable>
            ))}
            <Pressable
              testID="library-manage-storage"
              onPress={() => router.push("/downloads")}
              style={[styles.manage, { borderColor: colors.border }]}
            >
              <Feather name="hard-drive" size={16} color={colors.brand} />
              <Text style={[styles.manageText, { color: colors.brand }]}>Manage storage</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontFamily: fonts.display, fontSize: fontSize.xxl },
  body: { padding: spacing.lg, gap: spacing.sm },
  center: { paddingVertical: spacing.xxxl, alignItems: "center" },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  downloadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  downloadIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  downloadBody: { flex: 1, gap: 2 },
  downloadTitle: { fontFamily: fonts.semibold, fontSize: fontSize.lg },
  downloadMeta: { fontFamily: fonts.regular, fontSize: fontSize.sm },
  manage: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 46,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
  },
  manageText: { fontFamily: fonts.semibold, fontSize: fontSize.base },
});
