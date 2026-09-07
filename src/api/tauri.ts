import { invoke } from "@tauri-apps/api/core";
import type {
  AccountInfo,
  BoardData,
  IdentitySearchResult,
  ProjectInfo,
  ProjectTag,
  TeamInfo,
  WorkItemFieldUpdate,
  WorkItemOverview,
  WorkItemTypeState,
} from "../types";

/** Send the selected organization, project, and area path to the Rust backend. */
export async function setConfig(
  organization: string,
  project: string,
  areaPath: string,
): Promise<void> {
  await invoke("set_config", { organization, project, areaPath });
}

/** Start Microsoft OAuth login in the Rust backend. */
export async function loginMicrosoft(): Promise<void> {
  await invoke("login_microsoft");
}

/** Acquire an ADO token via the Azure CLI (`az account get-access-token`). */
export async function loginAzCli(): Promise<void> {
  await invoke("login_az_cli");
}

/** Store a Personal Access Token in the Rust backend. */
export async function setPat(pat: string): Promise<void> {
  await invoke("set_pat", { pat });
}

/** Clear the persisted auth session in the Rust backend. */
export async function logout(): Promise<void> {
  await invoke("logout");
}

/** Validate the current auth session in the Rust backend. */
export async function checkAuth(): Promise<boolean> {
  return await invoke<boolean>("check_auth");
}

/** Fetch the list of accessible Azure DevOps organizations from the Rust backend. */
export async function listOrganizations(): Promise<AccountInfo[]> {
  return await invoke<AccountInfo[]>("list_organizations");
}

/** Fetch the list of projects in an organization from the Rust backend. */
export async function listProjects(organization: string): Promise<ProjectInfo[]> {
  return await invoke<ProjectInfo[]>("list_projects", { organization });
}

/** Fetch the list of teams in a project from the Rust backend. */
export async function listTeams(organization: string, project: string): Promise<TeamInfo[]> {
  return await invoke<TeamInfo[]>("list_teams", { organization, project });
}

/** Fetch the list of area paths in a project from the Rust backend. */
export async function listAreaPaths(organization: string, project: string): Promise<string[]> {
  return await invoke<string[]>("list_area_paths", { organization, project });
}

/** Fetch all iteration paths in a project from the Rust backend. */
export async function listIterationPaths(organization: string, project: string): Promise<string[]> {
  return await invoke<string[]>("list_iteration_paths", { organization, project });
}

/** Search project tags for work item tag autocomplete. */
export async function searchProjectTags(
  organization: string,
  project: string,
  searchText: string,
): Promise<ProjectTag[]> {
  return await invoke<ProjectTag[]>("search_project_tags", {
    organization,
    project,
    searchText,
  });
}

/** Fetch the full board data (work items + iterations) from the Rust backend. */
export async function getBoardData(): Promise<BoardData> {
  return await invoke<BoardData>("get_board_data");
}

/** Fetch the complete field data and field metadata for a work item. */
export async function getWorkItemOverview(workItemId: number): Promise<WorkItemOverview> {
  return await invoke<WorkItemOverview>("get_work_item_overview", { workItemId });
}

/** Update a work item's state in ADO. */
export async function updateWorkItemState(workItemId: number, newState: string): Promise<void> {
  await invoke("update_work_item_state", { workItemId, newState });
}

/** Update a work item's sprint by changing its iteration path in ADO. */
export async function updateWorkItemIteration(
  workItemId: number,
  newIterationPath: string,
): Promise<void> {
  await invoke("update_work_item_iteration", { workItemId, newIterationPath });
}

/** Update one or more editable Azure DevOps fields. */
export async function updateWorkItemFields(
  workItemId: number,
  updates: WorkItemFieldUpdate[],
): Promise<void> {
  await invoke("update_work_item_fields", { workItemId, updates });
}

/** Fetch valid states for a work item type from ADO. */
export async function getWorkItemTypeStates(workItemType: string): Promise<WorkItemTypeState[]> {
  return await invoke<WorkItemTypeState[]>("get_work_item_type_states", { workItemType });
}

/** Search Azure DevOps identities for assigning a work item. */
export async function searchIdentities(searchText: string): Promise<IdentitySearchResult[]> {
  return await invoke<IdentitySearchResult[]>("search_identities", { searchText });
}

/** Write debug data to a JSON file in the app data directory. Returns the file path written. */
export async function writeDebugLog(data: string): Promise<string> {
  return await invoke<string>("write_debug_log", { data });
}

/** Add a predecessor/successor dependency between two work items in ADO. */
export async function addDependency(sourceId: number, targetId: number): Promise<void> {
  await invoke("add_dependency", { sourceId, targetId });
}

/** Remove a predecessor/successor dependency between two work items in ADO. */
export async function removeDependency(sourceId: number, targetId: number): Promise<void> {
  await invoke("remove_dependency", { sourceId, targetId });
}
