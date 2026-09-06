import { useQuery } from "@tanstack/react-query";
import { getBoardData, getWorkItemOverview } from "../api/tauri";
import type { BoardData, WorkItemOverview } from "../types";

/** React Query hook that fetches board data when enabled. */
export function useBoardData(enabled: boolean) {
  return useQuery<BoardData>({
    queryKey: ["boardData"],
    queryFn: getBoardData,
    enabled,
  });
}

/** Fetch detailed work item fields and metadata when an overview is open. */
export function useWorkItemOverview(workItemId: number) {
  return useQuery<WorkItemOverview>({
    queryKey: ["workItemOverview", workItemId],
    queryFn: () => getWorkItemOverview(workItemId),
  });
}
