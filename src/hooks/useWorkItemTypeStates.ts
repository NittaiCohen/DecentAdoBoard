import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getWorkItemTypeStates } from "../api/tauri";
import { getSavedConfig } from "../utils/storage";

const FIVE_MINUTES_MS = 300_000;

export function useWorkItemTypeStates(workItemType: string, enabled = true) {
  const config = useMemo(() => getSavedConfig(), []);

  return useQuery({
    queryKey: [
      "workItemTypeStates",
      config?.organization ?? "",
      config?.project ?? "",
      workItemType,
    ],
    queryFn: () => getWorkItemTypeStates(workItemType),
    enabled,
    staleTime: FIVE_MINUTES_MS,
  });
}
