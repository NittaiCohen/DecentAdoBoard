import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { BoardData, PatGenerationResult, AccountInfo, ProjectInfo, TeamInfo } from "../types";

/** Send a PAT to the Rust backend for authentication. */
export async function setPatTauri(pat: string): Promise<void> {
  await invoke("set_pat", { pat });
}

/** Send the selected organization, project, and area path to the Rust backend. */
export async function setConfigTauri(
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

/** Generate a PAT via Azure CLI through the Rust backend. */
export async function generatePatTauri(organization?: string): Promise<PatGenerationResult> {
  return await invoke<PatGenerationResult>("generate_pat", {
    organization: organization || null,
  });
}

/** Fetch the list of accessible Azure DevOps organizations from the Rust backend. */
export async function listOrganizationsTauri(): Promise<AccountInfo[]> {
  return await invoke<AccountInfo[]>("list_organizations");
}

/** Fetch the list of projects in an organization from the Rust backend. */
export async function listProjectsTauri(organization: string): Promise<ProjectInfo[]> {
  return await invoke<ProjectInfo[]>("list_projects", { organization });
}

/** Fetch the list of teams in a project from the Rust backend. */
export async function listTeamsTauri(organization: string, project: string): Promise<TeamInfo[]> {
  return await invoke<TeamInfo[]>("list_teams", { organization, project });
}

/** Fetch the list of area paths in a project from the Rust backend. */
export async function listAreaPathsTauri(organization: string, project: string): Promise<string[]> {
  return await invoke<string[]>("list_area_paths", { organization, project });
}

/** Invoke the Rust backend to fetch the full board data (work items + iterations). */
async function fetchBoardData(): Promise<BoardData> {
  return await invoke<BoardData>("get_board_data");
}

/** React Query hook that fetches board data when enabled. */
export function useBoardData(enabled: boolean) {
  return useQuery({
    queryKey: ["boardData"],
    queryFn: fetchBoardData,
    enabled,
  });
}
