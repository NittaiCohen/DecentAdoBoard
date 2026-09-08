export type WorkItemType =
  | "Bug"
  | "Task"
  | "User Story"
  | "Feature"
  | "Epic"
  | "Product Backlog Item";

export interface WorkItem {
  id: number;
  title: string;
  state: string;
  type: WorkItemType;
  assigned_to: string | null;
  iteration_path: string;
  area_path: string;
  predecessors: number[];
  successors: number[];
  parent_id: number | null;
  children: number[];
}

export interface Iteration {
  id: string;
  name: string;
  path: string;
  start_date: string | null;
  finish_date: string | null;
}

export interface AdoConfig {
  organization: string;
  project: string;
  team: string;
  areaPath: string;
}

export interface BoardData {
  work_items: WorkItem[];
  iterations: Iteration[];
}

export interface AccountInfo {
  accountName: string;
  accountId: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
}

export interface TeamInfo {
  id: string;
  name: string;
}

export interface WorkItemTypeState {
  name: string;
  color: string;
  category: string;
}

export interface IdentitySearchResult {
  displayName: string;
  uniqueName: string;
  avatarDataUrl: string | null;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface WorkItemFieldDefinition {
  referenceName: string;
  name: string;
  fieldType: string;
  readOnly: boolean;
  alwaysRequired: boolean;
  allowedValues: JsonValue[];
}

export interface WorkItemOverview {
  id: number;
  workItemType: string;
  fields: Record<string, JsonValue>;
  fieldDefinitions: WorkItemFieldDefinition[];
}

export interface ProjectTag {
  name: string;
}

export interface WorkItemComment {
  id: number;
  text: string;
  renderedText: string | null;
  createdBy: string;
  createdDate: string;
  isDeleted: boolean;
}

export interface WorkItemFieldUpdate {
  referenceName: string;
  value: JsonValue;
}
