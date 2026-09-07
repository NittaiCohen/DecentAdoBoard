import { describe, expect, it } from "vitest";
import { createMockAiPlan } from "./mockAiPlan";
import { createGeneratedPlanPreview } from "./generatedPlanPreview";

describe("createGeneratedPlanPreview", () => {
  it("maps temporary IDs to negative preview IDs without creating ADO IDs", () => {
    const preview = createGeneratedPlanPreview(
      createMockAiPlan("Create an AI planner", undefined, {
        assignedTo: "Shoham Amar",
        iterationPath: "Project\\Current",
      }),
    );

    expect(preview.boardData.work_items.every((workItem) => workItem.id < 0)).toBe(true);
    expect(preview.temporaryIdByPreviewId.get(-1)).toBe("epic-1");
    expect(preview.boardData.work_items[0]?.assigned_to).toBe("Shoham Amar");
    expect(preview.boardData.work_items[0]?.iteration_path).toBe("Project\\Current");
  });

  it("maps parent and dependency relationships into board data", () => {
    const preview = createGeneratedPlanPreview(createMockAiPlan("Create an AI planner"));
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
});
