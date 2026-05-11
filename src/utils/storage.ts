import { isObject } from "lodash-es";
import { isNonEmptyString } from "./typeGuards";

const CONFIG_STORAGE_KEY = "ado-config";

interface SavedConfig {
  organization: string;
  project: string;
  areaPath: string;
}

/** Type guard to check if a value is a valid SavedConfig object. */
function isSavedConfig(value: unknown): value is SavedConfig {
  return (
    isObject(value) &&
    "organization" in value &&
    "project" in value &&
    "areaPath" in value &&
    isNonEmptyString(value.organization) &&
    isNonEmptyString(value.project) &&
    isNonEmptyString(value.areaPath)
  );
}

/** Retrieve the saved project configuration from localStorage, returning null if missing or invalid. */
export function getSavedConfig(): SavedConfig | null {
  try {
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!saved) {
      return null;
    }
    const config: unknown = JSON.parse(saved);
    if (isSavedConfig(config)) {
      return config;
    }
  } catch {
    /* ignore invalid JSON */
  }
  return null;
}

/** Persist the project configuration to localStorage. */
export function saveConfig(config: SavedConfig) {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

/** Remove the saved project configuration from localStorage. */
export function clearConfig() {
  localStorage.removeItem(CONFIG_STORAGE_KEY);
}
