import { useState } from "react";
import { setPatTauri, generatePatTauri } from "../hooks/useAdoData";
import { savePat } from "../App";
import ComboBox from "./ComboBox";

interface PatLoginProps {
  onAuthenticated: () => void;
}

export default function PatLogin({ onAuthenticated }: PatLoginProps) {
  const [pat, setPat] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState("");
  // When multiple orgs are found, let the user pick
  const [orgChoices, setOrgChoices] = useState<string[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");

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
      setGenResult(
        `PAT created for "${result.organization}", valid until ${result.valid_to}`
      );
    } catch (err) {
      const msg = String(err);
      // Backend returns "MULTIPLE_ORGS:org1,org2,..." when multiple orgs found
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

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-gray-900">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-800 rounded-lg p-8 w-full max-w-md shadow-xl"
      >
        <h1 className="text-xl font-bold text-gray-100 mb-2">
          DecentAdoBoard
        </h1>
        <p className="text-sm text-gray-400 mb-6">
          Enter a PAT manually, or generate one automatically using Azure CLI.
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Personal Access Token
          </label>
          <input
            type="password"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            placeholder="Enter your PAT"
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-gray-100 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
        </div>

        <div className="mt-4 border-t border-gray-700 pt-4">
          <p className="text-xs text-gray-500 mb-2">
            Or generate via Azure CLI (requires{" "}
            <code className="text-gray-400">az login</code>)
          </p>

          {orgChoices.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-300">
                Multiple organizations found. Select one:
              </p>
              <ComboBox
                value={selectedOrg}
                onChange={setSelectedOrg}
                options={orgChoices}
                placeholder="Search organizations..."
              />
              <button
                type="button"
                onClick={() => handleGenerate(selectedOrg)}
                disabled={generating || !selectedOrg}
                className="w-full bg-green-700 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-3 rounded transition-colors"
              >
                {generating ? "Generating..." : "Generate PAT"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleGenerate()}
              disabled={generating}
              className="w-full bg-green-700 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-3 rounded transition-colors"
            >
              {generating ? "Generating..." : "Generate PAT automatically"}
            </button>
          )}
        </div>

        {genResult && (
          <p className="mt-3 text-sm text-green-400 bg-green-900/30 rounded p-2">
            {genResult}
          </p>
        )}

        {error && (
          <p className="mt-3 text-sm text-red-400 bg-red-900/30 rounded p-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !pat}
          className="mt-6 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded transition-colors"
        >
          {loading ? "Authenticating..." : "Continue"}
        </button>
      </form>
    </div>
  );
}
