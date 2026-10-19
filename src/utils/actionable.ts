import type { WorkItem } from "../types";
import { getAncestors } from "./collections";

export const DONE_STATES = new Set(["Done", "Closed", "Resolved", "Removed"]);

/**
 * Computes the set of actionable work item IDs.
 * A work item is actionable if:
 * 1. It's not in a done state
 * 2. All its predecessors are done
 * 3. Its parent (if any) is also actionable
 */
export function computeActionableSet(workItems: WorkItem[]): Set<number> {
  const stateMap = new Map(workItems.map((workItem) => [workItem.id, workItem.state]));
  const workItemMap = new Map(workItems.map((workItem) => [workItem.id, workItem]));
  const cache = new Map<number, boolean>();

  const isActionable = (id: number): boolean => {
    const cached = cache.get(id);
    if (cached !== undefined) {
      return cached;
    }

    const workItem = workItemMap.get(id);
    if (!workItem) {
      cache.set(id, false);
      return false;
    }

    if (DONE_STATES.has(workItem.state)) {
      cache.set(id, false);
      return false;
    }

    const predsComplete = workItem.predecessors.every((predId) => {
      const predState = stateMap.get(predId);
      return predState && DONE_STATES.has(predState);
    });

    if (!predsComplete) {
      cache.set(id, false);
      return false;
    }

    if (workItem.parent_id) {
      if (!isActionable(workItem.parent_id)) {
        cache.set(id, false);
        return false;
      }
    }

    cache.set(id, true);
    return true;
  };

  return new Set(
    workItems.filter((workItem) => isActionable(workItem.id)).map((workItem) => workItem.id),
  );
}

/**
 * Adds each triggered work item's ancestors so parent cards also show its notification.
 */
export function propagateTriggeredReminderIds(
  workItems: WorkItem[],
  triggeredReminderIds: Set<number>,
): Set<number> {
  const workItemMap = new Map(workItems.map((workItem) => [workItem.id, workItem]));

  const getParent = (currentWorkItem: WorkItem) =>
    currentWorkItem.parent_id === null ? undefined : workItemMap.get(currentWorkItem.parent_id);

  return new Set(
    [...triggeredReminderIds].flatMap((triggeredReminderId) => {
      const workItem = workItemMap.get(triggeredReminderId);

      return [
        triggeredReminderId,
        ...(workItem ? getAncestors(workItem, getParent).map((ancestor) => ancestor.id) : []),
      ];
    }),
  );
}
