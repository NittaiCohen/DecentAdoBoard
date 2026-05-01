const PAT_STORAGE_KEY = "ado_pat";
const PAT_EXPIRY_KEY = "ado_pat_expiry";
const CONFIG_STORAGE_KEY = "ado-config";

export function getSavedPat(): string | null {
  const pat = localStorage.getItem(PAT_STORAGE_KEY);
  const expiry = localStorage.getItem(PAT_EXPIRY_KEY);
  if (!pat) {
    return null;
  }
  if (expiry) {
    const expiryDate = new Date(expiry);
    if (expiryDate <= new Date()) {
      localStorage.removeItem(PAT_STORAGE_KEY);
      localStorage.removeItem(PAT_EXPIRY_KEY);
      return null;
    }
  }
  return pat;
}

interface SavedConfig {
  organization: string;
  project: string;
  areaPath: string;
}

import { isObject } from "lodash-es";
import { isNonEmptyString } from "./typeGuards";

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

export function savePat(pat: string, validTo?: string) {
  localStorage.setItem(PAT_STORAGE_KEY, pat);
  if (validTo) {
    localStorage.setItem(PAT_EXPIRY_KEY, validTo);
  } else {
    localStorage.removeItem(PAT_EXPIRY_KEY);
  }
}

export function clearPat() {
  localStorage.removeItem(PAT_STORAGE_KEY);
  localStorage.removeItem(PAT_EXPIRY_KEY);
}
