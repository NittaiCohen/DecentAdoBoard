import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AiPlannerContext,
  BoardData,
  GeneratedWorkItemPlan,
  GenerateWorkItemPlanRequest,
  SubmitWorkItemPlanRequest,
  SubmitWorkItemPlanResult,
} from "../types";
import type { GraphPreviewActions } from "./GraphView";

const mockContext: AiPlannerContext = {
  workItemTypes: [
    {
      name: "Task",
      initialState: "Proposed",
      states: ["Proposed", "Active"],
    },
  ],
  iterations: [
    {
      id: "current",
      name: "Sprint 7",
      path: "Decent ADO Board\\Sprint 7",
      start_date: "2026-09-01T00:00:00Z",
      finish_date: "2026-09-14T23:59:59Z",
    },
  ],
  currentIterationPath: "Decent ADO Board\\Sprint 7",
  assignedTo: "Shoham Amar",
  azureOpenaiConfigured: true,
  azureOpenaiConfigurationError: null,
};

const generatedPlan: GeneratedWorkItemPlan = {
  mission: "Create an AI planning experience",
  items: [
    {
      temporaryId: "task-1",
      parentTemporaryId: null,
      type: "Task",
      state: "Proposed",
      title: "Create an AI planning experience",
      description: "Build the planner.",
      acceptanceCriteria: "The planner works.",
      iterationPath: "Decent ADO Board\\Sprint 7",
      assignedTo: "Shoham Amar",
      dependencyTemporaryIds: [],
    },
  ],
};

const successfulSubmission: SubmitWorkItemPlanResult = {
  createdItems: [{ temporaryId: "task-1", adoId: 123, title: generatedPlan.items[0].title }],
  adoIds: { "task-1": 123 },
  failedTemporaryId: null,
  error: null,
};

const mocks = vi.hoisted(() => ({
  getAiPlannerContext: vi.fn<() => Promise<AiPlannerContext>>(),
  generateWorkItemPlan:
    vi.fn<(request: GenerateWorkItemPlanRequest) => Promise<GeneratedWorkItemPlan>>(),
  submitWorkItemPlan:
    vi.fn<(request: SubmitWorkItemPlanRequest) => Promise<SubmitWorkItemPlanResult>>(),
}));

vi.mock("../api/tauri", () => mocks);

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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AiWorkItemModal isOpen onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

async function generatePreview() {
  await screen.findByText("Generate preview");
  fireEvent.change(screen.getByLabelText("Mission"), {
    target: { value: generatedPlan.mission },
  });
  fireEvent.click(screen.getByText("Generate preview"));
  await screen.findByText("Review generated work items");
}

describe("AiWorkItemModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAiPlannerContext.mockResolvedValue(mockContext);
    mocks.generateWorkItemPlan.mockResolvedValue(generatedPlan);
    mocks.submitWorkItemPlan.mockResolvedValue(successfulSubmission);
  });

  it("requires a mission before generating a preview", async () => {
    renderModal();
    await waitFor(() =>
      expect(screen.getByText("Generate preview")).not.toHaveProperty("disabled", true),
    );

    fireEvent.click(screen.getByText("Generate preview"));

    expect(screen.getByRole("alert").textContent).toContain("Describe the mission");
  });

  it("shows the generated plan with ADO-derived defaults", async () => {
    renderModal();
    await generatePreview();

    expect(screen.getByText("Preview - nothing has been created in ADO")).toBeTruthy();
    expect(screen.getByTestId("mock-graph-view")).toBeTruthy();
    expect(screen.getByText(/Create an AI planning experience \| Proposed/)).toBeTruthy();
    expect(screen.getByText(/Shoham Amar/)).toBeTruthy();
    expect(screen.getByText(/Decent ADO Board\\Sprint 7/)).toBeTruthy();
  });

  it("applies main-board state changes only to the temporary preview", async () => {
    renderModal();
    await generatePreview();

    fireEvent.click(screen.getByText("Change preview state"));

    expect(screen.getByText(/Create an AI planning experience \| Active/)).toBeTruthy();
  });

  it("regenerates using the current plan and refinement request", async () => {
    renderModal();
    await generatePreview();

    fireEvent.change(screen.getByLabelText("Ask AI to change the plan"), {
      target: { value: "Add a security review task" },
    });
    fireEvent.click(screen.getByText("Regenerate"));

    await waitFor(() => {
      expect(mocks.generateWorkItemPlan).toHaveBeenLastCalledWith({
        mission: generatedPlan.mission,
        refinementRequest: "Add a security review task",
        currentPlan: generatedPlan,
      });
    });
  });

  it("requires confirmation before creating work items in ADO", async () => {
    renderModal();
    await generatePreview();

    fireEvent.click(screen.getByText("Final submit"));

    expect(screen.getByText("Create these work items in Azure DevOps?")).toBeTruthy();
    expect(mocks.submitWorkItemPlan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Create in ADO"));
    expect(await screen.findByText("Work items created in Azure DevOps")).toBeTruthy();
    const request = mocks.submitWorkItemPlan.mock.calls[0]?.[0];
    expect(request?.plan).toEqual(generatedPlan);
    expect(request?.existingAdoIds).toEqual({});
    expect(request?.submissionId).not.toBe("");
  });

  it("freezes the plan after a partial ADO write and retries with the same submission", async () => {
    mocks.submitWorkItemPlan
      .mockResolvedValueOnce({
        createdItems: successfulSubmission.createdItems,
        adoIds: { "task-1": 123 },
        failedTemporaryId: "task-2",
        error: "ADO rejected task-2",
      })
      .mockResolvedValueOnce(successfulSubmission);
    renderModal();
    await generatePreview();

    fireEvent.click(screen.getByText("Final submit"));
    fireEvent.click(screen.getByText("Create in ADO"));
    expect(await screen.findByText("ADO submission stopped")).toBeTruthy();
    expect(screen.queryByText("Back to preview")).toBeNull();
    expect(screen.getByLabelText("Close AI planner")).toHaveProperty("disabled", true);

    const firstRequest = mocks.submitWorkItemPlan.mock.calls[0][0];
    fireEvent.click(screen.getByText("Retry submission"));
    await screen.findByText("Work items created in Azure DevOps");
    const secondRequest = mocks.submitWorkItemPlan.mock.calls[1][0];

    expect(secondRequest.submissionId).toBe(firstRequest.submissionId);
    expect(secondRequest.existingAdoIds).toEqual({ "task-1": 123 });
  });

  it("shows missing Azure OpenAI configuration", async () => {
    mocks.getAiPlannerContext.mockResolvedValue({
      ...mockContext,
      azureOpenaiConfigured: false,
      azureOpenaiConfigurationError:
        "Environment variable DECENT_ADO_BOARD_AZURE_OPENAI_ENDPOINT is not configured",
    });
    renderModal();

    expect(await screen.findByText("Azure OpenAI is not configured")).toBeTruthy();
    expect(screen.getByText("Generate preview")).toHaveProperty("disabled", true);
  });

  it("closes when Escape is pressed", async () => {
    const onClose = renderModal();
    await screen.findByText("Generate preview");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
