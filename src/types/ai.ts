import type { WorkItemType } from "./ado";
import type { Iteration } from "./ado";

export interface GeneratedWorkItem {
  temporaryId: string;
  parentTemporaryId: string | null;
  type: WorkItemType;
  state: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  iterationPath: string;
  assignedTo: string;
  dependencyTemporaryIds: string[];
}

export interface GeneratedWorkItemPlan {
  mission: string;
  items: GeneratedWorkItem[];
}

export interface AiWorkItemTypeMetadata {
  name: string;
  initialState: string;
  states: string[];
}

export interface AiPlannerContext {
  workItemTypes: AiWorkItemTypeMetadata[];
  iterations: Iteration[];
  currentIterationPath: string | null;
  assignedTo: string;
  azureOpenaiConfigured: boolean;
  azureOpenaiConfigurationError: string | null;
}

export interface GenerateWorkItemPlanRequest {
  mission: string;
  refinementRequest?: string;
  currentPlan?: GeneratedWorkItemPlan;
}

export interface SubmitWorkItemPlanRequest {
  plan: GeneratedWorkItemPlan;
  submissionId: string;
  existingAdoIds: Record<string, number>;
}

export interface CreatedWorkItem {
  temporaryId: string;
  adoId: number;
  title: string;
}

export interface SubmitWorkItemPlanResult {
  createdItems: CreatedWorkItem[];
  adoIds: Record<string, number>;
  failedTemporaryId: string | null;
  error: string | null;
}
