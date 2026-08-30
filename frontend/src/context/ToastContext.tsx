import { Feather } from "@expo/vector-icons";
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type ToastKind = "success" | "error" | "info";
type ToastState = { message: string; kind: ToastKind } | null;

const ToastContext = createContext<{ toast: (message: string, kind?: ToastKind) => void }>({
  toast: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ToastState>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      if (timer.current) clearTimeout(timer.current);
      setState({ message, kind });
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== "web" }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: Platform.OS !== "web",
        }).start(() => setState(null));
      }, 2600);
    },
    [opacity],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  const accent =
    state?.kind === "success" ? colors.success : state?.kind === "error" ? colors.error : colors.info;
  const icon = state?.kind === "success" ? "check-circle" : state?.kind === "error" ? "alert-circle" : "info";

  return (
    <ToastContext.Provider value={value}>
      {children}
      {state ? (
        <Animated.View
          testID="app-toast"
          style={[
            styles.wrap,
            {
              top: insets.top + spacing.sm,
              opacity,
              pointerEvents: "none",
              transform: [
                { translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
              ],
            },
          ]}
        >
          <View
            style={[
              styles.toast,
              { backgroundColor: colors.surfaceTertiary, borderColor: accent },
            ]}
          >
            <Feather name={icon as never} size={16} color={accent} />
            <Text style={[styles.text, { color: colors.onSurface }]} numberOfLines={2}>
              {state.message}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext).toast;

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    maxWidth: 520,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: fontSize.base,
  },
});
