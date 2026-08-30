import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/src/components/States";
import { DownloadRecord, useDownloads } from "@/src/context/DownloadsContext";
import { useToast } from "@/src/context/ToastContext";
import { useBottomPadding } from "@/src/hooks/use-bottom-padding";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, formatBytes, formatDuration, radius, spacing } from "@/src/theme/tokens";

type Group = { novel_id: string; novel_title: string; bytes: number; chapters: DownloadRecord[] };

export default function DownloadsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { records, remove, removeNovel, totalBytes, supported } = useDownloads();
  const bottomPadding = useBottomPadding(false);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    Object.values(records).forEach((rec) => {
      const group = map.get(rec.novel_id) ?? {
        novel_id: rec.novel_id,
        novel_title: rec.novel_title,
        bytes: 0,
        chapters: [],
      };
      group.chapters.push(rec);
      if (rec.state === "complete") group.bytes += rec.file_size;
      map.set(rec.novel_id, group);
    });
    return Array.from(map.values()).map((g) => ({
      ...g,
      chapters: g.chapters.sort((a, b) => a.chapter_number - b.chapter_number),
    }));
  }, [records]);

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm, borderColor: colors.divider }]}>
        <Pressable
          testID="downloads-back"
          onPress={() => router.back()}
          hitSlop={10}
          style={[styles.circle, { backgroundColor: colors.surfaceSecondary }]}
        >
          <Feather name="chevron-left" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={[styles.title, { color: colors.onSurface }]}>Storage</Text>
        <View style={styles.circle} />
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: bottomPadding }]}>
        <View style={[styles.summary, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Feather name="hard-drive" size={20} color={colors.brand} />
          <View style={styles.summaryText}>
            <Text testID="downloads-total" style={[styles.summaryValue, { color: colors.onSurface }]}>
              {formatBytes(totalBytes)} used
            </Text>
            <Text style={[styles.summaryMeta, { color: colors.onSurfaceSecondary }]}>
              {Object.keys(records).length} chapter
              {Object.keys(records).length === 1 ? "" : "s"} across {groups.length} novel
              {groups.length === 1 ? "" : "s"}
            </Text>
          </View>
        </View>

        {groups.length === 0 ? (
          <EmptyState
            testID="downloads-empty"
            icon="download"
            title={supported ? "Nothing downloaded" : "Downloads live on your phone"}
            message={
              supported
                ? "Chapters you download appear here so you can free up space any time."
                : "Open the app in Expo Go or an installed build to download chapters for offline listening."
            }
          />
        ) : (
          groups.map((group) => (
            <View
              key={group.novel_id}
              style={[styles.group, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
            >
              <View style={styles.groupHeader}>
                <View style={styles.groupHeaderText}>
                  <Text numberOfLines={1} style={[styles.groupTitle, { color: colors.onSurface }]}>
                    {group.novel_title}
                  </Text>
                  <Text style={[styles.groupMeta, { color: colors.onSurfaceSecondary }]}>
                    {group.chapters.length} chapter{group.chapters.length === 1 ? "" : "s"} ·{" "}
                    {formatBytes(group.bytes)}
                  </Text>
                </View>
                <Pressable
                  testID={`downloads-delete-novel-${group.novel_id}`}
                  onPress={async () => {
                    await removeNovel(group.novel_id);
                    toast(`Removed downloads for “${group.novel_title}”`, "info");
                  }}
                  hitSlop={8}
                  style={[styles.deleteAll, { borderColor: colors.error }]}
                >
                  <Feather name="trash-2" size={14} color={colors.error} />
                  <Text style={[styles.deleteAllText, { color: colors.error }]}>All</Text>
                </Pressable>
              </View>

              {group.chapters.map((rec) => (
                <View key={rec.chapter_id} style={[styles.chapter, { borderColor: colors.divider }]}>
                  <View style={styles.chapterBody}>
                    <Text numberOfLines={1} style={[styles.chapterTitle, { color: colors.onSurface }]}>
                      {rec.chapter_number}. {rec.chapter_title}
                    </Text>
                    <Text style={[styles.chapterMeta, { color: colors.onSurfaceSecondary }]}>
                      {rec.state === "complete"
                        ? `${formatBytes(rec.file_size)} · ${formatDuration(rec.duration_seconds)}`
                        : rec.state === "failed"
                          ? rec.error ?? "Download failed"
                          : `${Math.round(rec.progress * 100)}% downloaded`}
                    </Text>
                  </View>
                  <Pressable
                    testID={`downloads-delete-chapter-${rec.chapter_id}`}
                    onPress={async () => {
                      await remove(rec.chapter_id);
                      toast("Chapter removed from device", "info");
                    }}
                    hitSlop={8}
                    style={styles.deleteBtn}
                  >
                    <Feather name="trash-2" size={16} color={colors.error} />
                  </Pressable>
                </View>
              ))}

              <Pressable
                testID={`downloads-open-novel-${group.novel_id}`}
                onPress={() => router.push(`/novel/${group.novel_id}`)}
                style={styles.openNovel}
              >
                <Text style={[styles.openNovelText, { color: colors.brand }]}>Open novel</Text>
                <Feather name="arrow-right" size={13} color={colors.brand} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontFamily: fonts.display, fontSize: fontSize.xl },
  circle: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  body: { padding: spacing.lg, gap: spacing.lg },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  summaryText: { flex: 1, gap: 2 },
  summaryValue: { fontFamily: fonts.semibold, fontSize: fontSize.xl },
  summaryMeta: { fontFamily: fonts.regular, fontSize: fontSize.sm },
  group: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.xs,
  },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xs },
  groupHeaderText: { flex: 1, gap: 2 },
  groupTitle: { fontFamily: fonts.semibold, fontSize: fontSize.lg },
  groupMeta: { fontFamily: fonts.regular, fontSize: fontSize.sm },
  deleteAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  deleteAllText: { fontFamily: fonts.semibold, fontSize: fontSize.sm },
  chapter: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  chapterBody: { flex: 1, gap: 2 },
  chapterTitle: { fontFamily: fonts.medium, fontSize: fontSize.base },
  chapterMeta: { fontFamily: fonts.regular, fontSize: fontSize.sm },
  deleteBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  openNovel: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingTop: spacing.xs },
  openNovelText: { fontFamily: fonts.semibold, fontSize: fontSize.base },
});
