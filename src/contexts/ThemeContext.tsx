import { createContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";

type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
  cycle: () => void;
}

const STORAGE_KEY = "theme-preference";
const PREFERENCE_ORDER: ThemePreference[] = ["system", "light", "dark"];

const ThemeContext = createContext<ThemeContextValue | null>(null);

export { ThemeContext };

/** Detect the OS-level color scheme preference. */
function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Resolve a theme preference to an actual light/dark value. */
function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return getSystemTheme();
  }
  return preference;
}

/** Load the persisted theme preference from localStorage, defaulting to "system". */
function loadPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

/** Apply the resolved theme by toggling the "dark" class on the document root. */
function applyTheme(resolved: ResolvedTheme) {
  if (resolved === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(loadPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference));

  const persistAndSetPreference = useCallback((pref: ThemePreference) => {
    setPreference(pref);
    localStorage.setItem(STORAGE_KEY, pref);
  }, []);

  const cycle = useCallback(() => {
    setPreference((current) => {
      const nextIndex = (PREFERENCE_ORDER.indexOf(current) + 1) % PREFERENCE_ORDER.length;
      const next = PREFERENCE_ORDER[nextIndex];
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  // Resolve theme whenever preference or system preference changes
  useEffect(() => {
    const newResolved = resolveTheme(preference);
    setResolved(newResolved);
    applyTheme(newResolved);

    if (preference === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        const updated = resolveTheme("system");
        setResolved(updated);
        applyTheme(updated);
      };
      mediaQuery.addEventListener("change", handler);
      return () => {
        mediaQuery.removeEventListener("change", handler);
      };
    }

    return undefined;
  }, [preference]);

  return (
    <ThemeContext value={{ preference, resolved, setPreference: persistAndSetPreference, cycle }}>
      {children}
    </ThemeContext>
  );
}
