import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAreaPaths, listIterationPaths } from "../api/tauri";
import type { JsonValue } from "../types";
import { getSavedConfig } from "../utils/storage";

type WorkItemPathType = "area" | "iteration";
const MAX_VISIBLE_PATH_OPTIONS = 30;
const PATH_SELECTOR_BLUR_DELAY_MS = 150;

interface WorkItemPathSelectorProps {
  pathType: WorkItemPathType;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  disabled?: boolean;
}

function getPathValue(value: JsonValue): string {
  return typeof value === "string" ? value : "";
}

export default function WorkItemPathSelector({
  pathType,
  value,
  onChange,
  disabled = false,
}: WorkItemPathSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const savedConfig = getSavedConfig();
  const organization = savedConfig?.organization ?? "";
  const project = savedConfig?.project ?? "";
  const currentValue = getPathValue(value);
  const query = useQuery({
    queryKey: ["workItemPathOptions", pathType, organization, project],
    queryFn: () =>
      pathType === "area"
        ? listAreaPaths(organization, project)
        : listIterationPaths(organization, project),
    enabled: isOpen && organization.length > 0 && project.length > 0,
    staleTime: 300_000,
  });
  const normalizedValue = currentValue.trim().toLowerCase();
  const matchingPaths = (query.data ?? [])
    .filter((path) => path.toLowerCase().includes(normalizedValue))
    .slice(0, MAX_VISIBLE_PATH_OPTIONS);

  if (disabled) {
    return (
      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
        {currentValue || "Not set"}
      </p>
    );
  }

  return (
    <div className="relative min-w-56">
      <input
        type="text"
        value={currentValue}
        onFocus={() => setIsOpen(true)}
        onChange={(event) => {
          setIsOpen(true);
          onChange(event.target.value);
        }}
        onBlur={() => setTimeout(() => setIsOpen(false), PATH_SELECTOR_BLUR_DELAY_MS)}
        placeholder={`Search ${pathType} paths`}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
      />
      {isOpen && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          {query.isFetching && (
            <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              {"Loading paths..."}
            </p>
          )}
          {query.error && (
            <p className="px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {String(query.error)}
            </p>
          )}
          {!query.isFetching && !query.error && matchingPaths.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              {"No matching paths"}
            </p>
          )}
          {matchingPaths.map((path) => (
            <button
              key={path}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(path);
                setIsOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-blue-600 hover:text-white dark:text-gray-200"
            >
              {path}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
