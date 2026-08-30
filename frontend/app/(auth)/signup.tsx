import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

export default function SignupScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { signUp } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast("What should we call you?", "error");
    if (!email.trim()) return toast("Enter your email", "error");
    if (password.length < 8) return toast("Password needs at least 8 characters", "error");
    setBusy(true);
    try {
      await signUp(email, password, name);
      router.replace("/(tabs)");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create account", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <KeyboardAwareScrollView
        bottomOffset={32}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
        ]}
      >
        <Pressable testID="signup-back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Feather name="chevron-left" size={22} color={colors.onSurface} />
        </Pressable>

        <Text style={[styles.wordmark, { color: colors.onSurface }]}>Create account</Text>
        <Text style={[styles.tagline, { color: colors.onSurfaceSecondary }]}>
          Save your place, download chapters and vote on what gets narrated next.
        </Text>

        <View style={styles.form}>
          <View>
            <Text style={[styles.label, { color: colors.onSurfaceSecondary }]}>Display name</Text>
            <TextInput
              testID="signup-name-input"
              value={name}
              onChangeText={setName}
              placeholder="Kaito"
              placeholderTextColor={colors.onSurfaceSecondary}
              style={[
                styles.input,
                { backgroundColor: colors.surfaceSecondary, color: colors.onSurface, borderColor: colors.border },
              ]}
            />
          </View>
          <View>
            <Text style={[styles.label, { color: colors.onSurfaceSecondary }]}>Email</Text>
            <TextInput
              testID="signup-email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.onSurfaceSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              style={[
                styles.input,
                { backgroundColor: colors.surfaceSecondary, color: colors.onSurface, borderColor: colors.border },
              ]}
            />
          </View>
          <View>
            <Text style={[styles.label, { color: colors.onSurfaceSecondary }]}>
              Password (8+ characters)
            </Text>
            <TextInput
              testID="signup-password-input"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.onSurfaceSecondary}
              secureTextEntry
              autoCapitalize="none"
              onSubmitEditing={submit}
              returnKeyType="go"
              style={[
                styles.input,
                { backgroundColor: colors.surfaceSecondary, color: colors.onSurface, borderColor: colors.border },
              ]}
            />
          </View>

          <Pressable
            testID="signup-submit-button"
            onPress={submit}
            disabled={busy}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: colors.brand, opacity: pressed || busy ? 0.85 : 1 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onBrand} />
            ) : (
              <Text style={[styles.ctaText, { color: colors.onBrand }]}>Start listening</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  back: { width: 40, height: 40, justifyContent: "center", marginBottom: spacing.sm },
  wordmark: { fontFamily: fonts.display, fontSize: fontSize.xxl + 4 },
  tagline: { fontFamily: fonts.regular, fontSize: fontSize.lg, lineHeight: 23, marginBottom: spacing.xl },
  form: { gap: spacing.lg },
  label: { fontFamily: fonts.medium, fontSize: fontSize.sm, marginBottom: spacing.xs, letterSpacing: 0.3 },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.regular,
    fontSize: fontSize.lg,
  },
  cta: {
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  ctaText: { fontFamily: fonts.semibold, fontSize: fontSize.lg },
});
