import type { WorkItem } from "../types";

/**
 * Check whether adding a successor edge from sourceId → targetId would create
 * a cycle in the dependency graph. Uses BFS from targetId following successor
 * links — if we can reach sourceId, adding the edge would be circular.
 */
export function wouldCreateCycle(
  sourceId: number,
  targetId: number,
  workItemMap: Map<number, WorkItem>,
): boolean {
  if (sourceId === targetId) {
    return true;
  }

  const visited = new Set<number>();
  const queue = [targetId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }
    if (current === sourceId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const item = workItemMap.get(current);
    if (item) {
      for (const succId of item.successors) {
        if (!visited.has(succId)) {
          queue.push(succId);
        }
      }
    }
  }

  return false;
}
