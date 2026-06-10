import { useState } from "react";
import { loginAzCli, loginMicrosoft, setPat as setPatApi } from "../api/tauri";

const AUTH_METHODS = {
  microsoft: { enabled: false },
  azureCli: { enabled: true },
  pat: { enabled: false },
} as const;

interface MicrosoftLoginProps {
  initialError?: string | null;
  onSuccess: () => void;
}

export function MicrosoftLogin({ initialError, onSuccess }: MicrosoftLoginProps) {
  const [loading, setLoading] = useState(false);
  const [showPatSection, setShowPatSection] = useState(false);
  const [showPatInput, setShowPatInput] = useState(false);
  const [pat, setPat] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function withLoading(fn: () => Promise<void>) {
    setLoading(true);
    setError(null);
    try {
      await fn();
      onSuccess();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handlePatLogin() {
    if (!pat.trim()) {
      return;
    }
    await withLoading(async () => {
      await setPatApi(pat.trim());
    });
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen w-screen gap-6 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-semibold">{"Decent ADO Board"}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {"Sign in to access Azure DevOps."}
        </p>
      </div>

      {AUTH_METHODS.microsoft.enabled && (
        <button
          type="button"
          onClick={() => void withLoading(loginMicrosoft)}
          disabled={loading}
          className="flex items-center gap-3 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-base font-medium transition-colors"
        >
          {loading ? "Signing in..." : "Sign in with Microsoft"}
        </button>
      )}

      {AUTH_METHODS.azureCli.enabled && (
        <button
          type="button"
          onClick={() => void withLoading(loginAzCli)}
          disabled={loading}
          className="w-72 px-6 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-base font-medium transition-colors"
        >
          {"Sign in with Azure CLI"}
        </button>
      )}

      {AUTH_METHODS.pat.enabled && (
        <div className="flex flex-col items-center gap-3 w-72">
          <button
            type="button"
            onClick={() => {
              setShowPatSection(!showPatSection);
              setShowPatInput(false);
              setPat("");
            }}
            className="text-sm text-gray-500 dark:text-gray-400 hover:underline"
          >
            {"Sign in with Personal Access Token"}
          </button>

          {showPatSection && (
            <div className="flex flex-col items-center gap-3 w-full border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <button
                type="button"
                onClick={() => void withLoading(loginAzCli)}
                disabled={loading}
                className="w-full px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
              >
                {"Generate PAT automatically"}
              </button>

              {showPatInput ? (
                <div className="flex flex-col gap-2 w-full">
                  <input
                    id="pat-input"
                    type="password"
                    value={pat}
                    onChange={(e) => {
                      setPat(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void handlePatLogin();
                      }
                    }}
                    placeholder="Paste your PAT here"
                    disabled={loading}
                    autoFocus
                    className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => void handlePatLogin()}
                    disabled={loading || !pat.trim()}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
                  >
                    {"Sign in with PAT"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowPatInput(true);
                  }}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:underline"
                >
                  {"Paste a PAT manually"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="max-w-md text-center text-sm text-red-600 dark:text-red-400 bg-red-100/30 dark:bg-red-900/30 rounded p-3">
          {error}
        </p>
      )}
    </div>
  );
}
