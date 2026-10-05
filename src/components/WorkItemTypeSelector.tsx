import { useEffect, useRef, useState } from "react";
import { partition } from "lodash-es";
import WorkItemTypeIcon from "./WorkItemTypeIcon";
import type { BoardWorkItemType } from "../types";

interface WorkItemTypeSelectorProps {
  value: string;
  options: BoardWorkItemType[];
  recentTypeNames?: string[];
  onChange: (value: string) => void;
  onRemoveRecentType?: (typeName: string) => void;
  disabled?: boolean;
}

const TYPEAHEAD_RESET_DELAY_MS = 600;

interface WorkItemTypeOptionProps {
  type: BoardWorkItemType;
  value: string;
  onSelect: (typeName: string) => void;
  setOptionRef: (element: HTMLButtonElement | null) => void;
  onRemove?: (typeName: string) => void;
}

function WorkItemTypeOption({
  type,
  value,
  onSelect,
  setOptionRef,
  onRemove,
}: WorkItemTypeOptionProps) {
  return (
    <div
      className={`group flex items-center hover:bg-gray-100 dark:hover:bg-gray-800 ${
        type.name === value ? "bg-blue-50 dark:bg-blue-950" : ""
      }`}
    >
      <button
        type="button"
        role="option"
        aria-selected={type.name === value}
        ref={setOptionRef}
        onClick={() => onSelect(type.name)}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <WorkItemTypeIcon workItemType={type.name} className="h-5 w-5 shrink-0" />
        <span className="truncate">{type.name}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${type.name} from recent work item types`}
          onClick={() => onRemove(type.name)}
          className="mr-1 flex shrink-0 self-stretch items-center justify-center rounded px-2 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          {"x"}
        </button>
      )}
    </div>
  );
}

export default function WorkItemTypeSelector({
  value,
  options,
  recentTypeNames,
  onChange,
  onRemoveRecentType,
  disabled = false,
}: WorkItemTypeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [typeaheadText, setTypeaheadText] = useState("");
  const optionRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const listBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!typeaheadText) {
      return;
    }

    const timeout = window.setTimeout(() => setTypeaheadText(""), TYPEAHEAD_RESET_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [typeaheadText]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    window.requestAnimationFrame(() => listBoxRef.current?.focus());
  }, [isOpen]);

  function selectType(typeName: string) {
    onChange(typeName);
    setIsOpen(false);
  }

  const recentTypeNameSet = new Set(recentTypeNames);
  const [recentOptions, regularOptions] = partition(options, (type) =>
    recentTypeNameSet.has(type.name),
  );

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled || options.length === 0}
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 disabled:opacity-50"
      >
        <WorkItemTypeIcon workItemType={value} className="h-4 w-4" />
        <span>{value || "Select work item type"}</span>
        <span aria-hidden="true">{"▾"}</span>
      </button>
      {isOpen && (
        <div
          ref={listBoxRef}
          role="listbox"
          aria-label="Work item type"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setIsOpen(false);
              return;
            }
            if (event.key.length !== 1 || event.key.trim().length === 0) {
              return;
            }

            event.preventDefault();
            const nextTypeaheadText = `${typeaheadText}${event.key}`;
            setTypeaheadText(nextTypeaheadText);
            const matchingType = options.find((type) =>
              type.name.toLowerCase().includes(nextTypeaheadText.toLowerCase()),
            );
            if (matchingType) {
              optionRef.current[matchingType.referenceName]?.focus();
            }
          }}
          className="absolute left-0 top-full z-20 mt-1 max-h-60 w-64 overflow-auto rounded border border-gray-300 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-900"
        >
          {recentOptions.map((type) => (
            <WorkItemTypeOption
              key={type.referenceName}
              type={type}
              value={value}
              onSelect={selectType}
              setOptionRef={(element) => {
                optionRef.current[type.referenceName] = element;
              }}
              onRemove={onRemoveRecentType}
            />
          ))}
          {recentOptions.length > 0 && regularOptions.length > 0 && (
            <div role="separator" className="my-1 border-t border-gray-200 dark:border-gray-700" />
          )}
          {regularOptions.map((type) => (
            <WorkItemTypeOption
              key={type.referenceName}
              type={type}
              value={value}
              onSelect={selectType}
              setOptionRef={(element) => {
                optionRef.current[type.referenceName] = element;
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
