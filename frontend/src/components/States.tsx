import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

export function EmptyState({
  icon = "inbox",
  title,
  message,
  actionLabel,
  onAction,
  testID,
}: {
  icon?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={styles.wrap}>
      <View style={[styles.badge, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <Feather name={icon as never} size={26} color={colors.brand} />
      </View>
      <Text style={[styles.title, { color: colors.onSurface }]}>{title}</Text>
      {message ? (
        <Text style={[styles.message, { color: colors.onSurfaceSecondary }]}>{message}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable
          testID={`${testID}-action`}
          onPress={onAction}
          style={[styles.action, { backgroundColor: colors.brand }]}
        >
          <Text style={[styles.actionText, { color: colors.onBrand }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ErrorState({ message, onRetry, testID }: { message: string; onRetry: () => void; testID: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={styles.wrap}>
      <View style={[styles.badge, { backgroundColor: colors.surfaceSecondary, borderColor: colors.error }]}>
        <Feather name="wifi-off" size={24} color={colors.error} />
      </View>
      <Text style={[styles.title, { color: colors.onSurface }]}>Something went wrong</Text>
      <Text style={[styles.message, { color: colors.onSurfaceSecondary }]}>{message}</Text>
      <Pressable
        testID={`${testID}-retry`}
        onPress={onRetry}
        style={[styles.action, { backgroundColor: colors.brand }]}
      >
        <Text style={[styles.actionText, { color: colors.onBrand }]}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  badge: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontFamily: fonts.display, fontSize: fontSize.xl, textAlign: "center" },
  message: { fontFamily: fonts.regular, fontSize: fontSize.base, textAlign: "center", lineHeight: 20, maxWidth: 320 },
  action: {
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  actionText: { fontFamily: fonts.semibold, fontSize: fontSize.lg },
});
