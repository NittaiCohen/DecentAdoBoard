import { useState, useEffect } from "react";
import GraphView from "./components/GraphView";
import ActionableSidebar from "./components/ActionableSidebar";
import PatLogin from "./components/Settings";
import ProjectSelector from "./components/ProjectSelector";
import { useBoardData, setPatTauri, setConfigTauri } from "./hooks/useAdoData";
import "./App.css";

type AppStep = "pat" | "project" | "board";

const PAT_STORAGE_KEY = "ado_pat";
const PAT_EXPIRY_KEY = "ado_pat_expiry";
const CONFIG_STORAGE_KEY = "ado-config";

function getSavedPat(): string | null {
  const pat = localStorage.getItem(PAT_STORAGE_KEY);
  const expiry = localStorage.getItem(PAT_EXPIRY_KEY);
  if (!pat) return null;
  if (expiry) {
    const expiryDate = new Date(expiry);
    if (expiryDate <= new Date()) {
      localStorage.removeItem(PAT_STORAGE_KEY);
      localStorage.removeItem(PAT_EXPIRY_KEY);
      return null;
    }
  }
  return pat;
}

function getSavedConfig(): { organization: string; project: string; areaPath: string } | null {
  try {
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!saved) return null;
    const config = JSON.parse(saved);
    if (config.organization && config.project && config.areaPath) return config;
  } catch {}
  return null;
}

export function savePat(pat: string, validTo?: string) {
  localStorage.setItem(PAT_STORAGE_KEY, pat);
  if (validTo) {
    localStorage.setItem(PAT_EXPIRY_KEY, validTo);
  } else {
    localStorage.removeItem(PAT_EXPIRY_KEY);
  }
}

export function clearPat() {
  localStorage.removeItem(PAT_STORAGE_KEY);
  localStorage.removeItem(PAT_EXPIRY_KEY);
}

function App() {
  const [step, setStep] = useState<AppStep>("pat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [restoring, setRestoring] = useState(true);

  // On mount, restore PAT and config if available
  useEffect(() => {
    async function restore() {
      const pat = getSavedPat();
      if (!pat) {
        setRestoring(false);
        return;
      }

      try {
        await setPatTauri(pat);
      } catch {
        clearPat();
        setRestoring(false);
        return;
      }

      const config = getSavedConfig();
      if (config) {
        try {
          await setConfigTauri(config.organization, config.project, config.areaPath);
          setStep("board");
        } catch {
          setStep("project");
        }
      } else {
        setStep("project");
      }
      setRestoring(false);
    }
    restore();
  }, []);

  const { data: boardData, isLoading, error } = useBoardData(step === "board");

  if (restoring) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-gray-900 text-gray-100">
        <p className="text-gray-400">Restoring session...</p>
      </div>
    );
  }

  if (step === "pat") {
    return <PatLogin onAuthenticated={() => setStep("project")} />;
  }

  if (step === "project") {
    return (
      <ProjectSelector
        onConfigured={() => setStep("board")}
        onBack={() => {
          clearPat();
          setStep("pat");
        }}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-gray-900 text-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
          <p className="text-gray-400">Loading board data from ADO...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-gray-900 text-gray-100">
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-6 max-w-md">
          <h2 className="text-lg font-bold text-red-400 mb-2">Error</h2>
          <p className="text-sm text-red-300">{String(error)}</p>
          <button
            onClick={() => setStep("project")}
            className="mt-4 bg-gray-700 hover:bg-gray-600 text-gray-200 px-4 py-2 rounded"
          >
            Back to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-900 text-gray-100">
      <div className="flex-1 relative">
        <GraphView boardData={boardData} />
        <button
          onClick={() => setStep("project")}
          className="absolute top-3 left-3 z-10 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-medium px-3 py-1.5 rounded shadow transition-colors"
          title="Change project"
        >
          ⚙ Change Project
        </button>
      </div>
      <ActionableSidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        boardData={boardData}
      />
    </div>
  );
}

export default App;
