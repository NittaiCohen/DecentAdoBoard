import type { GeneratedWorkItemPlan } from "../types";

const MISSION_SUMMARY_MAX_LENGTH = 64;
const ELLIPSIS = "...";
const DEFAULT_ASSIGNED_TO = "";
const DEFAULT_ITERATION_PATH = "Current sprint";

interface MockAiPlanDefaults {
  assignedTo?: string;
  iterationPath?: string;
}

function missionSummary(mission: string): string {
  const normalizedMission = mission.replace(/\s+/g, " ").trim();
  return normalizedMission.length > MISSION_SUMMARY_MAX_LENGTH
    ? `${normalizedMission.slice(0, MISSION_SUMMARY_MAX_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`
    : normalizedMission;
}

// eslint-disable-next-line max-lines-per-function
export function createMockAiPlan(
  mission: string,
  refinementRequest?: string,
  defaults: MockAiPlanDefaults = {},
): GeneratedWorkItemPlan {
  const summary = missionSummary(mission);
  const refinement = refinementRequest?.trim();
  const refinementNote = refinement ? ` Requested refinement: ${refinement}` : "";
  const assignedTo = defaults.assignedTo ?? DEFAULT_ASSIGNED_TO;
  const iterationPath = defaults.iterationPath ?? DEFAULT_ITERATION_PATH;

  return {
    mission,
    items: [
      {
        temporaryId: "epic-1",
        parentTemporaryId: null,
        type: "Epic",
        state: "New",
        title: summary,
        description: `Deliver the requested mission: ${mission.trim()}.${refinementNote}`,
        acceptanceCriteria:
          "The complete mission is represented by reviewed, actionable work items.",
        iterationPath,
        assignedTo,
        dependencyTemporaryIds: [],
      },
      {
        temporaryId: "feature-1",
        parentTemporaryId: "epic-1",
        type: "Feature",
        state: "New",
        title: "Define the solution",
        description:
          "Clarify the expected user experience, technical approach, and delivery boundaries.",
        acceptanceCriteria: "The team agrees on scope, behavior, and measurable outcomes.",
        iterationPath,
        assignedTo,
        dependencyTemporaryIds: [],
      },
      {
        temporaryId: "story-1",
        parentTemporaryId: "feature-1",
        type: "User Story",
        state: "New",
        title: "Implement the primary user flow",
        description: "Build the main experience required to complete the mission.",
        acceptanceCriteria:
          "A user can complete the primary flow and receives clear success or error feedback.",
        iterationPath,
        assignedTo,
        dependencyTemporaryIds: [],
      },
      {
        temporaryId: "task-1",
        parentTemporaryId: "story-1",
        type: "Task",
        state: "New",
        title: "Build and validate the implementation",
        description: "Implement the planned behavior and cover the important states with tests.",
        acceptanceCriteria: "The implementation passes its targeted automated checks.",
        iterationPath,
        assignedTo,
        dependencyTemporaryIds: [],
      },
      {
        temporaryId: "task-2",
        parentTemporaryId: "story-1",
        type: "Task",
        state: "New",
        title: "Review the completed user flow",
        description: `Review the result against the original mission.${refinementNote}`,
        acceptanceCriteria: refinement
          ? `The review confirms this refinement is addressed: ${refinement}`
          : "The review confirms the result matches the original mission.",
        iterationPath,
        assignedTo,
        dependencyTemporaryIds: ["task-1"],
      },
    ],
  };
}
