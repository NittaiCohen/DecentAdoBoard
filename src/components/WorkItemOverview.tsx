import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { updateWorkItemFields } from "../api/tauri";
import TagsEditor from "./TagsEditor";
import WorkItemTypeIcon from "./WorkItemTypeIcon";
import WorkItemComments from "./WorkItemComments";
import {
  ALWAYS_VISIBLE_OVERVIEW_FIELD_REFERENCES,
  getDefaultOverviewFieldSelection,
  getOverviewFieldsForWorkItemType,
} from "../config/overviewFields";
import { DEFAULT_TYPE_COLOR, TYPE_COLORS } from "../utils/workItemColors";
import { useWorkItemComments, useWorkItemOverview } from "../hooks/useAdoData";
import { FieldEditor, SpecialFieldEditor } from "./WorkItemFieldEditor";
import {
  ASSIGNED_TO_FIELD_REFERENCE,
  getHeaderFields,
  getInputValue,
  RICH_TEXT_FIELD_ORDER,
  SPECIAL_FIELD_REFERENCES,
  STATE_FIELD_REFERENCE,
  TAGS_FIELD_REFERENCE,
  TITLE_FIELD_REFERENCE,
  formatFieldValue,
} from "../utils/workItemFieldEditor";
import type {
  BoardData,
  JsonValue,
  WorkItemComment,
  WorkItemFieldDefinition,
  WorkItemOverview as WorkItemOverviewData,
} from "../types";
import { getOverviewFieldSelection, saveOverviewFieldSelection } from "../utils/storage";

interface WorkItemOverviewProps {
  workItemId: number;
  onClose: () => void;
}

function getBoardAssignedToValue(value: JsonValue): string | null {
  if (value === null) {
    return null;
  }

  return formatFieldValue(value);
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
  comments,
  commentsError,
  commentsLoading,
}: {
  overview: WorkItemOverviewData;
  onClose: () => void;
  comments: WorkItemComment[];
  commentsError: unknown;
  commentsLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedReferences, setSelectedReferences] = useState<string[]>([]);
  const [savedFields, setSavedFields] = useState<Record<string, JsonValue>>(overview.fields);
  const [draftFields, setDraftFields] = useState<Record<string, JsonValue>>(overview.fields);

  const availableFields = useMemo(
    () => getOverviewFieldsForWorkItemType(overview.fieldDefinitions, overview.workItemType),
    [overview.fieldDefinitions, overview.workItemType],
  );
  const typeColorClass = TYPE_COLORS[overview.workItemType] ?? DEFAULT_TYPE_COLOR;
  const tagsField = availableFields.find((field) => field.referenceName === TAGS_FIELD_REFERENCE);
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
  const richTextFields = RICH_TEXT_FIELD_ORDER.flatMap((referenceName) => {
    const field = visibleFields.find((candidate) => candidate.referenceName === referenceName);
    return field ? [field] : [];
  });
  const otherFields = visibleFields.filter(
    (field) => !RICH_TEXT_FIELD_ORDER.includes(field.referenceName),
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

  function renderField(field: WorkItemFieldDefinition) {
    return (
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
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className={`flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4 dark:border-gray-700 ${typeColorClass} border-l-4`}
      >
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <WorkItemTypeIcon workItemType={overview.workItemType} className="h-4 w-4" />
            <span>{`${overview.workItemType} #${overview.id}`}</span>
          </div>
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
          {tagsField && (
            <TagsEditor
              value={draftFields[TAGS_FIELD_REFERENCE] ?? null}
              disabled={tagsField.readOnly}
              onChange={(value) =>
                setDraftFields((current) => ({
                  ...current,
                  [TAGS_FIELD_REFERENCE]: value,
                }))
              }
            />
          )}
          <div className="grid grid-cols-[150px_minmax(0,1fr)] items-end gap-x-4 gap-y-2">
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

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4 pt-5">{richTextFields.map(renderField)}</div>
          <div className="grid gap-4 md:grid-cols-2">{otherFields.map(renderField)}</div>
        </div>
        <WorkItemComments
          workItemId={overview.id}
          comments={comments}
          commentsError={commentsError}
          commentsLoading={commentsLoading}
        />
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
  const {
    data: comments = [],
    error: commentsError,
    isLoading: commentsLoading,
  } = useWorkItemComments(workItemId);

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
        {data && (
          <OverviewContent
            overview={data}
            onClose={onClose}
            comments={comments}
            commentsError={commentsError}
            commentsLoading={commentsLoading}
          />
        )}
      </div>
    </div>
  );
}
