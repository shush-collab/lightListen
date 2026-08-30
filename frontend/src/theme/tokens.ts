// Design tokens for LightListen — two switchable palettes (warm bookish light,
// cinematic luxe dark). Values come straight from /app/design_guidelines.json.

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const fontSize = {
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 34,
} as const;

export const fonts = {
  display: "PlayfairDisplay-Bold",
  displayRegular: "PlayfairDisplay-Regular",
  regular: "Manrope-Regular",
  medium: "Manrope-Medium",
  semibold: "Manrope-SemiBold",
  bold: "Manrope-Bold",
} as const;

export type Palette = {
  surface: string;
  onSurface: string;
  surfaceSecondary: string;
  onSurfaceSecondary: string;
  surfaceTertiary: string;
  onSurfaceTertiary: string;
  surfaceInverse: string;
  onSurfaceInverse: string;
  brand: string;
  onBrand: string;
  brandSecondary: string;
  brandTertiary: string;
  onBrandTertiary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  border: string;
  borderStrong: string;
  divider: string;
  scrim: string;
};

export const LIGHT: Palette = {
  surface: "#F9F8F6",
  onSurface: "#1C1917",
  surfaceSecondary: "#F0ECE5",
  onSurfaceSecondary: "#44403C",
  surfaceTertiary: "#E6E0D8",
  onSurfaceTertiary: "#292524",
  surfaceInverse: "#1C1917",
  onSurfaceInverse: "#F9F8F6",
  brand: "#8C3A3A",
  onBrand: "#FFFFFF",
  brandSecondary: "#A45555",
  brandTertiary: "#EAD3D3",
  onBrandTertiary: "#5C2020",
  success: "#4A6741",
  warning: "#B8860B",
  error: "#8B0000",
  info: "#4A5D67",
  border: "#E5E1DA",
  borderStrong: "#D1C9BE",
  divider: "#E5E1DA",
  scrim: "rgba(249,248,246,0.92)",
};

export const DARK: Palette = {
  surface: "#0D0F12",
  onSurface: "#F3F4F6",
  surfaceSecondary: "#16191E",
  onSurfaceSecondary: "#9CA3AF",
  surfaceTertiary: "#1F2329",
  onSurfaceTertiary: "#E5E7EB",
  surfaceInverse: "#F9F8F6",
  onSurfaceInverse: "#0D0F12",
  brand: "#C5A059",
  onBrand: "#1A1406",
  brandSecondary: "#A88444",
  brandTertiary: "#382B14",
  onBrandTertiary: "#FCEEC7",
  success: "#5C8051",
  warning: "#D4A017",
  error: "#C23B22",
  info: "#607D8B",
  border: "#2A2F37",
  borderStrong: "#3F4550",
  divider: "#2A2F37",
  scrim: "rgba(13,15,18,0.94)",
};

export const MINI_PLAYER_HEIGHT = 64;
export const TAB_BAR_HEIGHT = 49;
export const WEB_TAB_BAR_HEIGHT = 64;

export const formatDuration = (totalSeconds?: number | null): string => {
  const s = Math.max(0, Math.floor(totalSeconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
};

export const formatBytes = (bytes?: number | null): string => {
  const b = Math.max(0, bytes ?? 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};
