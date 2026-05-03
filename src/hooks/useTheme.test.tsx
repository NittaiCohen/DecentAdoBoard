import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { useTheme } from "./useTheme";
import { ThemeProvider } from "../contexts/ThemeContext";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ThemeProvider, null, children);
}

describe("useTheme", () => {
  it("throws when used outside ThemeProvider", () => {
    // Suppress React error boundary noise
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow(
      "useTheme must be used within a ThemeProvider",
    );
    spy.mockRestore();
  });

  it("returns theme context when inside ThemeProvider", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current).toHaveProperty("preference");
    expect(result.current).toHaveProperty("resolved");
    expect(result.current).toHaveProperty("setPreference");
    expect(result.current).toHaveProperty("cycle");
  });

  it("resolves to dark when system preference is dark", () => {
    localStorage.removeItem("theme-preference");

    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe("system");
    expect(result.current.resolved).toBe("dark");

    window.matchMedia = originalMatchMedia;
  });

  it("resolves to light when system preference is light", () => {
    localStorage.removeItem("theme-preference");

    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.resolved).toBe("light");

    window.matchMedia = originalMatchMedia;
  });

  it("cycles through system → light → dark → system", () => {
    localStorage.removeItem("theme-preference");
    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.preference).toBe("system");

    act(() => result.current.cycle());
    expect(result.current.preference).toBe("light");

    act(() => result.current.cycle());
    expect(result.current.preference).toBe("dark");

    act(() => result.current.cycle());
    expect(result.current.preference).toBe("system");
  });

  it("persists dark preference to localStorage and applies dark class", () => {
    localStorage.removeItem("theme-preference");
    document.documentElement.classList.remove("dark");
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => result.current.setPreference("dark"));
    expect(localStorage.getItem("theme-preference")).toBe("dark");
    expect(result.current.preference).toBe("dark");
    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes dark class when switching to light preference", () => {
    localStorage.removeItem("theme-preference");
    document.documentElement.classList.remove("dark");
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => result.current.setPreference("dark"));
    act(() => result.current.setPreference("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("loads saved preference from localStorage", () => {
    localStorage.setItem("theme-preference", "light");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe("light");
    expect(result.current.resolved).toBe("light");
  });

  it("falls back to system when localStorage has invalid value", () => {
    localStorage.setItem("theme-preference", "invalid");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe("system");
  });

  it("responds to system preference changes via matchMedia listener", () => {
    localStorage.removeItem("theme-preference");

    let changeHandler: (() => void) | null = null;
    const originalMatchMedia = window.matchMedia;
    let systemIsDark = true;

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: systemIsDark && query === "(prefers-color-scheme: dark)",
      media: query,
      onchange: null,
      addEventListener: vi.fn((_event: string, handler: () => void) => {
        changeHandler = handler;
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.resolved).toBe("dark");

    systemIsDark = false;
    expect(changeHandler).not.toBeNull();
    if (!changeHandler) {
      throw new Error("changeHandler not set");
    }
    act(() => changeHandler());

    expect(result.current.resolved).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    window.matchMedia = originalMatchMedia;
  });
});
