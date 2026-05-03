import { useState } from "react";
import { setPatTauri, generatePatTauri } from "../hooks/useAdoData";
import { savePat } from "../utils/storage";
import ComboBox from "./ComboBox";

interface PatLoginProps {
  onAuthenticated: () => void;
}

function OrgSelector({
  orgChoices,
  selectedOrg,
  setSelectedOrg,
  generating,
  onGenerate,
}: {
  orgChoices: string[];
  selectedOrg: string;
  setSelectedOrg: (org: string) => void;
  generating: boolean;
  onGenerate: (org: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {"Multiple organizations found. Select one:"}
      </p>
      <ComboBox
        value={selectedOrg}
        onChange={setSelectedOrg}
        options={orgChoices}
        placeholder="Search organizations..."
      />
      <button
        type="button"
        onClick={() => onGenerate(selectedOrg)}
        disabled={generating || !selectedOrg}
        className="w-full bg-green-700 hover:bg-green-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-3 rounded transition-colors"
      >
        {generating ? "Generating..." : "Generate PAT"}
      </button>
    </div>
  );
}

function usePatGeneration(setPat: (pat: string) => void) {
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState("");
  const [error, setError] = useState("");
  const [orgChoices, setOrgChoices] = useState<string[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");

  async function handleGenerate(org?: string) {
    setError("");
    setGenerating(true);
    setGenResult("");
    setOrgChoices([]);

    try {
      const result = await generatePatTauri(org);
      setPat(result.pat);
      savePat(result.pat, result.valid_to);
      localStorage.setItem("ado_organization", result.organization);
      setGenResult(`PAT created for "${result.organization}", valid until ${result.valid_to}`);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("MULTIPLE_ORGS:")) {
        const orgs = msg.split("MULTIPLE_ORGS:")[1].split(",").sort();
        setOrgChoices(orgs);
        setSelectedOrg(orgs[0]);
      } else {
        setError(msg);
      }
    } finally {
      setGenerating(false);
    }
  }

  return {
    generating,
    genResult,
    genError: error,
    orgChoices,
    selectedOrg,
    setSelectedOrg,
    handleGenerate,
  };
}

function GenerateSection({
  generating,
  genResult,
  orgChoices,
  selectedOrg,
  setSelectedOrg,
  onGenerate,
}: {
  generating: boolean;
  genResult: string;
  orgChoices: string[];
  selectedOrg: string;
  setSelectedOrg: (org: string) => void;
  onGenerate: (org?: string) => void;
}) {
  return (
    <>
      <div className="mt-4 border-t border-gray-300 dark:border-gray-700 pt-4">
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
          {`Or generate via Azure CLI (requires `}
          <code className="text-gray-500 dark:text-gray-400">{"az login"}</code>
          {`)`}
        </p>

        {orgChoices.length > 0 ? (
          <OrgSelector
            orgChoices={orgChoices}
            selectedOrg={selectedOrg}
            setSelectedOrg={setSelectedOrg}
            generating={generating}
            onGenerate={onGenerate}
          />
        ) : (
          <button
            type="button"
            onClick={() => onGenerate()}
            disabled={generating}
            className="w-full bg-green-700 hover:bg-green-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-3 rounded transition-colors"
          >
            {generating ? "Generating..." : "Generate PAT automatically"}
          </button>
        )}
      </div>

      {genResult && (
        <p className="mt-3 text-sm text-green-600 dark:text-green-400 bg-green-100/30 dark:bg-green-900/30 rounded p-2">
          {genResult}
        </p>
      )}
    </>
  );
}

export default function PatLogin({ onAuthenticated }: PatLoginProps) {
  const [pat, setPat] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const gen = usePatGeneration(setPat);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await setPatTauri(pat);
      savePat(pat);
      onAuthenticated();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const displayError = error || gen.genError;

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-gray-50 dark:bg-gray-900">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="bg-white dark:bg-gray-800 rounded-lg p-8 w-full max-w-md shadow-xl"
      >
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {"Decent ADO Board"}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {"Enter a PAT manually, or generate one automatically using Azure CLI."}
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {"Personal Access Token"}
          </label>
          <input
            type="password"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            placeholder="Enter your PAT"
            className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
        </div>

        <GenerateSection
          generating={gen.generating}
          genResult={gen.genResult}
          orgChoices={gen.orgChoices}
          selectedOrg={gen.selectedOrg}
          setSelectedOrg={gen.setSelectedOrg}
          onGenerate={(org) => void gen.handleGenerate(org)}
        />

        {displayError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400 bg-red-100/30 dark:bg-red-900/30 rounded p-2">
            {displayError}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !pat}
          className="mt-6 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded transition-colors"
        >
          {loading ? "Authenticating..." : "Continue"}
        </button>
      </form>
    </div>
  );
}
