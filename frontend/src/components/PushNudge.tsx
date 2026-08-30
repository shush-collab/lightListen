import { Feather } from "@expo/vector-icons";
import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { Sheet } from "@/src/components/Sheet";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

/**
 * Shown at most once a week when notifications were permanently denied — the OS
 * refuses to re-prompt, so the only route left is system settings.
 */
export function PushNudge({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const { colors } = useTheme();

  return (
    <Sheet visible={visible} onClose={onDismiss} title="Turn notifications back on?" testID="push-nudge">
      <View style={styles.body}>
        <View style={[styles.icon, { backgroundColor: colors.brandTertiary }]}>
          <Feather name="bell-off" size={20} color={colors.onBrandTertiary} />
        </View>
        <Text style={[styles.text, { color: colors.onSurfaceSecondary }]}>
          Notifications are blocked, so we can&apos;t tell you when a novel you voted for is ready.
          You can switch them on in your device settings.
        </Text>
      </View>
      <Pressable
        testID="push-nudge-settings"
        onPress={() => {
          void Linking.openSettings();
          onDismiss();
        }}
        style={[styles.cta, { backgroundColor: colors.brand }]}
      >
        <Feather name="settings" size={16} color={colors.onBrand} />
        <Text style={[styles.ctaText, { color: colors.onBrand }]}>Open Settings</Text>
      </Pressable>
      <Pressable testID="push-nudge-later" onPress={onDismiss} style={styles.later}>
        <Text style={[styles.laterText, { color: colors.onSurfaceSecondary }]}>Later</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, fontFamily: fonts.regular, fontSize: fontSize.base, lineHeight: 20 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  ctaText: { fontFamily: fonts.semibold, fontSize: fontSize.lg },
  later: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  laterText: { fontFamily: fonts.medium, fontSize: fontSize.base },
});
