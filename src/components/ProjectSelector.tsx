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

function useOrgOptions() {
  const [orgOptions, setOrgOptions] = useState<string[]>([]);
  const [orgLoading, setOrgLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setOrgLoading(true);
    listOrganizationsTauri()
      .then((accts) => setOrgOptions(accts.map((a) => a.accountName).filter(Boolean)))
      .catch((err: unknown) => setError(`Org loading: ${String(err)}`))
      .finally(() => setOrgLoading(false));
  }, []);

  return { orgOptions, orgLoading, error };
}

function useProjectOptions(organization: string) {
  const [projectOptions, setProjectOptions] = useState<string[]>([]);
  const [projectLoading, setProjectLoading] = useState(false);

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
      .catch(() => setProjectOptions([]))
      .finally(() => setProjectLoading(false));
  }, [organization]);

  return { projectOptions, projectLoading };
}

function useAreaOptions(organization: string, project: string) {
  const [areaOptions, setAreaOptions] = useState<string[]>([]);
  const [areaLoading, setAreaLoading] = useState(false);

  useEffect(() => {
    if (!organization || !project) {
      setAreaOptions([]);
      return;
    }
    setAreaLoading(true);
    listAreaPathsTauri(organization, project)
      .then((paths) => setAreaOptions(paths.sort((a, b) => a.localeCompare(b))))
      .catch(() => setAreaOptions([]))
      .finally(() => setAreaLoading(false));
  }, [organization, project]);

  return { areaOptions, areaLoading };
}

function ProjectFormFields({
  organization,
  project,
  areaPath,
  setOrganization,
  setProject,
  setAreaPath,
  orgOptions,
  orgLoading,
  projectOptions,
  projectLoading,
  areaOptions,
  areaLoading,
}: {
  organization: string;
  project: string;
  areaPath: string;
  setOrganization: (v: string) => void;
  setProject: (v: string) => void;
  setAreaPath: (v: string) => void;
  orgOptions: string[];
  orgLoading: boolean;
  projectOptions: string[];
  projectLoading: boolean;
  areaOptions: string[];
  areaLoading: boolean;
}) {
  return (
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
  );
}

function useProjectForm(onConfigured: () => void) {
  const [saved] = useState(loadSavedConfig);
  const [organization, setOrganization] = useState(
    () => saved.organization || localStorage.getItem("ado_organization") || "",
  );
  const [project, setProject] = useState(saved.project);
  const [areaPath, setAreaPath] = useState(saved.areaPath);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { orgOptions, orgLoading, error: orgError } = useOrgOptions();
  const { projectOptions, projectLoading } = useProjectOptions(organization);
  const { areaOptions, areaLoading } = useAreaOptions(organization, project);

  const displayError = error || orgError;

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

  return {
    organization,
    setOrganization,
    project,
    setProject,
    areaPath,
    setAreaPath,
    loading,
    displayError,
    handleSubmit,
    orgOptions,
    orgLoading,
    projectOptions,
    projectLoading,
    areaOptions,
    areaLoading,
  };
}

export default function ProjectSelector({ onConfigured, onBack }: ProjectSelectorProps) {
  const form = useProjectForm(onConfigured);
  const canSubmit = !form.loading && !!form.organization && !!form.project && !!form.areaPath;

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-gray-50 dark:bg-gray-900">
      <form
        onSubmit={(e) => void form.handleSubmit(e)}
        className="bg-white dark:bg-gray-800 rounded-lg p-8 w-full max-w-md shadow-xl"
      >
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {"Select Project"}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {"Choose the organization, project, and area path to visualize."}
        </p>

        <ProjectFormFields
          organization={form.organization}
          project={form.project}
          areaPath={form.areaPath}
          setOrganization={form.setOrganization}
          setProject={form.setProject}
          setAreaPath={form.setAreaPath}
          orgOptions={form.orgOptions}
          orgLoading={form.orgLoading}
          projectOptions={form.projectOptions}
          projectLoading={form.projectLoading}
          areaOptions={form.areaOptions}
          areaLoading={form.areaLoading}
        />

        {form.displayError && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400 bg-red-100/30 dark:bg-red-900/30 rounded p-2">
            {form.displayError}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex-shrink-0 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-medium py-2 px-4 rounded transition-colors"
          >
            {"Back"}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded transition-colors"
          >
            {form.loading ? "Loading..." : "Load Board"}
          </button>
        </div>
      </form>
    </div>
  );
}
