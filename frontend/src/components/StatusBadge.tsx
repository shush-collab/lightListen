import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { RequestStatus } from "@/src/api/types";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const LABELS: Record<RequestStatus, string> = {
  requested: "Requested",
  selected: "Selected",
  processing: "In production",
  published: "Published",
  rejected: "Not planned",
};

export function StatusBadge({ status, testID }: { status: RequestStatus; testID?: string }) {
  const { colors } = useTheme();
  const tint =
    status === "published"
      ? colors.success
      : status === "processing" || status === "selected"
        ? colors.warning
        : status === "rejected"
          ? colors.error
          : colors.info;

  return (
    <View testID={testID} style={[styles.badge, { borderColor: tint, backgroundColor: `${tint}22` }]}>
      <Text style={[styles.text, { color: tint }]}>{LABELS[status] ?? status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "flex-start",
  },
  text: { fontFamily: fonts.semibold, fontSize: fontSize.sm - 1, letterSpacing: 0.3 },
});
