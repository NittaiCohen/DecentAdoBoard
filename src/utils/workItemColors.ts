export const TYPE_COLORS: Record<string, string> = {
  Bug: "border-red-500 bg-red-100/50 dark:bg-red-950/50",
  Task: "border-yellow-500 bg-yellow-100/50 dark:bg-yellow-950/50",
  "User Story": "border-blue-500 bg-blue-100/50 dark:bg-blue-950/50",
  Feature: "border-purple-500 bg-purple-100/50 dark:bg-purple-950/50",
  Epic: "border-orange-500 bg-orange-100/50 dark:bg-orange-950/50",
  "Product Backlog Item": "border-blue-500 bg-blue-100/50 dark:bg-blue-950/50",
};

export const DEFAULT_TYPE_COLOR = "border-gray-500 bg-gray-100/50 dark:bg-gray-900/50";

export const PARENT_GROUP_TYPE_COLORS: Record<string, string> = {
  Bug: "border-red-400/60 dark:border-red-600/60 border-l-red-500 bg-red-100/30 dark:bg-red-950/30",
  Task: "border-yellow-400/60 dark:border-yellow-600/60 border-l-yellow-500 bg-yellow-100/30 dark:bg-yellow-950/30",
  "User Story":
    "border-blue-400/60 dark:border-blue-600/60 border-l-blue-500 bg-blue-100/30 dark:bg-blue-950/30",
  Feature:
    "border-purple-400/60 dark:border-purple-600/60 border-l-purple-500 bg-purple-100/30 dark:bg-purple-950/30",
  Epic: "border-orange-400/60 dark:border-orange-600/60 border-l-orange-500 bg-orange-100/30 dark:bg-orange-950/30",
  "Product Backlog Item":
    "border-blue-400/60 dark:border-blue-600/60 border-l-blue-500 bg-blue-100/30 dark:bg-blue-950/30",
};

export const DEFAULT_PARENT_GROUP_TYPE_COLOR =
  "border-gray-400/60 dark:border-gray-600/60 border-l-gray-500 bg-gray-100/30 dark:bg-gray-800/30";

export const STATE_BADGES: Record<string, string> = {
  New: "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200",
  Active: "bg-blue-600 text-blue-100",
  "In Progress": "bg-blue-600 text-blue-100",
  "In Review": "bg-purple-600 text-purple-100",
  Resolved: "bg-green-700 text-green-100",
  Closed: "bg-green-800 text-green-100",
  Done: "bg-green-800 text-green-100",
  Removed: "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400",
};

export const DEFAULT_STATE_BADGE = "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200";
