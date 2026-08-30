import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePlayer } from "@/src/context/PlayerContext";
import { MINI_PLAYER_HEIGHT, spacing, TAB_BAR_HEIGHT, WEB_TAB_BAR_HEIGHT } from "@/src/theme/tokens";

export const tabBarOffset = (bottomInset: number) =>
  Platform.OS === "web" ? WEB_TAB_BAR_HEIGHT : TAB_BAR_HEIGHT + bottomInset;

/**
 * Bottom padding for scrollable content.
 * Tab screens sit above a non-absolute tab bar (outside the viewport), so they only
 * reserve room for the floating mini-player. Stack screens also add the safe-area inset.
 */
export function useBottomPadding(isTabScreen: boolean): number {
  const insets = useSafeAreaInsets();
  const { track } = usePlayer();
  const mini = track ? MINI_PLAYER_HEIGHT + spacing.md : 0;
  const base = isTabScreen ? spacing.xl : insets.bottom + spacing.xl;
  return base + mini;
}
