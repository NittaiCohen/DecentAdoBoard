import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BoardData } from "../types";
import type { GraphPreviewActions } from "./GraphView";

vi.mock("./GraphView", () => ({
  default: ({
    boardData,
    previewActions,
  }: {
    boardData?: BoardData;
    previewActions?: GraphPreviewActions;
  }) => (
    <div data-testid="mock-graph-view">
      {boardData?.work_items.map((workItem) => (
        <div key={workItem.id}>
          {`${workItem.title} | ${workItem.state} | ${workItem.iteration_path} | ${workItem.assigned_to ?? "Unassigned"}`}
        </div>
      ))}
      <button
        onClick={() => {
          const workItem = boardData?.work_items[0];
          if (workItem) {
            previewActions?.onStateChange(workItem.id, "Active");
          }
        }}
      >
        {"Change preview state"}
      </button>
    </div>
  ),
}));

import AiWorkItemModal from "./AiWorkItemModal";

function renderModal(onClose = vi.fn()) {
  render(
    <AiWorkItemModal
      isOpen
      onClose={onClose}
      mockDelayMs={0}
      defaultAssignedTo="Shoham Amar"
      defaultIterationPath={"Decent ADO Board\\Sprint 7"}
    />,
  );
  return onClose;
}

async function generatePreview() {
  fireEvent.change(screen.getByLabelText("Mission"), {
    target: { value: "Create an AI planning experience" },
  });
  fireEvent.click(screen.getByText("Generate preview"));
  await screen.findByText("Review generated work items");
}

describe("AiWorkItemModal", () => {
  it("requires a mission before generating a preview", () => {
    renderModal();

    fireEvent.click(screen.getByText("Generate preview"));

    expect(screen.getByRole("alert").textContent).toContain("Describe the mission");
  });

  it("shows the mock generated plan in the graph preview", async () => {
    renderModal();

    await generatePreview();

    expect(screen.getByText("Mock preview - nothing has been created in ADO")).toBeTruthy();
    expect(screen.getByTestId("mock-graph-view")).toBeTruthy();
    expect(screen.getByText(/Define the solution/)).toBeTruthy();
  });

  it("uses the current user and sprint as preview defaults", async () => {
    renderModal();
    await generatePreview();

    expect(screen.getAllByText(/Shoham Amar/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Decent ADO Board\\Sprint 7/).length).toBeGreaterThan(0);
  });

  it("applies main-board state changes only to the temporary preview", async () => {
    renderModal();
    await generatePreview();

    fireEvent.click(screen.getByText("Change preview state"));

    expect(screen.getByText(/Create an AI planning experience \| Active/)).toBeTruthy();
    expect(screen.queryByText("Edit selected work item")).toBeNull();
  });

  it("regenerates the plan from a refinement request", async () => {
    renderModal();
    await generatePreview();

    fireEvent.change(screen.getByLabelText("Ask AI to change the plan"), {
      target: { value: "Add a security review task" },
    });
    fireEvent.click(screen.getByText("Regenerate"));

    await waitFor(() => {
      expect(screen.getByLabelText("Ask AI to change the plan")).toHaveProperty("value", "");
    });
  });

  it("shows a non-destructive success state after final submit", async () => {
    renderModal();
    await generatePreview();

    fireEvent.click(screen.getByText("Final submit"));

    expect(await screen.findByText("Mock submission completed")).toBeTruthy();
    expect(screen.getByText(/no work items were created in Azure DevOps/i)).toBeTruthy();
  });

  it("closes when Escape is pressed", () => {
    const onClose = renderModal();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
