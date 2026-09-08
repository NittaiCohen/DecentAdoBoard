import type { BoardData, GeneratedWorkItemPlan, Iteration, WorkItem } from "../types";

const PREVIEW_ID_START = 1;
const DEFAULT_PREVIEW_ITERATION = "Unscheduled";
const ITERATION_PATH_SEPARATOR = "\\";

export interface GeneratedPlanPreview {
  boardData: BoardData;
  temporaryIdByPreviewId: Map<number, string>;
}

function createPreviewIterations(workItems: WorkItem[]): Iteration[] {
  const iterationPaths = [...new Set(workItems.map((workItem) => workItem.iteration_path))];

  return iterationPaths.map((path, index) => ({
    id: `ai-preview-iteration-${index + PREVIEW_ID_START}`,
    name: path.includes(ITERATION_PATH_SEPARATOR)
      ? path.slice(path.lastIndexOf(ITERATION_PATH_SEPARATOR) + ITERATION_PATH_SEPARATOR.length)
      : path,
    path,
    start_date: null,
    finish_date: null,
  }));
}

export function createGeneratedPlanPreview(
  plan: GeneratedWorkItemPlan,
  availableIterations?: Iteration[],
): GeneratedPlanPreview {
  const previewIdByTemporaryId = new Map<string, number>();
  const temporaryIdByPreviewId = new Map<number, string>();

  plan.items.forEach((item, index) => {
    // These IDs exist only inside the isolated preview graph and are never submitted to ADO.
    // Positive IDs follow the same rendering path as real ADO items; negative React Flow IDs
    // caused dependency edges to disappear even though the relationship data was correct.
    const previewId = index + PREVIEW_ID_START;
    previewIdByTemporaryId.set(item.temporaryId, previewId);
    temporaryIdByPreviewId.set(previewId, item.temporaryId);
  });

  const childIdsByParentId = new Map<number, number[]>();
  const successorIdsByPredecessorId = new Map<number, number[]>();

  for (const item of plan.items) {
    const previewId = previewIdByTemporaryId.get(item.temporaryId);
    if (previewId === undefined) {
      continue;
    }

    if (item.parentTemporaryId) {
      const parentId = previewIdByTemporaryId.get(item.parentTemporaryId);
      if (parentId !== undefined) {
        const childIds = childIdsByParentId.get(parentId) ?? [];
        childIds.push(previewId);
        childIdsByParentId.set(parentId, childIds);
      }
    }

    for (const dependencyTemporaryId of item.dependencyTemporaryIds) {
      const predecessorId = previewIdByTemporaryId.get(dependencyTemporaryId);
      if (predecessorId !== undefined) {
        const successorIds = successorIdsByPredecessorId.get(predecessorId) ?? [];
        successorIds.push(previewId);
        successorIdsByPredecessorId.set(predecessorId, successorIds);
      }
    }
  }

  const workItems: WorkItem[] = plan.items.map((item) => {
    const previewId = previewIdByTemporaryId.get(item.temporaryId);
    if (previewId === undefined) {
      throw new Error(`Missing preview ID for generated item '${item.temporaryId}'`);
    }

    const parentId = item.parentTemporaryId
      ? (previewIdByTemporaryId.get(item.parentTemporaryId) ?? null)
      : null;
    const predecessorIds = item.dependencyTemporaryIds.flatMap((temporaryId) => {
      const predecessorId = previewIdByTemporaryId.get(temporaryId);
      return predecessorId === undefined ? [] : [predecessorId];
    });

    return {
      id: previewId,
      title: item.title,
      state: item.state,
      type: item.type,
      assigned_to: item.assignedTo.trim() || null,
      iteration_path: item.iterationPath.trim() || DEFAULT_PREVIEW_ITERATION,
      area_path: "AI Preview",
      predecessors: predecessorIds,
      successors: successorIdsByPredecessorId.get(previewId) ?? [],
      parent_id: parentId,
      children: childIdsByParentId.get(previewId) ?? [],
    };
  });

  return {
    boardData: {
      work_items: workItems,
      iterations:
        availableIterations && availableIterations.length > 0
          ? availableIterations
          : createPreviewIterations(workItems),
    },
    temporaryIdByPreviewId,
  };
}
