import { useQuery } from "@tanstack/react-query";
import { getBoardData } from "../api/tauri";
import type { BoardData } from "../types";

/** React Query hook that fetches board data when enabled. */
export function useBoardData(enabled: boolean) {
  return useQuery<BoardData>({
    queryKey: ["boardData"],
    queryFn: getBoardData,
    enabled,
  });
}
