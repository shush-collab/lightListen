import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";

import { storage } from "@/src/utils/storage";

import { DARK, LIGHT, Palette } from "./tokens";

export type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "lightlisten.theme.mode";

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  colors: Palette;
  isDark: boolean;
};

const ThemeContext = createContext<ThemeContextValue>({
  mode: "dark",
  setMode: () => {},
  colors: DARK,
  isDark: true,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("dark");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await storage.getItem<string>(THEME_KEY, "dark");
      if (!cancelled && (saved === "light" || saved === "dark" || saved === "system")) {
        setModeState(saved);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void storage.setItem(THEME_KEY, next);
  }, []);

  const isDark = mode === "system" ? system !== "light" : mode === "dark";

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, setMode, colors: isDark ? DARK : LIGHT, isDark }),
    [mode, setMode, isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
