import { useState, useEffect } from "react";
import GraphView from "./components/GraphView";
import ActionableSidebar from "./components/ActionableSidebar";
import ThemeToggle from "./components/ThemeToggle";
import PatLogin from "./components/Settings";
import ProjectSelector from "./components/ProjectSelector";
import { useBoardData, setPatTauri, setConfigTauri } from "./hooks/useAdoData";
import { getSavedPat, getSavedConfig, clearPat } from "./utils/storage";
import type { BoardData } from "./types";
import "./App.css";

type AppStep = "pat" | "project" | "board";

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-screen w-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {children}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <FullScreenMessage>
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
        <p className="text-gray-500 dark:text-gray-400">{"Loading board data from ADO..."}</p>
      </div>
    </FullScreenMessage>
  );
}

function ErrorScreen({ error, onBack }: { error: unknown; onBack: () => void }) {
  return (
    <FullScreenMessage>
      <div className="bg-red-100/30 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-6 max-w-md">
        <h2 className="text-lg font-bold text-red-600 dark:text-red-400 mb-2">{"Error"}</h2>
        <p className="text-sm text-red-700 dark:text-red-300">{String(error)}</p>
        <button
          onClick={onBack}
          className="mt-4 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 px-4 py-2 rounded"
        >
          {"Back to Settings"}
        </button>
      </div>
    </FullScreenMessage>
  );
}

/** Hook that restores a previous session by re-sending saved PAT and config to the backend. */
function useRestoreSession(setStep: (step: AppStep) => void) {
  const [restoring, setRestoring] = useState(true);

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
    void restore();
  }, [setStep]);

  return restoring;
}

function BoardView({
  boardData,
  sidebarOpen,
  onToggleSidebar,
  onChangeProject,
}: {
  boardData?: BoardData;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onChangeProject: () => void;
}) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <div className="flex-1 relative">
        <GraphView boardData={boardData} />
        <button
          onClick={onChangeProject}
          className="absolute top-3 left-3 z-10 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium px-3 py-1.5 rounded shadow transition-colors"
          title="Change project"
        >
          {"⚙ Change Project"}
        </button>
        <div className="absolute top-3 right-3 z-10">
          <ThemeToggle />
        </div>
      </div>
      <ActionableSidebar isOpen={sidebarOpen} onToggle={onToggleSidebar} boardData={boardData} />
    </div>
  );
}

function App() {
  const [step, setStep] = useState<AppStep>("pat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const restoring = useRestoreSession(setStep);

  const { data: boardData, isLoading, error } = useBoardData(step === "board");

  if (restoring) {
    return (
      <FullScreenMessage>
        <p className="text-gray-500 dark:text-gray-400">{"Restoring session..."}</p>
      </FullScreenMessage>
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
    return <LoadingSpinner />;
  }

  if (error) {
    return <ErrorScreen error={error} onBack={() => setStep("project")} />;
  }

  return (
    <BoardView
      boardData={boardData}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      onChangeProject={() => setStep("project")}
    />
  );
}

export default App;
