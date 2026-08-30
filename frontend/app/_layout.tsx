import { useFonts } from "expo-font";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { LogBox, Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { MiniPlayer } from "@/src/components/MiniPlayer";
import { PushNudge } from "@/src/components/PushNudge";
import { AuthProvider, useAuth } from "@/src/context/AuthContext";
import { DownloadsProvider } from "@/src/context/DownloadsContext";
import { PlayerProvider } from "@/src/context/PlayerContext";
import { ToastProvider } from "@/src/context/ToastContext";
import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { refreshPushRegistration } from "@/src/push";
import { ThemeProvider, useTheme } from "@/src/theme/ThemeProvider";
import { storage } from "@/src/utils/storage";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

// Foreground presentation — module scope, before any component renders.
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// Android channel must exist before the first push arrives.
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
  });
}

const NUDGE_KEY = "lightlisten.pushNudgeAt";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Keep the native splash visible from cold start until icon fonts register.
// Required because @expo/vector-icons' componentDidMount fallback fires
// Font.loadAsync against a broken vendor path if any <Icon> mounts before
// the family is registered — which throws on Android Expo Go.
SplashScreen.preventAutoHideAsync();

function Shell() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const [nudge, setNudge] = useState(false);

  // Device tokens rotate — re-register whenever we have a signed-in user.
  useEffect(() => {
    if (user) void refreshPushRegistration();
  }, [user]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const openTarget = (data: Record<string, unknown> | undefined) => {
      const url = (data?.deeplink ?? data?.action_url) as string | undefined;
      if (!url) return;
      if (url.startsWith("http")) void Linking.openURL(url);
      else router.push(url as never);
    };

    // Warm tap — app already open.
    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      openTarget(response.notification.request.content.data as Record<string, unknown>);
    });

    // Cold start — app was killed when the notification was tapped.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      openTarget(response.notification.request.content.data as Record<string, unknown>);
    });

    // Weekly nudge for permanently denied permission (the OS will not re-prompt).
    void (async () => {
      try {
        const { status, canAskAgain } = await Notifications.getPermissionsAsync();
        if (status !== "denied" || canAskAgain) return;
        const last = await storage.getItem<string>(NUDGE_KEY, "");
        if (last && Date.now() - Number(last) <= ONE_WEEK_MS) return;
        setNudge(true);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      tapSub.remove();
    };
  }, [router]);

  const dismissNudge = () => {
    setNudge(false);
    void storage.setItem(NUDGE_KEY, String(Date.now()));
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.surface },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="novel/[id]" />
        <Stack.Screen
          name="player"
          options={{ presentation: "modal", animation: "slide_from_bottom" }}
        />
        <Stack.Screen name="requests" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="downloads" />
        <Stack.Screen name="pro" />
      </Stack>
      <MiniPlayer />
      <PushNudge visible={nudge} onDismiss={dismissNudge} />
    </View>
  );
}

export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();
  const [fontsLoaded, fontsError] = useFonts({
    "PlayfairDisplay-Regular": require("../assets/fonts/PlayfairDisplay-Regular.ttf"),
    "PlayfairDisplay-Bold": require("../assets/fonts/PlayfairDisplay-Bold.ttf"),
    "Manrope-Regular": require("../assets/fonts/Manrope-Regular.ttf"),
    "Manrope-Medium": require("../assets/fonts/Manrope-Medium.ttf"),
    "Manrope-SemiBold": require("../assets/fonts/Manrope-SemiBold.ttf"),
    "Manrope-Bold": require("../assets/fonts/Manrope-Bold.ttf"),
  });

  const iconsReady = iconsLoaded || Boolean(iconsError);
  const fontsReady = fontsLoaded || Boolean(fontsError);

  useEffect(() => {
    if (iconsReady && fontsReady) SplashScreen.hideAsync();
  }, [iconsReady, fontsReady]);

  // If the CDN is unreachable we fall through on error rather than wedging
  // the app — icons will tofu, but the app still boots.
  if (!iconsReady || !fontsReady) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ThemeProvider>
            <ToastProvider>
              <AuthProvider>
                <DownloadsProvider>
                  <PlayerProvider>
                    <Shell />
                  </PlayerProvider>
                </DownloadsProvider>
              </AuthProvider>
            </ToastProvider>
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
