import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createWorkItem } from "../api/tauri";
import { useBoardWorkItemTypes, useWorkItemTypeFields } from "../hooks/useAdoData";
import {
  getChildWorkItemTypePreference,
  getRecentWorkItemTypes,
  getSavedConfig,
  isWorkItemType,
  removeChildWorkItemTypePreference,
  removeRecentWorkItemType,
  saveChildWorkItemTypePreference,
  saveRecentWorkItemType,
} from "../utils/storage";
import WorkItemPathSelector from "./WorkItemPathSelector";
import RichTextFieldEditor from "./RichTextFieldEditor";
import { SpecialFieldEditor } from "./WorkItemFieldEditor";
import WorkItemTypeSelector from "./WorkItemTypeSelector";
import { DEFAULT_TYPE_COLOR, TYPE_COLORS } from "../utils/workItemColors";
import {
  AREA_PATH_FIELD_REFERENCE,
  DESCRIPTION_FIELD_REFERENCE,
  getHeaderFields,
  ITERATION_PATH_FIELD_REFERENCE,
  SPECIAL_FIELD_REFERENCES,
  TAGS_FIELD_REFERENCE,
} from "../utils/workItemFieldEditor";
import {
  ALWAYS_VISIBLE_OVERVIEW_FIELD_REFERENCES,
  getDefaultOverviewFieldSelection,
  getOverviewFieldsForWorkItemType,
} from "../config/overviewFields";
import type { JsonValue, WorkItem, WorkItemFieldDefinition, WorkItemFieldUpdate } from "../types";

interface CreateWorkItemDialogProps {
  onClose: () => void;
  isPreloadingFields?: boolean;
  defaultIterationPath?: string | null;
  parentWorkItem?: WorkItem;
}

export default function CreateWorkItemDialog({
  onClose,
  isPreloadingFields = false,
  defaultIterationPath = null,
  parentWorkItem,
}: CreateWorkItemDialogProps) {
  const queryClient = useQueryClient();
  const { data: workItemTypes = [], error, isLoading } = useBoardWorkItemTypes(true);
  const [workItemType, setWorkItemType] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [iterationPath, setIterationPath] = useState(defaultIterationPath ?? "");
  const [fieldValues, setFieldValues] = useState<Record<string, JsonValue>>({});
  const [recentWorkItemTypes, setRecentWorkItemTypes] = useState(() => {
    const recentTypes = getRecentWorkItemTypes();
    if (!parentWorkItem) {
      return recentTypes;
    }

    const childWorkItemTypes = getChildWorkItemTypePreference(parentWorkItem.type);
    const childWorkItemTypeSet = new Set<string>(childWorkItemTypes);
    return [
      ...childWorkItemTypes,
      ...recentTypes.filter((type) => !childWorkItemTypeSet.has(type)),
    ];
  });

  function removeRecentType(workItemType: string) {
    setRecentWorkItemTypes((current) => current.filter((type) => type !== workItemType));
    removeRecentWorkItemType(workItemType);
    if (parentWorkItem && isWorkItemType(workItemType)) {
      removeChildWorkItemTypePreference(parentWorkItem.type, workItemType);
    }
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const additionalFields: WorkItemFieldUpdate[] = Object.entries(fieldValues).map(
        ([referenceName, value]) => ({ referenceName, value }),
      );
      return createWorkItem(
        selectedType,
        title,
        description,
        iterationPath,
        additionalFields,
        parentWorkItem?.id,
      );
    },
    onSuccess: async () => {
      saveRecentWorkItemType(selectedType);
      if (parentWorkItem && isWorkItemType(selectedType)) {
        saveChildWorkItemTypePreference(parentWorkItem.type, selectedType);
      }
      await queryClient.invalidateQueries({ queryKey: ["boardData"] });
      onClose();
    },
  });

  const orderedWorkItemTypes = useMemo(() => {
    const recentTypeSet = new Set(recentWorkItemTypes);
    const recentTypes = recentWorkItemTypes
      .map((recentType) => workItemTypes.find((type) => type.name === recentType))
      .filter((type): type is (typeof workItemTypes)[number] => Boolean(type));

    const remainingTypes = workItemTypes.filter((type) => !recentTypeSet.has(type.name));

    return [...recentTypes, ...remainingTypes];
  }, [recentWorkItemTypes, workItemTypes]);

  const selectedType = workItemTypes.some((type) => type.name === workItemType)
    ? workItemType
    : orderedWorkItemTypes[0]?.name || "";
  const {
    data: fieldDefinitions = [],
    error: fieldError,
    isLoading: isLoadingFields,
  } = useWorkItemTypeFields(selectedType, !isPreloadingFields);
  const isFieldMetadataLoading = isPreloadingFields || isLoadingFields;
  const createFields = useMemo(() => {
    const availableFields = getOverviewFieldsForWorkItemType(fieldDefinitions, selectedType);
    const allowedReferences = new Set([
      ...getDefaultOverviewFieldSelection(availableFields),
      ...ALWAYS_VISIBLE_OVERVIEW_FIELD_REFERENCES,
    ]);

    return availableFields.filter(
      (field) => !field.readOnly && allowedReferences.has(field.referenceName),
    );
  }, [fieldDefinitions, selectedType]);
  const descriptionField = createFields.find(
    (field) => field.referenceName === DESCRIPTION_FIELD_REFERENCE,
  );
  const headerFields = useMemo(() => getHeaderFields(createFields), [createFields]);
  const bodyFields = useMemo(
    () =>
      createFields.filter(
        (field) =>
          !SPECIAL_FIELD_REFERENCES.has(field.referenceName) &&
          field.referenceName !== DESCRIPTION_FIELD_REFERENCE &&
          field.referenceName !== TAGS_FIELD_REFERENCE,
      ),
    [createFields],
  );
  const tagsField = createFields.find((field) => field.referenceName === TAGS_FIELD_REFERENCE);
  const canSubmit =
    !!selectedType &&
    title.trim().length > 0 &&
    !isFieldMetadataLoading &&
    !fieldError &&
    !createMutation.isPending;

  useEffect(() => {
    setFieldValues((current) => {
      const next: Record<string, JsonValue> = {};
      for (const field of createFields) {
        if (field.referenceName in current) {
          next[field.referenceName] = current[field.referenceName];
        } else if (field.referenceName === AREA_PATH_FIELD_REFERENCE) {
          next[field.referenceName] = getSavedConfig()?.areaPath ?? null;
        } else {
          next[field.referenceName] = null;
        }
      }
      return next;
    });
  }, [createFields]);

  function updateField(referenceName: string, value: JsonValue) {
    setFieldValues((current) => ({ ...current, [referenceName]: value }));
  }

  function renderCreateField(field: WorkItemFieldDefinition) {
    const value = fieldValues[field.referenceName] ?? null;
    return (
      <SpecialFieldEditor
        field={field}
        workItemType={selectedType}
        value={value}
        initiallyExpanded
        onChange={(nextValue) => updateField(field.referenceName, nextValue)}
      />
    );
  }

  let fieldContent: ReactNode;
  if (fieldError) {
    fieldContent = <p className="text-sm text-red-600">{String(fieldError)}</p>;
  } else if (isFieldMetadataLoading) {
    fieldContent = (
      <div
        className="flex min-h-48 items-center justify-center gap-3 text-sm text-gray-500 dark:text-gray-400"
        role="status"
        aria-live="polite"
      >
        <span
          className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
          aria-hidden="true"
        />
        <span>{`Loading fields for ${selectedType}...`}</span>
      </div>
    );
  } else {
    fieldContent = (
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {descriptionField && (
            <RichTextFieldEditor
              label={descriptionField.name}
              value={description}
              onChange={setDescription}
              initiallyExpanded
            />
          )}
          {bodyFields
            .filter((field) => field.fieldType.toLowerCase() === "html")
            .map((field) => (
              <div key={field.referenceName}>{renderCreateField(field)}</div>
            ))}
        </div>
        <div className="grid content-start gap-4 md:grid-cols-2">
          {bodyFields
            .filter((field) => field.fieldType.toLowerCase() !== "html")
            .map((field) => (
              <div key={field.referenceName} className="space-y-1 text-sm">
                <label className="block font-medium">{field.name}</label>
                {renderCreateField(field)}
              </div>
            ))}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="flex h-[95vh] w-[95vw] max-w-none flex-col overflow-hidden rounded-xl bg-gray-50 text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-gray-100"
        role="dialog"
        aria-modal="true"
        aria-label="Create work item"
      >
        <div
          className={`flex items-start justify-between gap-4 border-b border-gray-200 border-l-4 px-6 py-4 dark:border-gray-700 ${
            TYPE_COLORS[selectedType] ?? DEFAULT_TYPE_COLOR
          }`}
        >
          <div className="min-w-0 flex-1 space-y-3">
            <WorkItemTypeSelector
              value={selectedType}
              options={orderedWorkItemTypes}
              disabled={isLoading}
              onChange={setWorkItemType}
              recentTypeNames={recentWorkItemTypes}
              onRemoveRecentType={removeRecentType}
            />
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full bg-transparent text-xl font-semibold outline-none ring-0"
              aria-label="Title"
              placeholder="Title"
              autoFocus
            />
            {tagsField && (
              <SpecialFieldEditor
                field={tagsField}
                workItemType={selectedType}
                value={fieldValues[TAGS_FIELD_REFERENCE] ?? null}
                onChange={(value) => updateField(TAGS_FIELD_REFERENCE, value)}
              />
            )}
            <div className="grid grid-cols-[150px_minmax(0,1fr)] items-end gap-x-4 gap-y-2">
              {headerFields.map((field) => (
                <div key={field.referenceName} className="min-w-0 space-y-1">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                    {field.name}
                  </label>
                  {field.referenceName === ITERATION_PATH_FIELD_REFERENCE ? (
                    <WorkItemPathSelector
                      pathType="iteration"
                      value={iterationPath}
                      onChange={(value) => setIterationPath(typeof value === "string" ? value : "")}
                    />
                  ) : (
                    <SpecialFieldEditor
                      field={field}
                      workItemType={selectedType}
                      value={fieldValues[field.referenceName] ?? null}
                      onChange={(value) => updateField(field.referenceName, value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xl text-gray-500"
          >
            {"×"}
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {isLoading && (
            <p className="text-sm text-gray-500">{"Loading project work item types..."}</p>
          )}
          {error && <p className="text-sm text-red-600">{String(error)}</p>}
          {!isLoading && !error && workItemTypes.length === 0 && (
            <p className="text-sm text-red-600">{"This board has no creatable work item types."}</p>
          )}
          {fieldContent}
          {createMutation.error && (
            <p className="text-sm text-red-600">{String(createMutation.error)}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-3 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-gray-200 px-4 py-2 dark:bg-gray-700"
          >
            {"Cancel"}
          </button>
          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={!canSubmit}
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
