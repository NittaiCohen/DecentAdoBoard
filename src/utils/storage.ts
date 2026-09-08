import { isObject } from "lodash-es";
import { isNonEmptyString } from "./typeGuards";

const CONFIG_STORAGE_KEY = "ado-config";
const OVERVIEW_FIELDS_STORAGE_KEY = "ado-overview-fields";
const RECENT_WORK_ITEM_TYPES_STORAGE_KEY = "ado-recent-work-item-types";
const MAX_RECENT_WORK_ITEM_TYPES = 5;

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

/** Retrieve the user's global work item overview field selection. */
export function getOverviewFieldSelection(): string[] | null {
  try {
    const saved = localStorage.getItem(OVERVIEW_FIELDS_STORAGE_KEY);
    if (!saved) {
      return null;
    }
    const parsed: unknown = JSON.parse(saved);
    if (
      Array.isArray(parsed) &&
      parsed.every((value): value is string => typeof value === "string")
    ) {
      return parsed;
    }
  } catch {
    /* ignore invalid JSON */
  }
  return null;
}

/** Persist the user's global work item overview field selection. */
export function saveOverviewFieldSelection(referenceNames: string[]): void {
  localStorage.setItem(OVERVIEW_FIELDS_STORAGE_KEY, JSON.stringify(referenceNames));
}

/** Retrieve the most recently selected work item types. */
export function getRecentWorkItemTypes(): string[] {
  try {
    const saved = localStorage.getItem(RECENT_WORK_ITEM_TYPES_STORAGE_KEY);
    if (!saved) {
      return [];
    }
    const parsed: unknown = JSON.parse(saved);
    if (
      Array.isArray(parsed) &&
      parsed.every((value): value is string => typeof value === "string")
    ) {
      return parsed.slice(0, MAX_RECENT_WORK_ITEM_TYPES);
    }
  } catch {
    /* ignore invalid JSON */
  }
  return [];
}

/** Put a selected work item type at the front of the recent-types list. */
export function saveRecentWorkItemType(workItemType: string): void {
  const recentTypes = getRecentWorkItemTypes().filter((type) => type !== workItemType);
  localStorage.setItem(
    RECENT_WORK_ITEM_TYPES_STORAGE_KEY,
    JSON.stringify([workItemType, ...recentTypes].slice(0, MAX_RECENT_WORK_ITEM_TYPES)),
  );
}
