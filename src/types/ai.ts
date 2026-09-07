import type { WorkItemType } from "./ado";

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
