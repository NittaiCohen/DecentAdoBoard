import { invoke } from "@tauri-apps/api/core";
import type { AccountInfo, BoardData, ProjectInfo, TeamInfo, WorkItemTypeState } from "../types";

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

/** Fetch the full board data (work items + iterations) from the Rust backend. */
export async function getBoardData(): Promise<BoardData> {
  return await invoke<BoardData>("get_board_data");
}

/** Update a work item's state in ADO. */
export async function updateWorkItemState(workItemId: number, newState: string): Promise<void> {
  await invoke("update_work_item_state", { workItemId, newState });
}

/** Fetch valid states for a work item type from ADO. */
export async function getWorkItemTypeStates(workItemType: string): Promise<WorkItemTypeState[]> {
  return await invoke<WorkItemTypeState[]>("get_work_item_type_states", { workItemType });
}

/** Write debug data to a JSON file in the app data directory. Returns the file path written. */
export async function writeDebugLog(data: string): Promise<string> {
  return await invoke<string>("write_debug_log", { data });
}

/** Add a predecessor/successor dependency between two work items in ADO. */
export async function addDependency(sourceId: number, targetId: number): Promise<void> {
  await invoke("add_dependency", { sourceId, targetId });
}
