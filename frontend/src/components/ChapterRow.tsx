import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type { Chapter } from "@/src/api/types";
import { useDownloads } from "@/src/context/DownloadsContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, formatDuration, radius, spacing } from "@/src/theme/tokens";

type Props = {
  chapter: Chapter;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  isCompleted?: boolean;
  onPress: () => void;
  onDownload: () => void;
};

export function ChapterRow({
  chapter,
  index,
  isCurrent,
  isPlaying,
  isCompleted = false,
  onPress,
  onDownload,
}: Props) {
  const { colors } = useTheme();
  const { getRecord, supported } = useDownloads();
  const record = getRecord(chapter.id);

  const downloadIcon = () => {
    if (!record) return <Feather name="download" size={18} color={colors.onSurfaceSecondary} />;
    if (record.state === "complete")
      return <Feather name="check-circle" size={18} color={colors.success} />;
    if (record.state === "failed")
      return <Feather name="alert-circle" size={18} color={colors.error} />;
    return (
      <View style={styles.progressWrap}>
        <ActivityIndicator size="small" color={colors.brand} />
        <Text style={[styles.progressText, { color: colors.brand }]}>
          {Math.round((record.progress ?? 0) * 100)}%
        </Text>
      </View>
    );
  };

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: isCurrent ? colors.surfaceTertiary : "transparent",
          borderColor: colors.divider,
        },
      ]}
    >
      <Pressable
        testID={`chapter-row-${chapter.id}`}
        onPress={() => {
          if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        style={styles.main}
      >
        <View
          style={[
            styles.number,
            {
              borderColor: isCurrent
                ? colors.brand
                : isCompleted
                  ? colors.success
                  : colors.border,
            },
          ]}
        >
          {isCurrent && isPlaying ? (
            <Feather name="volume-2" size={14} color={colors.brand} />
          ) : isCompleted ? (
            <Feather name="check" size={15} color={colors.success} />
          ) : (
            <Text
              style={[styles.numberText, { color: isCurrent ? colors.brand : colors.onSurfaceSecondary }]}
            >
              {chapter.chapter_number || index + 1}
            </Text>
          )}
        </View>
        <View style={styles.body}>
          <Text
            numberOfLines={2}
            style={[styles.title, { color: isCurrent ? colors.brand : colors.onSurface }]}
          >
            {chapter.title}
          </Text>
          <View style={styles.metaRow}>
            <Feather name="clock" size={11} color={colors.onSurfaceSecondary} />
            <Text style={[styles.meta, { color: colors.onSurfaceSecondary }]}>
              {formatDuration(chapter.duration_seconds)}
            </Text>
            {record?.state === "complete" ? (
              <>
                <Text style={[styles.meta, { color: colors.onSurfaceSecondary }]}>·</Text>
                <Text style={[styles.meta, { color: colors.success }]}>Offline</Text>
              </>
            ) : null}
          </View>
        </View>
      </Pressable>
      <Pressable
        testID={`chapter-download-${chapter.id}`}
        onPress={() => {
          if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onDownload();
        }}
        hitSlop={8}
        style={styles.action}
        disabled={record?.state === "downloading" || record?.state === "queued"}
      >
        {supported || !record ? downloadIcon() : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingRight: spacing.xs,
  },
  main: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.sm,
    minHeight: 60,
  },
  number: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: { fontFamily: fonts.semibold, fontSize: fontSize.base },
  body: { flex: 1, gap: 3 },
  title: { fontFamily: fonts.medium, fontSize: fontSize.lg - 1, lineHeight: 20 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  meta: { fontFamily: fonts.regular, fontSize: fontSize.sm },
  action: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  progressWrap: { alignItems: "center", gap: 2 },
  progressText: { fontFamily: fonts.semibold, fontSize: 9 },
});
