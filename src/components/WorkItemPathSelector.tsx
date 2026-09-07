import { useQuery } from "@tanstack/react-query";
import { listAreaPaths, listIterationPaths } from "../api/tauri";
import type { JsonValue } from "../types";
import { getSavedConfig } from "../utils/storage";
import ComboBox from "./ComboBox";

type WorkItemPathType = "area" | "iteration";

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
    enabled: organization.length > 0 && project.length > 0,
    staleTime: 300_000,
  });

  return (
    <div className="min-w-56 space-y-1">
      <ComboBox
        value={currentValue}
        onChange={onChange}
        options={query.data ?? []}
        loading={query.isFetching}
        placeholder={`Select or type ${pathType} path`}
        disabled={disabled}
      />
      {query.error && (
        <p className="text-xs text-red-600 dark:text-red-400">{String(query.error)}</p>
      )}
    </div>
  );
}
