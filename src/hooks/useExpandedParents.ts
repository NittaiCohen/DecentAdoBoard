import { useCallback, useEffect, useState } from "react";
import { isNil } from "lodash-es";
import type { BoardData, RequiredSome, WorkItem } from "../types";

type ExpandedParentsResult = [Set<number>, (id: number) => void];

export function useExpandedParents(boardData: BoardData | undefined): ExpandedParentsResult {
  const [expandedParents, setExpandedParents] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (!boardData) {
      return;
    }
    const parentIds = new Set(
      boardData.work_items
        .filter(
          (workItem): workItem is RequiredSome<WorkItem, "parent_id"> => !isNil(workItem.parent_id),
        )
        .map((workItem) => workItem.parent_id),
    );
    setExpandedParents((prev) => {
      const next = new Set(prev);
      for (const id of parentIds) {
        next.add(id);
      }
      return next;
    });
  }, [boardData]);

  const handleToggleExpand = useCallback((id: number) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return [expandedParents, handleToggleExpand];
}
