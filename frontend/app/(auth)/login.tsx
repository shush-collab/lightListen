import { Feather } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

export default function LoginScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secure, setSecure] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      toast("Enter your email and password", "error");
      return;
    }
    setBusy(true);
    try {
      await signIn(email, password);
      router.replace("/(tabs)");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not sign in", "error");
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
          { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl },
        ]}
      >
        <Text style={[styles.wordmark, { color: colors.onSurface }]}>LightListen</Text>
        <Text style={[styles.tagline, { color: colors.onSurfaceSecondary }]}>
          Your light novels, narrated. Pick up exactly where you left off.
        </Text>

        <View style={styles.form}>
          <View>
            <Text style={[styles.label, { color: colors.onSurfaceSecondary }]}>Email</Text>
            <TextInput
              testID="login-email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.onSurfaceSecondary}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              style={[
                styles.input,
                { backgroundColor: colors.surfaceSecondary, color: colors.onSurface, borderColor: colors.border },
              ]}
            />
          </View>

          <View>
            <Text style={[styles.label, { color: colors.onSurfaceSecondary }]}>Password</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                testID="login-password-input"
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.onSurfaceSecondary}
                secureTextEntry={secure}
                autoCapitalize="none"
                onSubmitEditing={submit}
                returnKeyType="go"
                style={[
                  styles.input,
                  styles.passwordInput,
                  { backgroundColor: colors.surfaceSecondary, color: colors.onSurface, borderColor: colors.border },
                ]}
              />
              <Pressable
                testID="login-toggle-secure"
                onPress={() => setSecure((s) => !s)}
                hitSlop={10}
                style={styles.eye}
              >
                <Feather name={secure ? "eye" : "eye-off"} size={18} color={colors.onSurfaceSecondary} />
              </Pressable>
            </View>
          </View>

          <Pressable
            testID="login-submit-button"
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
              <Text style={[styles.ctaText, { color: colors.onBrand }]}>Sign in</Text>
            )}
          </Pressable>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.onSurfaceSecondary }]}>
              New to LightListen?
            </Text>
            <Link href="/(auth)/signup" asChild>
              <Pressable testID="login-goto-signup">
                <Text style={[styles.footerLink, { color: colors.brand }]}>Create an account</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  wordmark: { fontFamily: fonts.display, fontSize: fontSize.xxxl, letterSpacing: 0.3 },
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
  passwordWrap: { position: "relative", justifyContent: "center" },
  passwordInput: { paddingRight: 52 },
  eye: { position: "absolute", right: spacing.lg, height: 44, justifyContent: "center" },
  cta: {
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  ctaText: { fontFamily: fonts.semibold, fontSize: fontSize.lg },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs },
  footerText: { fontFamily: fonts.regular, fontSize: fontSize.base },
  footerLink: { fontFamily: fonts.semibold, fontSize: fontSize.base },
});
