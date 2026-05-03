import { use } from "react";
import { ThemeContext } from "../contexts/ThemeContext";

/** Access the current theme context, throwing if used outside a ThemeProvider. */
export function useTheme() {
  const context = use(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
