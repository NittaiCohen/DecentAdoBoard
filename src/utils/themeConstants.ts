import type { ThemePreference } from "../contexts/ThemeContext";

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export const THEME_ICONS: Record<ThemePreference, string> = {
  system: "💻",
  light: "☀️",
  dark: "🌙",
};
