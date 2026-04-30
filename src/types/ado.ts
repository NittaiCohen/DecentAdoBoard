export interface WorkItem {
  id: number;
  title: string;
  state: string;
  workItemType: string;
  assignedTo: string | null;
  iterationPath: string;
  areaPath: string;
  predecessors: number[];
  successors: number[];
  parentId: number | null;
  children: number[];
}

export interface Iteration {
  id: string;
  name: string;
  path: string;
  startDate: string | null;
  finishDate: string | null;
}

export interface AdoConfig {
  organization: string;
  project: string;
  areaPath: string;
}
