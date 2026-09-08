import { useEffect, useRef, useState } from "react";
import WorkItemTypeIcon from "./WorkItemTypeIcon";
import type { BoardWorkItemType } from "../types";

interface WorkItemTypeSelectorProps {
  value: string;
  options: BoardWorkItemType[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

const TYPEAHEAD_RESET_DELAY_MS = 600;

export default function WorkItemTypeSelector({
  value,
  options,
  onChange,
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
          {options.map((type) => (
            <button
              key={type.referenceName}
              type="button"
              role="option"
              aria-selected={type.name === value}
              ref={(element) => {
                optionRef.current[type.referenceName] = element;
              }}
              onClick={() => selectType(type.name)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${
                type.name === value ? "bg-blue-50 dark:bg-blue-950" : ""
              }`}
            >
              <WorkItemTypeIcon workItemType={type.name} className="h-5 w-5 shrink-0" />
              <span className="truncate">{type.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
