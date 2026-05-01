import { useTheme } from "../hooks/useTheme";

const LABELS = {
  system: "System",
  light: "Light",
  dark: "Dark",
} as const;

const ICONS = {
  system: "💻",
  light: "☀️",
  dark: "🌙",
} as const;

export default function ThemeToggle() {
  const { preference, cycle } = useTheme();

  return (
    <button
      onClick={cycle}
      className="z-10 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium px-3 py-1.5 rounded shadow transition-colors"
      title={`Theme: ${LABELS[preference]} (click to cycle)`}
    >
      {`${ICONS[preference]} ${LABELS[preference]}`}
    </button>
  );
}
