import { describe, expect, it } from "vitest";
import type { GeneratedWorkItemPlan } from "../types";
import { buildGraphLayout } from "./graphLayout";
import { createGeneratedPlanPreview } from "./generatedPlanPreview";

function generatedPlan(): GeneratedWorkItemPlan {
  return {
    mission: "Create an AI planner",
    items: [
      {
        temporaryId: "story-1",
        parentTemporaryId: null,
        type: "User Story",
        state: "Proposed",
        title: "Implement the primary flow",
        description: "",
        acceptanceCriteria: "",
        iterationPath: "Project\\Current",
        assignedTo: "Shoham Amar",
        dependencyTemporaryIds: [],
      },
      {
        temporaryId: "task-1",
        parentTemporaryId: "story-1",
        type: "Task",
        state: "Proposed",
        title: "Build and validate the implementation",
        description: "",
        acceptanceCriteria: "",
        iterationPath: "Project\\Current",
        assignedTo: "Shoham Amar",
        dependencyTemporaryIds: [],
      },
      {
        temporaryId: "task-2",
        parentTemporaryId: "story-1",
        type: "Task",
        state: "Proposed",
        title: "Review the implementation",
        description: "",
        acceptanceCriteria: "",
        iterationPath: "Project\\Current",
        assignedTo: "Shoham Amar",
        dependencyTemporaryIds: ["task-1"],
      },
    ],
  };
}

describe("createGeneratedPlanPreview", () => {
  it("maps temporary IDs to isolated preview IDs without creating ADO IDs", () => {
    const preview = createGeneratedPlanPreview(generatedPlan());

    expect(preview.boardData.work_items.every((workItem) => workItem.id > 0)).toBe(true);
    expect(preview.temporaryIdByPreviewId.get(1)).toBe("story-1");
    expect(preview.boardData.work_items[0]?.assigned_to).toBe("Shoham Amar");
    expect(preview.boardData.work_items[0]?.iteration_path).toBe("Project\\Current");
  });

  it("maps parent and dependency relationships into board data", () => {
    const preview = createGeneratedPlanPreview(generatedPlan());
    const story = preview.boardData.work_items.find((workItem) =>
      workItem.title.includes("primary"),
    );
    const implementationTask = preview.boardData.work_items.find((workItem) =>
      workItem.title.includes("Build and validate"),
    );
    const reviewTask = preview.boardData.work_items.find((workItem) =>
      workItem.title.includes("Review"),
    );

    expect(implementationTask?.parent_id).toBe(story?.id);
    expect(reviewTask?.predecessors).toContain(implementationTask?.id);
    expect(implementationTask?.successors).toContain(reviewTask?.id);
  });

  it("renders generated dependencies as graph edges", () => {
    const preview = createGeneratedPlanPreview(generatedPlan());
    const expandedParents = new Set(
      preview.boardData.work_items.flatMap((workItem) =>
        workItem.parent_id === null ? [] : [workItem.parent_id],
      ),
    );
    const layout = buildGraphLayout(preview.boardData, expandedParents);

    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]?.source).toBe("wi-2");
    expect(layout.edges[0]?.target).toBe("wi-3");
    expect(layout.edges[0]?.data?.path).toBeTruthy();
  });
});
