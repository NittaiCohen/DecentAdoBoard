import type { WorkItem } from "../types";

/** Create a WorkItem with sensible defaults, requiring at minimum an `id`. */
export function generateWorkItem(
  overrides: Partial<WorkItem> & Required<Pick<WorkItem, "id">>,
): WorkItem {
  return {
    title: `Item ${overrides.id}`,
    state: "New",
    work_item_type: "Task",
    assigned_to: null,
    iteration_path: "Sprint1",
    area_path: "Area",
    predecessors: [],
    successors: [],
    parent_id: null,
    children: [],
    ...overrides,
  };
}
