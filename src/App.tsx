import { useState, useEffect, useRef, useMemo } from "react";
import GraphView from "./components/GraphView";
import ActionableSidebar from "./components/ActionableSidebar";
import HamburgerMenu from "./components/HamburgerMenu";
import AiWorkItemModal from "./components/AiWorkItemModal";
import { MicrosoftLogin } from "./components/MicrosoftLogin";
import ProjectSelector from "./components/ProjectSelector";
import { useBoardData } from "./hooks/useAdoData";
import { setConfig, checkAuth, logout } from "./api/tauri";
import { getSavedConfig, clearConfig } from "./utils/storage";
import type { BoardData } from "./types";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { UndoRedoProvider } from "./contexts/UndoRedoContext";
import type { OperationContext } from "./utils/reversibleOperations";
import { findCurrentIterationPath } from "./utils/iterations";
import "./App.css";

type AppStep = "pat" | "project" | "board";
const CURRENT_USER_NAME = "Shoham Amar";

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

// TODO Visit this again down the line. It might be better to somehow pass an error code
function isAuthError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    message.includes("401") ||
    message.includes("unauthorized") ||
    message.includes("not authenticated") ||
    message.includes("sign in again")
  );
}

/** Hook that restores a previous session by validating backend auth and re-sending saved config. */
function useRestoreSession(setStep: (step: AppStep) => void, enabled: boolean) {
  const [restoring, setRestoring] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    async function restore() {
      const authenticated = await checkAuth().catch(() => false);
      if (!authenticated) {
        setRestoring(false);
        return;
      }

      const config = getSavedConfig();
      if (config) {
        try {
          await setConfig(config.organization, config.project, config.areaPath);
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
  }, [enabled, setStep]);

  return restoring;
}

function BoardView({
  boardData,
  sidebarOpen,
  onToggleSidebar,
  onChangeProject,
  onSignOut,
}: {
  boardData?: BoardData;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onChangeProject: () => void;
  onSignOut: () => void;
}) {
  const [isAiPlannerOpen, setIsAiPlannerOpen] = useState(false);
  const operationContextRef = useRef<OperationContext>(null);
  const { push: pushUndo, undo, redo } = useUndoRedo(operationContextRef);
  const contextValue = useMemo(
    () => ({ push: pushUndo, operationContextRef }),
    [pushUndo, operationContextRef],
  );
  const currentIterationPath = useMemo(
    () => findCurrentIterationPath(boardData?.iterations ?? []),
    [boardData?.iterations],
  );

  return (
    <UndoRedoProvider value={contextValue}>
      <div className="flex h-screen w-screen overflow-hidden bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <div className="flex-1 relative">
          <GraphView
            boardData={boardData}
            operationContextRef={operationContextRef}
            pushUndo={pushUndo}
            undo={undo}
            redo={redo}
          />
          <HamburgerMenu onChangeProject={onChangeProject} onSignOut={onSignOut} />
          <button
            type="button"
            onClick={() => setIsAiPlannerOpen(true)}
            className="absolute bottom-4 right-4 z-20 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            aria-label="Open AI Planner"
          >
            <span
              aria-hidden="true"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-xs"
            >
              {"AI"}
            </span>
            {"AI Planner"}
          </button>
          <AiWorkItemModal
            isOpen={isAiPlannerOpen}
            onClose={() => setIsAiPlannerOpen(false)}
            defaultAssignedTo={CURRENT_USER_NAME}
            defaultIterationPath={currentIterationPath}
          />
        </div>
        <ActionableSidebar isOpen={sidebarOpen} onToggle={onToggleSidebar} boardData={boardData} />
      </div>
    </UndoRedoProvider>
  );
}

function App() {
  const [step, setStep] = useState<AppStep>("pat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const restoring = useRestoreSession(setStep, true);

  const {
    data: fetchedBoardData,
    isLoading: isBoardDataLoading,
    error: boardDataError,
  } = useBoardData(step === "board");
  const boardData = fetchedBoardData;
  const isLoading = isBoardDataLoading;
  const error = boardDataError;

  useEffect(() => {
    if (step !== "board" || !error || !isAuthError(error)) {
      return;
    }

    void logout().finally(() => {
      setStep("pat");
      setLoginError("Your session expired. Please sign in again.");
    });
  }, [error, step]);

  if (restoring) {
    return (
      <FullScreenMessage>
        <p className="text-gray-500 dark:text-gray-400">{"Restoring session..."}</p>
      </FullScreenMessage>
    );
  }

  if (step === "pat") {
    return (
      <MicrosoftLogin
        initialError={loginError}
        onSuccess={() => {
          setStep("project");
        }}
      />
    );
  }

  if (step === "project") {
    return (
      <ProjectSelector
        onConfigured={() => setStep("board")}
        onBack={() => {
          void logout().finally(() => {
            setStep("pat");
          });
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
      onSignOut={() => {
        void logout().finally(() => {
          clearConfig();
          setStep("pat");
        });
      }}
    />
  );
}

export default App;
