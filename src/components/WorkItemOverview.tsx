import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { updateWorkItemFields } from "../api/tauri";
import AssignedToSelector from "./AssignedToSelector";
import WorkItemPathSelector from "./WorkItemPathSelector";
import RichTextFieldEditor from "./RichTextFieldEditor";
import StateSelector from "./StateSelector";
import {
  ALWAYS_VISIBLE_OVERVIEW_FIELD_REFERENCES,
  getDefaultOverviewFieldSelection,
} from "../config/overviewFields";
import StateBadge from "./StateBadge";
import { DEFAULT_TYPE_COLOR, TYPE_COLORS } from "../utils/workItemColors";
import { useWorkItemOverview } from "../hooks/useAdoData";
import { useWorkItemTypeStates } from "../hooks/useWorkItemTypeStates";
import { getOrderedStateOptions } from "../utils/workItemStates";
import type {
  BoardData,
  JsonValue,
  WorkItemFieldDefinition,
  WorkItemOverview as WorkItemOverviewData,
} from "../types";
import { getOverviewFieldSelection, saveOverviewFieldSelection } from "../utils/storage";

interface WorkItemOverviewProps {
  workItemId: number;
  onClose: () => void;
}

function formatFieldValue(value: JsonValue): string {
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

function isComplexField(fieldType: string): boolean {
  return fieldType.toLowerCase() === "identity";
}

function getInputValue(value: JsonValue): string {
  return value === null ? "" : formatFieldValue(value);
}

function getBoardAssignedToValue(value: JsonValue): string | null {
  if (value === null) {
    return null;
  }

  return formatFieldValue(value);
}

const TITLE_FIELD_REFERENCE = "System.Title";
const STATE_FIELD_REFERENCE = "System.State";
const ASSIGNED_TO_FIELD_REFERENCE = "System.AssignedTo";
const AREA_PATH_FIELD_REFERENCE = "System.AreaPath";
const ITERATION_PATH_FIELD_REFERENCE = "System.IterationPath";
const SPECIAL_FIELD_REFERENCES = new Set([
  TITLE_FIELD_REFERENCE,
  STATE_FIELD_REFERENCE,
  ASSIGNED_TO_FIELD_REFERENCE,
  AREA_PATH_FIELD_REFERENCE,
  ITERATION_PATH_FIELD_REFERENCE,
]);
const HEADER_FIELD_ORDER = [
  ASSIGNED_TO_FIELD_REFERENCE,
  AREA_PATH_FIELD_REFERENCE,
  STATE_FIELD_REFERENCE,
  ITERATION_PATH_FIELD_REFERENCE,
];

function getHeaderFields(fields: WorkItemFieldDefinition[]): WorkItemFieldDefinition[] {
  const fieldsByReference = new Map(fields.map((field) => [field.referenceName, field]));

  return HEADER_FIELD_ORDER.flatMap((referenceName) => {
    const field = fieldsByReference.get(referenceName);
    return field ? [field] : [];
  });
}

function parseInputValue(field: WorkItemFieldDefinition, inputValue: string): JsonValue {
  const normalizedType = field.fieldType.toLowerCase();
  if (normalizedType === "integer" || normalizedType === "picklistinteger") {
    return inputValue === "" ? null : Number.parseInt(inputValue, 10);
  }
  if (normalizedType === "double") {
    return inputValue === "" ? null : Number.parseFloat(inputValue);
  }
  return inputValue;
}

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: WorkItemFieldDefinition;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
}) {
  const normalizedType = field.fieldType.toLowerCase();
  const disabled = field.readOnly || isComplexField(field.fieldType);
  const inputClass =
    "w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm";

  if (normalizedType === "html") {
    return (
      <RichTextFieldEditor
        label={field.name}
        value={getInputValue(value)}
        editable={!disabled}
        onChange={(nextValue) => onChange(nextValue)}
      />
    );
  }

  if (disabled) {
    return (
      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
        {formatFieldValue(value)}
      </p>
    );
  }

  if (field.allowedValues.length > 0) {
    return (
      <select
        className={inputClass}
        value={getInputValue(value)}
        onChange={(event) => onChange(parseInputValue(field, event.target.value))}
      >
        <option value="">{"Not set"}</option>
        {field.allowedValues.map((allowedValue) => (
          <option key={getInputValue(allowedValue)} value={getInputValue(allowedValue)}>
            {getInputValue(allowedValue)}
          </option>
        ))}
      </select>
    );
  }

  if (normalizedType === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4"
      />
    );
  }

  if (normalizedType === "plaintext") {
    return (
      <textarea
        className={`${inputClass} min-h-24`}
        value={getInputValue(value)}
        onChange={(event) => onChange(parseInputValue(field, event.target.value))}
      />
    );
  }

  return (
    <input
      type={normalizedType === "integer" || normalizedType === "double" ? "number" : "text"}
      className={inputClass}
      value={getInputValue(value)}
      onChange={(event) => onChange(parseInputValue(field, event.target.value))}
    />
  );
}

function SpecialFieldEditor({
  field,
  workItemType,
  value,
  onChange,
}: {
  field: WorkItemFieldDefinition;
  workItemType: string;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
}) {
  if (field.referenceName === STATE_FIELD_REFERENCE) {
    return (
      <StateFieldEditor
        field={field}
        workItemType={workItemType}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (field.referenceName === ASSIGNED_TO_FIELD_REFERENCE) {
    return <AssignedToSelector value={value} disabled={field.readOnly} onChange={onChange} />;
  }

  if (field.referenceName === AREA_PATH_FIELD_REFERENCE) {
    return (
      <WorkItemPathSelector
        pathType="area"
        value={value}
        disabled={field.readOnly}
        onChange={onChange}
      />
    );
  }

  if (field.referenceName === ITERATION_PATH_FIELD_REFERENCE) {
    return (
      <WorkItemPathSelector
        pathType="iteration"
        value={value}
        disabled={field.readOnly}
        onChange={onChange}
      />
    );
  }

  return <FieldEditor field={field} value={value} onChange={onChange} />;
}

function StateFieldEditor({
  field,
  workItemType,
  value,
  onChange,
}: {
  field: WorkItemFieldDefinition;
  workItemType: string;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
}) {
  const state = getInputValue(value) || "Not set";
  const stateOptions = field.allowedValues;
  const { data: stateDefinitions = [] } = useWorkItemTypeStates(workItemType);
  const orderedStateOptions = getOrderedStateOptions(
    stateDefinitions,
    stateOptions.map(getInputValue),
  );

  if (field.readOnly) {
    return <StateBadge state={state} />;
  }

  return (
    <StateSelector
      value={state}
      options={orderedStateOptions}
      ariaLabel={field.name}
      onChange={(nextState) => onChange(parseInputValue(field, nextState))}
    />
  );
}

function FieldConfiguration({
  fields,
  selectedReferences,
  alwaysVisibleReferences,
  onChange,
  onReset,
}: {
  fields: WorkItemFieldDefinition[];
  selectedReferences: string[];
  alwaysVisibleReferences: Set<string>;
  onChange: (referenceName: string) => void;
  onReset: () => void;
}) {
  const selectedReferenceSet = new Set(selectedReferences);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{"Overview fields"}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {"This selection applies to every work item overview on this device."}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          {"Reset to defaults"}
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto space-y-1">
        {fields.map((field) => (
          <label
            key={field.referenceName}
            className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <input
              type="checkbox"
              checked={
                selectedReferenceSet.has(field.referenceName) ||
                alwaysVisibleReferences.has(field.referenceName)
              }
              disabled={alwaysVisibleReferences.has(field.referenceName)}
              onChange={() => onChange(field.referenceName)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-sm">{field.name}</span>
              <span className="block truncate text-[10px] text-gray-500 dark:text-gray-400">
                {field.referenceName}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function OverviewContent({
  overview,
  onClose,
}: {
  overview: WorkItemOverviewData;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedReferences, setSelectedReferences] = useState<string[]>([]);
  const [savedFields, setSavedFields] = useState<Record<string, JsonValue>>(overview.fields);
  const [draftFields, setDraftFields] = useState<Record<string, JsonValue>>(overview.fields);

  const availableFields = overview.fieldDefinitions;
  const typeColorClass = TYPE_COLORS[overview.workItemType] ?? DEFAULT_TYPE_COLOR;
  const fieldsWithDefaults = useMemo(
    () =>
      Object.fromEntries(
        availableFields.map((field) => [
          field.referenceName,
          overview.fields[field.referenceName] ?? null,
        ]),
      ),
    [availableFields, overview.fields],
  );

  useEffect(() => {
    const savedSelection = getOverviewFieldSelection();
    setSelectedReferences(
      savedSelection
        ? savedSelection.filter((referenceName) =>
            availableFields.some((field) => field.referenceName === referenceName),
          )
        : getDefaultOverviewFieldSelection(availableFields),
    );
    setSavedFields(fieldsWithDefaults);
    setDraftFields(fieldsWithDefaults);
    setError(null);
  }, [availableFields, fieldsWithDefaults, overview]);

  const visibleFields = availableFields.filter(
    (field) =>
      (selectedReferences.includes(field.referenceName) ||
        ALWAYS_VISIBLE_OVERVIEW_FIELD_REFERENCES.has(field.referenceName)) &&
      !SPECIAL_FIELD_REFERENCES.has(field.referenceName),
  );
  const hasChanges = availableFields.some(
    (field) =>
      !field.readOnly &&
      JSON.stringify(draftFields[field.referenceName]) !==
        JSON.stringify(savedFields[field.referenceName]),
  );

  function toggleField(referenceName: string) {
    setSelectedReferences((current) =>
      current.includes(referenceName)
        ? current.filter((value) => value !== referenceName)
        : [...current, referenceName],
    );
  }

  function resetFields() {
    const references = getDefaultOverviewFieldSelection(availableFields);
    setSelectedReferences(references);
    saveOverviewFieldSelection(references);
  }

  async function saveFields() {
    const updates = availableFields
      .filter(
        (field) =>
          !field.readOnly &&
          JSON.stringify(draftFields[field.referenceName]) !==
            JSON.stringify(savedFields[field.referenceName]),
      )
      .map((field) => ({
        referenceName: field.referenceName,
        value: draftFields[field.referenceName],
      }));

    if (updates.length === 0) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await updateWorkItemFields(overview.id, updates);
      const updatedOverview = { ...overview, fields: { ...draftFields } };
      queryClient.setQueryData(["workItemOverview", overview.id], updatedOverview);
      queryClient.setQueryData<BoardData>(["boardData"], (currentBoardData) => {
        if (!currentBoardData) {
          return currentBoardData;
        }

        return {
          ...currentBoardData,
          work_items: currentBoardData.work_items.map((workItem) => {
            if (workItem.id !== overview.id) {
              return workItem;
            }

            return {
              ...workItem,
              title: getInputValue(draftFields[TITLE_FIELD_REFERENCE]),
              state: getInputValue(draftFields[STATE_FIELD_REFERENCE]),
              assigned_to: getBoardAssignedToValue(draftFields[ASSIGNED_TO_FIELD_REFERENCE]),
            };
          }),
        };
      });
      setSavedFields({ ...draftFields });
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className={`flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4 dark:border-gray-700 ${typeColorClass} border-l-4`}
      >
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {`${overview.workItemType} #${overview.id}`}
          </p>
          <input
            type="text"
            value={getInputValue(draftFields[TITLE_FIELD_REFERENCE])}
            onChange={(event) =>
              setDraftFields((current) => ({
                ...current,
                [TITLE_FIELD_REFERENCE]: event.target.value,
              }))
            }
            className="w-full bg-transparent text-xl font-semibold outline-none ring-0"
            aria-label="Title"
          />
          <div className="grid grid-cols-[200px_minmax(0,1fr)] items-end gap-x-4 gap-y-2">
            {getHeaderFields(availableFields).map((field) => (
              <div key={field.referenceName} className="min-w-0 space-y-1">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {field.name}
                </label>
                <SpecialFieldEditor
                  field={field}
                  workItemType={overview.workItemType}
                  value={draftFields[field.referenceName] ?? null}
                  onChange={(value) =>
                    setDraftFields((current) => ({
                      ...current,
                      [field.referenceName]: value,
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          title="Close overview"
        >
          {"×"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{"Fields"}</h2>
          <button
            type="button"
            onClick={() => setIsConfiguring((current) => !current)}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            {isConfiguring ? "Done" : "Configure fields"}
          </button>
        </div>

        {isConfiguring && (
          <FieldConfiguration
            fields={availableFields}
            selectedReferences={selectedReferences}
            alwaysVisibleReferences={ALWAYS_VISIBLE_OVERVIEW_FIELD_REFERENCES}
            onChange={toggleField}
            onReset={resetFields}
          />
        )}

        {error && (
          <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {visibleFields.map((field) => (
            <div key={field.referenceName} className="space-y-1">
              {field.fieldType.toLowerCase() !== "html" && (
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {field.name}
                </label>
              )}
              <FieldEditor
                field={field}
                value={draftFields[field.referenceName] ?? null}
                onChange={(value) =>
                  setDraftFields((current) => ({
                    ...current,
                    [field.referenceName]: value,
                  }))
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-gray-700 px-6 py-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-gray-200 px-4 py-2 text-sm dark:bg-gray-700"
        >
          {"Close"}
        </button>
        <button
          type="button"
          onClick={() => void saveFields()}
          disabled={!hasChanges || isSaving}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}

export default function WorkItemOverview({ workItemId, onClose }: WorkItemOverviewProps) {
  const { data, isLoading, error } = useWorkItemOverview(workItemId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="h-[95vh] w-[95vw] max-w-none overflow-hidden rounded-xl bg-gray-50 text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-gray-100"
        role="dialog"
        aria-modal="true"
        aria-label="Work item overview"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {isLoading && (
          <div className="flex h-full items-center justify-center">{"Loading overview..."}</div>
        )}
        {error && (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <p className="text-red-600 dark:text-red-400">{String(error)}</p>
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-gray-200 px-4 py-2 dark:bg-gray-700"
            >
              {"Close"}
            </button>
          </div>
        )}
        {data && <OverviewContent overview={data} onClose={onClose} />}
      </div>
    </div>
  );
}
