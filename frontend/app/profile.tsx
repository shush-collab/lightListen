import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SegmentedControl } from "@/src/components/Chips";
import { useAuth } from "@/src/context/AuthContext";
import { AutoDownloadSetting, useDownloads } from "@/src/context/DownloadsContext";
import { usePlayer } from "@/src/context/PlayerContext";
import { useToast } from "@/src/context/ToastContext";
import { useBottomPadding } from "@/src/hooks/use-bottom-padding";
import { enablePush, getPushStatus } from "@/src/push";
import { ThemeMode, useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, formatBytes, radius, spacing } from "@/src/theme/tokens";

export default function ProfileScreen() {
  const { colors, mode, setMode } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user, signOut } = useAuth();
  const { totalBytes, records, autoDownloadNext, setAutoDownloadNext } = useDownloads();
  const { stop } = usePlayer();
  const bottomPadding = useBottomPadding(false);

  const [pushGranted, setPushGranted] = useState(false);

  useEffect(() => {
    void getPushStatus().then((state) => setPushGranted(state.granted));
  }, []);

  const toggleNotifications = async () => {
    if (!user) return;
    if (pushGranted) {
      toast("Notifications are on — manage them in system settings", "info");
      void Linking.openSettings();
      return;
    }
    const outcome = await enablePush();
    if (outcome === "granted") {
      setPushGranted(true);
      toast("Notifications on — we'll ping you when a novel you voted for lands", "success");
    } else if (outcome === "blocked") {
      toast("Notifications are blocked in system settings", "error");
      void Linking.openSettings();
    } else if (outcome === "unsupported") {
      toast("Notifications need the installed app, not the web preview", "info");
    } else {
      toast("No problem — you can switch them on any time", "info");
    }
  };

  const downloadCount = Object.values(records).filter((r) => r.state === "complete").length;
  const initials = (user?.display_name || user?.email || "?").trim().charAt(0).toUpperCase();

  const changeTheme = (next: ThemeMode) => {
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setMode(next);
  };

  const logout = async () => {
    stop();
    await signOut();
    toast("Signed out", "info");
    router.replace("/(auth)/login");
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm, borderColor: colors.divider }]}>
        <Pressable
          testID="profile-back"
          onPress={() => router.back()}
          hitSlop={10}
          style={[styles.circle, { backgroundColor: colors.surfaceSecondary }]}
        >
          <Feather name="chevron-left" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={[styles.title, { color: colors.onSurface }]}>Profile</Text>
        <View style={styles.circle} />
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: bottomPadding }]}>
        <View style={[styles.card, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.brandTertiary, borderColor: colors.brand }]}>
            <Text style={[styles.avatarText, { color: colors.onBrandTertiary }]}>{initials}</Text>
          </View>
          <View style={styles.accountText}>
            <Text testID="profile-name" style={[styles.name, { color: colors.onSurface }]}>
              {user?.display_name ?? "Reader"}
            </Text>
            <Text testID="profile-email" style={[styles.email, { color: colors.onSurfaceSecondary }]}>
              {user?.email}
            </Text>
            <View style={[styles.planTag, { backgroundColor: colors.surfaceTertiary }]}>
              <Feather name="user" size={11} color={colors.onSurfaceSecondary} />
              <Text style={[styles.planText, { color: colors.onSurfaceSecondary }]}>
                Free plan{user?.role === "admin" ? " · Admin" : ""}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Appearance</Text>
          <SegmentedControl<ThemeMode>
            testIDPrefix="theme-option"
            value={mode}
            onChange={changeTheme}
            options={[
              { key: "light", label: "Bookish", icon: "sun" },
              { key: "dark", label: "Cinematic", icon: "moon" },
              { key: "system", label: "System", icon: "smartphone" },
            ]}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
            Keep upcoming chapters offline
          </Text>
          <SegmentedControl<"0" | "1" | "2">
            testIDPrefix="auto-download"
            value={String(autoDownloadNext) as "0" | "1" | "2"}
            onChange={(key) => setAutoDownloadNext(Number(key) as AutoDownloadSetting)}
            options={[
              { key: "0", label: "Off" },
              { key: "1", label: "1 chapter" },
              { key: "2", label: "2 chapters" },
            ]}
          />
          <Text style={[styles.hint, { color: colors.onSurfaceSecondary }]}>
            Quietly caches what you are about to hear next and clears it once you have moved on.
            Chapters you download yourself are never removed.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Notifications</Text>
          <Row
            testID="profile-notifications-row"
            icon={pushGranted ? "bell" : "bell-off"}
            title={pushGranted ? "Notifications are on" : "Turn on notifications"}
            subtitle={
              pushGranted
                ? "You'll hear when a novel you voted for is published"
                : "Get told when a novel you voted for is ready"
            }
            onPress={() => void toggleNotifications()}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Library</Text>
          <Row
            testID="profile-storage-row"
            icon="hard-drive"
            title="Storage & downloads"
            subtitle={`${downloadCount} chapter${downloadCount === 1 ? "" : "s"} · ${formatBytes(totalBytes)}`}
            onPress={() => router.push("/downloads")}
          />
          <Row
            testID="profile-requests-row"
            icon="trending-up"
            title="Community requests"
            subtitle="Vote on what gets narrated next"
            onPress={() => router.push("/requests")}
          />
        </View>

        <Pressable
          testID="profile-pro-banner"
          onPress={() => router.push("/pro")}
          style={[styles.pro, { backgroundColor: colors.surfaceTertiary, borderColor: colors.brand }]}
        >
          <View style={styles.proTop}>
            <Feather name="award" size={18} color={colors.brand} />
            <Text style={[styles.proTitle, { color: colors.onSurface }]}>LightListen Pro</Text>
            <View style={[styles.soon, { backgroundColor: colors.brand }]}>
              <Text style={[styles.soonText, { color: colors.onBrand }]}>Coming soon</Text>
            </View>
          </View>
          <Text style={[styles.proBody, { color: colors.onSurfaceSecondary }]}>
            Anytime requests, private EPUB audiobooks and unlimited offline chapters.
          </Text>
          <View style={styles.proCta}>
            <Text style={[styles.proCtaText, { color: colors.brand }]}>See what is coming</Text>
            <Feather name="arrow-right" size={14} color={colors.brand} />
          </View>
        </Pressable>

        <Pressable
          testID="profile-logout-button"
          onPress={logout}
          style={[styles.logout, { borderColor: colors.error }]}
        >
          <Feather name="log-out" size={16} color={colors.error} />
          <Text style={[styles.logoutText, { color: colors.error }]}>Log out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Row({
  testID,
  icon,
  title,
  subtitle,
  onPress,
}: {
  testID: string;
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: colors.surfaceTertiary }]}>
        <Feather name={icon as never} size={17} color={colors.brand} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: colors.onSurface }]}>{title}</Text>
        <Text style={[styles.rowSub, { color: colors.onSurfaceSecondary }]}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.onSurfaceSecondary} />
    </Pressable>
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
  body: { padding: spacing.lg, gap: spacing.xl },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: fonts.bold, fontSize: fontSize.xxl },
  accountText: { flex: 1, gap: spacing.xs },
  name: { fontFamily: fonts.display, fontSize: fontSize.xl },
  email: { fontFamily: fonts.regular, fontSize: fontSize.base },
  planTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  planText: { fontFamily: fonts.medium, fontSize: fontSize.sm - 1 },
  section: { gap: spacing.sm },
  sectionTitle: { fontFamily: fonts.display, fontSize: fontSize.lg, marginBottom: spacing.xs },
  hint: { fontFamily: fonts.regular, fontSize: fontSize.sm, lineHeight: 18 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.semibold, fontSize: fontSize.lg - 1 },
  rowSub: { fontFamily: fonts.regular, fontSize: fontSize.sm },
  pro: { padding: spacing.lg, borderRadius: radius.md, borderLeftWidth: 3, gap: spacing.sm },
  proTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  proTitle: { flex: 1, fontFamily: fonts.display, fontSize: fontSize.xl },
  soon: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  soonText: { fontFamily: fonts.semibold, fontSize: fontSize.sm - 2 },
  proBody: { fontFamily: fonts.regular, fontSize: fontSize.base, lineHeight: 20 },
  proCta: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  proCtaText: { fontFamily: fonts.semibold, fontSize: fontSize.base },
  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 50,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  logoutText: { fontFamily: fonts.semibold, fontSize: fontSize.lg },
});
