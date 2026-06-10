import { useEffect } from "react";

type Modifier = "ctrl" | "shift" | "alt" | "meta";

/** A key with optional modifiers. */
interface KeyWithModifiers {
  key: string;
  modifiers?: Modifier[];
}

/** A single key (no modifiers), a key with modifiers, or an array mixing both. */
type KeyBinding = string | KeyWithModifiers | (string | KeyWithModifiers)[];

interface UseKeyDownOptions {
  enabled?: boolean;
  preventDefault?: boolean;
}

interface NormalizedBinding {
  key: string;
  modifiers: Modifier[];
}

function normalizeBinding(binding: string | KeyWithModifiers): NormalizedBinding {
  if (typeof binding === "string") {
    return { key: binding, modifiers: [] };
  }
  return { key: binding.key, modifiers: binding.modifiers ?? [] };
}

function matchesModifiers(event: KeyboardEvent, modifiers: Modifier[]): boolean {
  const required = new Set(modifiers);
  const ctrlOrMeta = event.ctrlKey || event.metaKey;

  if (required.has("ctrl") !== ctrlOrMeta) {
    return false;
  }
  if (required.has("shift") !== event.shiftKey) {
    return false;
  }
  if (required.has("alt") !== event.altKey) {
    return false;
  }
  // "meta" as a standalone modifier (distinct from "ctrl") checks metaKey alone
  if (required.has("meta") && !required.has("ctrl")) {
    if (!event.metaKey) {
      return false;
    }
  }
  return true;
}

/**
 * Registers a keydown listener for one or more key bindings.
 *
 * @param bindings - What to listen for. Accepts:
 *   - A plain string for a single key with no modifiers: `"Escape"`
 *   - An object with key and modifiers: `{ key: "z", modifiers: ["ctrl"] }`
 *   - An array mixing both for alternatives:
 *     `[{ key: "=", modifiers: ["ctrl"] }, { key: "+", modifiers: ["ctrl"] }]`
 * @param handler - Callback invoked when any binding matches.
 * @param options - Optional configuration:
 *   - `enabled` (default `true`): only listens when true.
 *   - `preventDefault` (default `true`): calls `event.preventDefault()` on match.
 */
export function useKeyDown(
  bindings: KeyBinding,
  handler: () => void,
  options: UseKeyDownOptions = {},
): void {
  const { enabled = true, preventDefault = true } = options;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const normalizedBindings = (Array.isArray(bindings) ? bindings : [bindings]).map(
      normalizeBinding,
    );

    function handleKeyDown(event: KeyboardEvent) {
      const matched = normalizedBindings.some(
        (binding) => event.key === binding.key && matchesModifiers(event, binding.modifiers),
      );
      if (!matched) {
        return;
      }
      if (preventDefault) {
        event.preventDefault();
      }
      handler();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [bindings, handler, enabled, preventDefault]);
}
