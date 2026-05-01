import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { BoardData, PatGenerationResult, AccountInfo, ProjectInfo, TeamInfo } from "../types";

export async function setPatTauri(pat: string): Promise<void> {
  await invoke("set_pat", { pat });
}

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

export async function generatePatTauri(organization?: string): Promise<PatGenerationResult> {
  return await invoke<PatGenerationResult>("generate_pat", {
    organization: organization || null,
  });
}

export async function listOrganizationsTauri(): Promise<AccountInfo[]> {
  return await invoke<AccountInfo[]>("list_organizations");
}

export async function listProjectsTauri(organization: string): Promise<ProjectInfo[]> {
  return await invoke<ProjectInfo[]>("list_projects", { organization });
}

export async function listTeamsTauri(organization: string, project: string): Promise<TeamInfo[]> {
  return await invoke<TeamInfo[]>("list_teams", { organization, project });
}

export async function listAreaPathsTauri(organization: string, project: string): Promise<string[]> {
  return await invoke<string[]>("list_area_paths", { organization, project });
}

async function fetchBoardData(): Promise<BoardData> {
  return await invoke<BoardData>("get_board_data");
}

export function useBoardData(enabled: boolean) {
  return useQuery({
    queryKey: ["boardData"],
    queryFn: fetchBoardData,
    enabled,
  });
}
