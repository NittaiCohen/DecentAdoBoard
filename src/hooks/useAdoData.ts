import { type QueryClient, useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  getBoardData,
  getBoardWorkItemTypes,
  getWorkItemComments,
  getWorkItemOverview,
  getWorkItemTypeFields,
  getWorkItemTypeFieldsBatch,
  getWorkItemTypeIcon,
  refreshWorkItemTypeFieldsBatch,
} from "../api/tauri";
import type {
  BoardData,
  BoardWorkItemType,
  WorkItemComment,
  WorkItemFieldDefinition,
  WorkItemOverview,
} from "../types";

/** React Query hook that fetches board data when enabled. */
export function useBoardData(enabled: boolean) {
  return useQuery<BoardData>({
    queryKey: ["boardData"],
    queryFn: getBoardData,
    enabled,
  });
}

/** Fetch work item types available on the selected board. */
export function useBoardWorkItemTypes(enabled: boolean) {
  return useQuery<BoardWorkItemType[]>({
    queryKey: ["boardWorkItemTypes"],
    queryFn: getBoardWorkItemTypes,
    enabled,
  });
}

function cacheWorkItemTypeFields(
  queryClient: QueryClient,
  fieldDefinitionsByType: Record<string, WorkItemFieldDefinition[]>,
): void {
  for (const [workItemType, fieldDefinitions] of Object.entries(fieldDefinitionsByType)) {
    queryClient.setQueryData(["workItemTypeFields", workItemType], fieldDefinitions);
  }
}

/** Preload all project work item types and their icons before opening the create dialog. */
export async function prefetchBoardWorkItemTypes(queryClient: QueryClient): Promise<void> {
  const workItemTypes = await queryClient.ensureQueryData<BoardWorkItemType[]>({
    queryKey: ["boardWorkItemTypes"],
    queryFn: getBoardWorkItemTypes,
  });

  const iconKeys = new Set(
    workItemTypes
      .filter((type) => type.iconId && type.color)
      .map((type) => `${type.iconId}:${type.color}`),
  );

  const workItemTypeFields = getWorkItemTypeFieldsBatch(workItemTypes.map((type) => type.name));

  const iconPrefetches = [...iconKeys].map((iconKey) => {
    const separatorIndex = iconKey.indexOf(":");
    const iconId = iconKey.slice(0, separatorIndex);
    const color = iconKey.slice(separatorIndex + 1);
    return queryClient.prefetchQuery({
      queryKey: ["workItemTypeIcon", iconId, color],
      queryFn: () => getWorkItemTypeIcon(iconId, color),
      staleTime: Infinity,
    });
  });

  const [{ fieldDefinitionsByType, fromCache }] = await Promise.all([
    workItemTypeFields,
    Promise.all(iconPrefetches),
  ]);

  cacheWorkItemTypeFields(queryClient, fieldDefinitionsByType);

  if (fromCache) {
    void refreshWorkItemTypeFieldsBatch(workItemTypes.map((type) => type.name)).then(
      (refreshedDefinitionsByType) => {
        cacheWorkItemTypeFields(queryClient, refreshedDefinitionsByType);
      },
      (error) => {
        console.error("Failed to refresh cached work item type fields", error);
      },
    );
  }
}

/** Fetch an authenticated icon for a work item type when its metadata is available. */
export function useWorkItemTypeIcon(
  iconId: string | null | undefined,
  color: string | null | undefined,
) {
  return useQuery<string, Error>({
    queryKey: ["workItemTypeIcon", iconId, color],
    queryFn: () => {
      if (!iconId || !color) {
        return Promise.reject(new Error("Work item icon metadata is incomplete"));
      }
      return getWorkItemTypeIcon(iconId, color);
    },
    enabled: Boolean(iconId && color),
    staleTime: Infinity,
  });
}

/** Fetch detailed work item fields and metadata when an overview is open. */
export function useWorkItemOverview(workItemId: number) {
  return useQuery<WorkItemOverview>({
    queryKey: ["workItemOverview", workItemId],
    queryFn: () => getWorkItemOverview(workItemId),
  });
}

/** Fetch fields supported by a work item type for the create form. */
export function useWorkItemTypeFields(workItemType: string, enabled = true) {
  return useQuery<WorkItemFieldDefinition[]>({
    queryKey: ["workItemTypeFields", workItemType],
    queryFn: () => getWorkItemTypeFields(workItemType),
    enabled: enabled && workItemType.length > 0,
    staleTime: 300_000,
  });
}

/** Fetch work item comments as soon as an overview starts loading. */
export function useWorkItemComments(workItemId: number): UseQueryResult<WorkItemComment[], Error> {
  return useQuery<WorkItemComment[], Error>({
    queryKey: ["workItemComments", workItemId],
    queryFn: () => getWorkItemComments(workItemId),
  });
}
