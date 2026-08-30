import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import React, { useEffect } from "react";
import { Platform } from "react-native";

import { useAuth } from "@/src/context/AuthContext";
import { usePlayer } from "@/src/context/PlayerContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, WEB_TAB_BAR_HEIGHT } from "@/src/theme/tokens";

const useNativeTabs =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;

export default function TabsLayout() {
  const { colors } = useTheme();
  const { user, booting } = useAuth();
  const { hydrate } = usePlayer();

  useEffect(() => {
    if (user) void hydrate();
  }, [user, hydrate]);

  if (booting) return null;
  if (!user) return <Redirect href="/(auth)/login" />;

  if (useNativeTabs) {
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="index">
          <Icon sf="house.fill" drawable="ic_menu_home" />
          <Label>Home</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="explore">
          <Icon sf="magnifyingglass" drawable="ic_menu_search" />
          <Label>Explore</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="library">
          <Icon sf="books.vertical.fill" drawable="ic_menu_agenda" />
          <Label>Library</Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.onSurfaceSecondary,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.border,
          ...(Platform.OS === "web" ? { height: WEB_TAB_BAR_HEIGHT } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Feather name="home" size={size ?? 22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "Explore",
          tabBarIcon: ({ color, size }) => <Feather name="search" size={size ?? 22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarIcon: ({ color, size }) => (
            <Feather name="bookmark" size={size ?? 22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
