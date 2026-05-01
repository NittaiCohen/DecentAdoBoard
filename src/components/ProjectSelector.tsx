import { useState, useEffect } from "react";
import { isObject, isString } from "lodash-es";
import {
  setConfigTauri,
  listOrganizationsTauri,
  listProjectsTauri,
  listAreaPathsTauri,
} from "../hooks/useAdoData";
import ComboBox from "./ComboBox";

interface ProjectSelectorProps {
  onConfigured: () => void;
  onBack: () => void;
}

const STORAGE_KEY = "ado-config";

interface SavedConfig {
  organization: string;
  project: string;
  areaPath: string;
}

function isSavedConfig(value: unknown): value is SavedConfig {
  return (
    isObject(value) &&
    "organization" in value &&
    "project" in value &&
    "areaPath" in value &&
    isString(value.organization) &&
    isString(value.project) &&
    isString(value.areaPath)
  );
}

function loadSavedConfig(): SavedConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const config: unknown = JSON.parse(saved);
      if (isSavedConfig(config)) {
        return config;
      }
    }
  } catch {
    /* ignore invalid JSON */
  }
  return { organization: "", project: "", areaPath: "" };
}

function saveConfig(config: SavedConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export default function ProjectSelector({ onConfigured, onBack }: ProjectSelectorProps) {
  const [saved] = useState(loadSavedConfig);
  const [organization, setOrganization] = useState(
    () => saved.organization || localStorage.getItem("ado_organization") || "",
  );
  const [project, setProject] = useState(saved.project);
  const [areaPath, setAreaPath] = useState(saved.areaPath);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [orgOptions, setOrgOptions] = useState<string[]>([]);
  const [projectOptions, setProjectOptions] = useState<string[]>([]);
  const [areaOptions, setAreaOptions] = useState<string[]>([]);

  const [orgLoading, setOrgLoading] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const [areaLoading, setAreaLoading] = useState(false);

  // Load orgs on mount
  useEffect(() => {
    setOrgLoading(true);
    listOrganizationsTauri()
      .then((accts) => setOrgOptions(accts.map((a) => a.accountName).filter(Boolean)))
      .catch((err: unknown) => {
        setError(`Org loading: ${String(err)}`);
      })
      .finally(() => setOrgLoading(false));
  }, []);

  // Load projects when org changes
  useEffect(() => {
    if (!organization) {
      setProjectOptions([]);
      return;
    }
    setProjectLoading(true);
    listProjectsTauri(organization)
      .then((projs) => {
        const sorted = projs.map((p) => p.name).sort((a, b) => a.localeCompare(b));
        setProjectOptions(sorted);
      })
      .catch((err) => setError(`Failed to load projects: ${err}`))
      .finally(() => setProjectLoading(false));
  }, [organization]);

  // Load area paths when project changes
  useEffect(() => {
    if (!organization || !project) {
      setAreaOptions([]);
      return;
    }
    setAreaLoading(true);
    listAreaPathsTauri(organization, project)
      .then((paths) => setAreaOptions(paths.sort((a, b) => a.localeCompare(b))))
      .catch((err) => setError(`Failed to load area paths: ${err}`))
      .finally(() => setAreaLoading(false));
  }, [organization, project]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await setConfigTauri(organization, project, areaPath);
      saveConfig({ organization, project, areaPath });
      localStorage.setItem("ado_organization", organization);
      onConfigured();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-gray-900">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="bg-gray-800 rounded-lg p-8 w-full max-w-md shadow-xl"
      >
        <h1 className="text-xl font-bold text-gray-100 mb-2">{"Select Project"}</h1>
        <p className="text-sm text-gray-400 mb-6">
          {"Choose the organization, project, and area path to visualize."}
        </p>

        <div className="space-y-4">
          <ComboBox
            label="Organization"
            value={organization}
            onChange={(v) => {
              setOrganization(v);
              setProject("");
              setAreaPath("");
            }}
            options={orgOptions}
            loading={orgLoading}
            placeholder="Select or type organization"
          />
          <ComboBox
            label="Project"
            value={project}
            onChange={(v) => {
              setProject(v);
              setAreaPath("");
            }}
            options={projectOptions}
            loading={projectLoading}
            placeholder="Select or type project"
            disabled={!organization}
          />
          <ComboBox
            label="Area Path"
            value={areaPath}
            onChange={setAreaPath}
            options={areaOptions}
            loading={areaLoading}
            placeholder="Select or type area path"
            disabled={!project}
          />
        </div>

        {error && <p className="mt-4 text-sm text-red-400 bg-red-900/30 rounded p-2">{error}</p>}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex-shrink-0 bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium py-2 px-4 rounded transition-colors"
          >
            {"Back"}
          </button>
          <button
            type="submit"
            disabled={loading || !organization || !project || !areaPath}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded transition-colors"
          >
            {loading ? "Loading..." : "Load Board"}
          </button>
        </div>
      </form>
    </div>
  );
}
