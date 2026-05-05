export interface WorkItem {
  id: number;
  title: string;
  state: string;
  work_item_type: string;
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

export interface PatGenerationResult {
  pat: string;
  organization: string;
  display_name: string;
  valid_to: string;
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
