import AssignedToSelector from "./AssignedToSelector";
import TagsEditor from "./TagsEditor";
import WorkItemPathSelector from "./WorkItemPathSelector";
import RichTextFieldEditor from "./RichTextFieldEditor";
import StateBadge from "./StateBadge";
import StateSelector from "./StateSelector";
import { useWorkItemTypeStates } from "../hooks/useWorkItemTypeStates";
import { getOrderedStateOptions } from "../utils/workItemStates";
import type { JsonValue, WorkItemFieldDefinition } from "../types";
import {
  ASSIGNED_TO_FIELD_REFERENCE,
  AREA_PATH_FIELD_REFERENCE,
  formatFieldValue,
  getInputValue,
  ITERATION_PATH_FIELD_REFERENCE,
  parseInputValue,
  STATE_FIELD_REFERENCE,
  TAGS_FIELD_REFERENCE,
} from "../utils/workItemFieldEditor";

function isComplexField(fieldType: string): boolean {
  return fieldType.toLowerCase() === "identity";
}

export function FieldEditor({
  field,
  value,
  onChange,
  initiallyExpanded = false,
}: {
  field: WorkItemFieldDefinition;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  initiallyExpanded?: boolean;
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
        initiallyExpanded={initiallyExpanded}
        onChange={onChange}
      />
    );
  }

  if (disabled) {
    return (
      <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
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

export function SpecialFieldEditor({
  field,
  workItemType,
  value,
  onChange,
  initiallyExpanded = false,
}: {
  field: WorkItemFieldDefinition;
  workItemType: string;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  initiallyExpanded?: boolean;
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

  if (field.referenceName === TAGS_FIELD_REFERENCE) {
    return <TagsEditor value={value} disabled={field.readOnly} onChange={onChange} />;
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

  return (
    <FieldEditor
      field={field}
      value={value}
      initiallyExpanded={initiallyExpanded}
      onChange={onChange}
    />
  );
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
  const { data: stateDefinitions = [] } = useWorkItemTypeStates(workItemType);
  const orderedStateOptions = getOrderedStateOptions(
    stateDefinitions,
    field.allowedValues.map(getInputValue),
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
