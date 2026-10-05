import { isObject } from "lodash-es";
import { isNonEmptyString } from "./typeGuards";
import type { WorkItemType } from "../types";

const CONFIG_STORAGE_KEY = "ado-config";
const OVERVIEW_FIELDS_STORAGE_KEY = "ado-overview-fields";
const RECENT_WORK_ITEM_TYPES_STORAGE_KEY = "ado-recent-work-item-types";
const CHILD_WORK_ITEM_TYPES_STORAGE_KEY = "ado-child-work-item-types";
const MAX_RECENT_WORK_ITEM_TYPES = 5;
const MAX_CHILD_WORK_ITEM_TYPES = 5;

interface ChildWorkItemTypePreference {
  parentWorkItemType: WorkItemType;
  workItemTypes: WorkItemType[];
}

export function isWorkItemType(value: unknown): value is WorkItemType {
  return typeof value === "string" && value.trim().length > 0;
}

function isChildWorkItemTypePreference(value: unknown): value is ChildWorkItemTypePreference {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    "parentWorkItemType" in value &&
    isWorkItemType(value.parentWorkItemType) &&
    "workItemTypes" in value &&
    Array.isArray(value.workItemTypes) &&
    value.workItemTypes.length <= MAX_CHILD_WORK_ITEM_TYPES &&
    value.workItemTypes.every(isWorkItemType)
  );
}

function isChildWorkItemTypePreferenceArray(
  value: unknown,
): value is ChildWorkItemTypePreference[] {
  return Array.isArray(value) && value.every(isChildWorkItemTypePreference);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseJsonSafely<T>(
  serializedValue: string,
  isExpectedType: (value: unknown) => value is T,
): T | undefined {
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(serializedValue);
  } catch {
    return undefined;
  }

  return isExpectedType(parsedValue) ? parsedValue : undefined;
}

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
  const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
  const config = saved ? parseJsonSafely(saved, isSavedConfig) : undefined;
  if (config) {
    return config;
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
  const saved = localStorage.getItem(OVERVIEW_FIELDS_STORAGE_KEY);
  const selection = saved ? parseJsonSafely(saved, isStringArray) : undefined;
  if (selection) {
    return selection;
  }
  return null;
}

/** Persist the user's global work item overview field selection. */
export function saveOverviewFieldSelection(referenceNames: string[]): void {
  localStorage.setItem(OVERVIEW_FIELDS_STORAGE_KEY, JSON.stringify(referenceNames));
}

/** Retrieve the most recently selected work item types. */
export function getRecentWorkItemTypes(): string[] {
  const saved = localStorage.getItem(RECENT_WORK_ITEM_TYPES_STORAGE_KEY);
  const recentTypes = saved ? parseJsonSafely(saved, isStringArray) : undefined;
  return recentTypes?.slice(0, MAX_RECENT_WORK_ITEM_TYPES) ?? [];
}

/** Put a selected work item type at the front of the recent-types list. */
export function saveRecentWorkItemType(workItemType: string): void {
  const recentTypes = getRecentWorkItemTypes().filter((type) => type !== workItemType);
  localStorage.setItem(
    RECENT_WORK_ITEM_TYPES_STORAGE_KEY,
    JSON.stringify([workItemType, ...recentTypes].slice(0, MAX_RECENT_WORK_ITEM_TYPES)),
  );
}

/** Remove a work item type from the user's recent type list. */
export function removeRecentWorkItemType(workItemType: string): void {
  const recentTypes = getRecentWorkItemTypes().filter((type) => type !== workItemType);
  localStorage.setItem(RECENT_WORK_ITEM_TYPES_STORAGE_KEY, JSON.stringify(recentTypes));
}

/** Retrieve the selected child types for a parent work item type. */
export function getChildWorkItemTypePreference(parentWorkItemType: WorkItemType): WorkItemType[] {
  const saved = localStorage.getItem(CHILD_WORK_ITEM_TYPES_STORAGE_KEY);
  const preferences = saved
    ? parseJsonSafely(saved, isChildWorkItemTypePreferenceArray)
    : undefined;
  const preference = preferences?.find((entry) => entry.parentWorkItemType === parentWorkItemType);
  return preference?.workItemTypes ?? [];
}

/** Add a selected child type to the front of a parent work item type's history. */
export function saveChildWorkItemTypePreference(
  parentWorkItemType: WorkItemType,
  workItemType: WorkItemType,
): void {
  const saved = localStorage.getItem(CHILD_WORK_ITEM_TYPES_STORAGE_KEY);
  let childTypesByParentType = saved
    ? (parseJsonSafely(saved, isChildWorkItemTypePreferenceArray) ?? [])
    : [];
  const existingPreference = childTypesByParentType.find(
    (entry) => entry.parentWorkItemType === parentWorkItemType,
  );
  const previousChildTypes = existingPreference?.workItemTypes ?? [];
  childTypesByParentType = childTypesByParentType.filter(
    (entry) => entry.parentWorkItemType !== parentWorkItemType,
  );
  childTypesByParentType.push({
    parentWorkItemType,
    workItemTypes: [
      workItemType,
      ...previousChildTypes.filter((type) => type !== workItemType),
    ].slice(0, MAX_CHILD_WORK_ITEM_TYPES),
  });
  localStorage.setItem(CHILD_WORK_ITEM_TYPES_STORAGE_KEY, JSON.stringify(childTypesByParentType));
}

/** Remove a child type from a parent work item type's history. */
export function removeChildWorkItemTypePreference(
  parentWorkItemType: WorkItemType,
  workItemType: WorkItemType,
): void {
  const saved = localStorage.getItem(CHILD_WORK_ITEM_TYPES_STORAGE_KEY);
  let childTypesByParentType = saved
    ? (parseJsonSafely(saved, isChildWorkItemTypePreferenceArray) ?? [])
    : [];

  childTypesByParentType = childTypesByParentType.map((entry) =>
    entry.parentWorkItemType === parentWorkItemType
      ? {
          ...entry,
          workItemTypes: entry.workItemTypes.filter((type) => type !== workItemType),
        }
      : entry,
  );
  childTypesByParentType = childTypesByParentType.filter((entry) => entry.workItemTypes.length > 0);
  localStorage.setItem(CHILD_WORK_ITEM_TYPES_STORAGE_KEY, JSON.stringify(childTypesByParentType));
}
