import type { WorkItemFieldDefinition } from "../types";
import type { JsonValue } from "../types";

export const TITLE_FIELD_REFERENCE = "System.Title";
export const DESCRIPTION_FIELD_REFERENCE = "System.Description";
export const STATE_FIELD_REFERENCE = "System.State";
export const ASSIGNED_TO_FIELD_REFERENCE = "System.AssignedTo";
export const TAGS_FIELD_REFERENCE = "System.Tags";
export const AREA_PATH_FIELD_REFERENCE = "System.AreaPath";
export const ITERATION_PATH_FIELD_REFERENCE = "System.IterationPath";
export const SPECIAL_FIELD_REFERENCES = new Set([
  TITLE_FIELD_REFERENCE,
  STATE_FIELD_REFERENCE,
  ASSIGNED_TO_FIELD_REFERENCE,
  TAGS_FIELD_REFERENCE,
  AREA_PATH_FIELD_REFERENCE,
  ITERATION_PATH_FIELD_REFERENCE,
]);
export const RICH_TEXT_FIELD_ORDER = [
  "System.Description",
  "Microsoft.VSTS.TCM.ReproSteps",
  "Microsoft.VSTS.TCM.SystemInfo",
  "Microsoft.VSTS.Common.AcceptanceCriteria",
];

export function getHeaderFields(fields: WorkItemFieldDefinition[]): WorkItemFieldDefinition[] {
  const fieldsByReference = new Map(fields.map((field) => [field.referenceName, field]));
  const headerFieldOrder = [
    ASSIGNED_TO_FIELD_REFERENCE,
    AREA_PATH_FIELD_REFERENCE,
    STATE_FIELD_REFERENCE,
    ITERATION_PATH_FIELD_REFERENCE,
  ];

  return headerFieldOrder.flatMap((referenceName) => {
    const field = fieldsByReference.get(referenceName);
    return field ? [field] : [];
  });
}

export function formatFieldValue(value: JsonValue): string {
  if (value === null) {
    return "Not set";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatFieldValue).join(", ");
  }
  if (typeof value.displayName === "string") {
    return value.displayName;
  }
  if (typeof value.uniqueName === "string") {
    return value.uniqueName;
  }
  return JSON.stringify(value);
}

export function getInputValue(value: JsonValue): string {
  return value === null ? "" : formatFieldValue(value);
}

export function parseInputValue(field: WorkItemFieldDefinition, inputValue: string): JsonValue {
  const normalizedType = field.fieldType.toLowerCase();
  if (normalizedType === "integer" || normalizedType === "picklistinteger") {
    return inputValue === "" ? null : Number.parseInt(inputValue, 10);
  }
  if (normalizedType === "double") {
    return inputValue === "" ? null : Number.parseFloat(inputValue);
  }
  return inputValue;
}
