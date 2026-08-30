import { Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, spacing } from "@/src/theme/tokens";

export default function Index() {
  const { user, booting } = useAuth();
  const { colors } = useTheme();

  if (booting) {
    return (
      <View testID="boot-screen" style={[styles.container, { backgroundColor: colors.surface }]}>
        <Text style={[styles.wordmark, { color: colors.onSurface }]}>LightListen</Text>
        <Text style={[styles.tagline, { color: colors.onSurfaceSecondary }]}>
          Light novels, narrated.
        </Text>
        <ActivityIndicator color={colors.brand} style={styles.spinner} />
      </View>
    );
  }

  return user ? <Redirect href="/(tabs)" /> : <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  wordmark: { fontFamily: fonts.display, fontSize: fontSize.xxl + 6, letterSpacing: 0.4 },
  tagline: { fontFamily: fonts.regular, fontSize: fontSize.base },
  spinner: { marginTop: spacing.lg },
});
