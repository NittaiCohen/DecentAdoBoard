import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getBoardData, getWorkItemComments, getWorkItemOverview } from "../api/tauri";
import type { BoardData, WorkItemComment, WorkItemOverview } from "../types";

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

/** Fetch work item comments as soon as an overview starts loading. */
export function useWorkItemComments(workItemId: number): UseQueryResult<WorkItemComment[], Error> {
  return useQuery<WorkItemComment[], Error>({
    queryKey: ["workItemComments", workItemId],
    queryFn: () => getWorkItemComments(workItemId),
  });
}
