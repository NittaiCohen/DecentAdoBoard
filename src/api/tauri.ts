import { invoke } from "@tauri-apps/api/core";
import type {
  AccountInfo,
  AiPlannerContext,
  BoardData,
  BoardWorkItemType,
  GeneratedWorkItemPlan,
  GenerateWorkItemPlanRequest,
  IdentitySearchResult,
  ProjectInfo,
  ProjectTag,
  SubmitWorkItemPlanRequest,
  SubmitWorkItemPlanResult,
  TeamInfo,
  WorkItemComment,
  WorkItemFieldDefinition,
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
  await invoke("set_config", {
    organization,
    project,
    areaPath,
  });
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

/** Fetch the work item types allowed by the selected board. */
export async function getBoardWorkItemTypes(): Promise<BoardWorkItemType[]> {
  return await invoke<BoardWorkItemType[]>("get_board_work_item_types");
}

/** Fetch an authenticated Azure DevOps work item type icon as a data URL. */
export async function getWorkItemTypeIcon(iconId: string, color: string): Promise<string> {
  return await invoke<string>("get_work_item_type_icon", { iconId, color });
}

/** Create a work item using a board-supported work item type. */
export async function createWorkItem(
  workItemType: string,
  title: string,
  description?: string,
  iterationPath?: string,
  additionalFields?: WorkItemFieldUpdate[],
): Promise<number> {
  return await invoke<number>("create_work_item", {
    workItemType,
    title,
    description,
    iterationPath,
    additionalFields,
  });
}

/** Fetch the complete field data and field metadata for a work item. */
export async function getWorkItemOverview(workItemId: number): Promise<WorkItemOverview> {
  return await invoke<WorkItemOverview>("get_work_item_overview", { workItemId });
}

/** Fetch fields supported by a work item type for the create form. */
export async function getWorkItemTypeFields(
  workItemType: string,
): Promise<WorkItemFieldDefinition[]> {
  return await invoke<WorkItemFieldDefinition[]>("get_work_item_type_fields", { workItemType });
}

export interface WorkItemTypeFieldsBatchResult {
  fieldDefinitionsByType: Record<string, WorkItemFieldDefinition[]>;
  fromCache: boolean;
}

/** Fetch cached field definitions for several work item types in one backend request. */
export async function getWorkItemTypeFieldsBatch(
  workItemTypes: string[],
): Promise<WorkItemTypeFieldsBatchResult> {
  return await invoke<WorkItemTypeFieldsBatchResult>("get_work_item_type_fields_batch", {
    workItemTypes,
  });
}

/** Refresh and persist field definitions for several work item types. */
export async function refreshWorkItemTypeFieldsBatch(
  workItemTypes: string[],
): Promise<Record<string, WorkItemFieldDefinition[]>> {
  return await invoke<Record<string, WorkItemFieldDefinition[]>>(
    "refresh_work_item_type_fields_batch",
    { workItemTypes },
  );
}

/** Fetch the first page of comments for a work item. */
export async function getWorkItemComments(workItemId: number): Promise<WorkItemComment[]> {
  return await invoke<WorkItemComment[]>("get_work_item_comments", { workItemId });
}

/** Add an HTML-formatted comment to a work item. */
export async function addWorkItemComment(workItemId: number, text: string): Promise<void> {
  await invoke("add_work_item_comment", { workItemId, text });
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

/** Fetch ADO metadata and Azure OpenAI configuration status for the AI planner. */
export async function getAiPlannerContext(): Promise<AiPlannerContext> {
  return await invoke<AiPlannerContext>("get_ai_planner_context");
}

/** Generate or regenerate a validated work-item plan through Azure OpenAI. */
export async function generateWorkItemPlan(
  request: GenerateWorkItemPlanRequest,
): Promise<GeneratedWorkItemPlan> {
  return await invoke<GeneratedWorkItemPlan>("generate_work_item_plan", { request });
}

/** Create an approved generated plan in ADO. */
export async function submitWorkItemPlan(
  request: SubmitWorkItemPlanRequest,
): Promise<SubmitWorkItemPlanResult> {
  return await invoke<SubmitWorkItemPlanResult>("submit_work_item_plan", { request });
}
