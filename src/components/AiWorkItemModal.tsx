import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { GeneratedWorkItemPlan } from "../types";
import { createGeneratedPlanPreview } from "../utils/generatedPlanPreview";
import { createMockAiPlan } from "../utils/mockAiPlan";
import GraphView, { type GraphPreviewActions } from "./GraphView";

type ModalStep = "describe" | "generating" | "preview" | "submitting" | "success";

interface AiWorkItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  mockDelayMs?: number;
  defaultAssignedTo?: string;
  defaultIterationPath?: string;
}

const DEFAULT_MOCK_DELAY_MS = 700;
const DEFAULT_ITERATION_PATH = "Current sprint";

function LoadingIndicator({ message }: { message: string }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center text-center">
      <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600 dark:border-blue-900 dark:border-t-blue-400" />
      <p className="font-medium text-gray-800 dark:text-gray-100">{message}</p>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {"This is simulated in the first UI milestone."}
      </p>
    </div>
  );
}

function usePreviewActions(
  plan: GeneratedWorkItemPlan | null,
  setPlan: Dispatch<SetStateAction<GeneratedWorkItemPlan | null>>,
): {
  preview: ReturnType<typeof createGeneratedPlanPreview> | null;
  previewActions: GraphPreviewActions | undefined;
} {
  const preview = useMemo(() => (plan ? createGeneratedPlanPreview(plan) : null), [plan]);

  const previewActions = useMemo<GraphPreviewActions | undefined>(() => {
    if (!preview) {
      return undefined;
    }

    const getTemporaryId = (previewId: number) => preview.temporaryIdByPreviewId.get(previewId);

    return {
      onStateChange: (workItemId, newState) => {
        const temporaryId = getTemporaryId(workItemId);
        if (!temporaryId) {
          return;
        }
        setPlan((currentPlan) =>
          currentPlan
            ? {
                ...currentPlan,
                items: currentPlan.items.map((item) =>
                  item.temporaryId === temporaryId ? { ...item, state: newState } : item,
                ),
              }
            : currentPlan,
        );
      },
      onIterationChange: (iterationChanges) => {
        const iterationByTemporaryId = new Map<string, string>();
        for (const iterationChange of iterationChanges) {
          const temporaryId = getTemporaryId(iterationChange.workItemId);
          if (temporaryId) {
            iterationByTemporaryId.set(temporaryId, iterationChange.toIterationPath);
          }
        }
        setPlan((currentPlan) =>
          currentPlan
            ? {
                ...currentPlan,
                items: currentPlan.items.map((item) => ({
                  ...item,
                  iterationPath: iterationByTemporaryId.get(item.temporaryId) ?? item.iterationPath,
                })),
              }
            : currentPlan,
        );
      },
      onAddDependency: (sourceId, targetId) => {
        const sourceTemporaryId = getTemporaryId(sourceId);
        const targetTemporaryId = getTemporaryId(targetId);
        if (!sourceTemporaryId || !targetTemporaryId) {
          return;
        }
        setPlan((currentPlan) =>
          currentPlan
            ? {
                ...currentPlan,
                items: currentPlan.items.map((item) =>
                  item.temporaryId === targetTemporaryId &&
                  !item.dependencyTemporaryIds.includes(sourceTemporaryId)
                    ? {
                        ...item,
                        dependencyTemporaryIds: [...item.dependencyTemporaryIds, sourceTemporaryId],
                      }
                    : item,
                ),
              }
            : currentPlan,
        );
      },
      onRemoveDependency: (sourceId, targetId) => {
        const sourceTemporaryId = getTemporaryId(sourceId);
        const targetTemporaryId = getTemporaryId(targetId);
        if (!sourceTemporaryId || !targetTemporaryId) {
          return;
        }
        setPlan((currentPlan) =>
          currentPlan
            ? {
                ...currentPlan,
                items: currentPlan.items.map((item) =>
                  item.temporaryId === targetTemporaryId
                    ? {
                        ...item,
                        dependencyTemporaryIds: item.dependencyTemporaryIds.filter(
                          (dependencyTemporaryId) => dependencyTemporaryId !== sourceTemporaryId,
                        ),
                      }
                    : item,
                ),
              }
            : currentPlan,
        );
      },
    };
  }, [preview, setPlan]);

  return { preview, previewActions };
}

export default function AiWorkItemModal({
  isOpen,
  onClose,
  mockDelayMs = DEFAULT_MOCK_DELAY_MS,
  defaultAssignedTo = "",
  defaultIterationPath = DEFAULT_ITERATION_PATH,
}: AiWorkItemModalProps) {
  const [step, setStep] = useState<ModalStep>("describe");
  const [mission, setMission] = useState("");
  const [refinementRequest, setRefinementRequest] = useState("");
  const [plan, setPlan] = useState<GeneratedWorkItemPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const missionInputRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { preview, previewActions } = usePreviewActions(plan, setPlan);

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const closeModal = useCallback(() => {
    clearPendingTimeout();
    onClose();
  }, [clearPendingTimeout, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStep("describe");
    setMission("");
    setRefinementRequest("");
    setPlan(null);
    setError(null);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => missionInputRef.current?.focus());

    return () => {
      clearPendingTimeout();
      document.body.style.overflow = "";
      previousActiveElementRef.current?.focus();
    };
  }, [isOpen, clearPendingTimeout]);

  if (!isOpen) {
    return null;
  }

  function scheduleMockAction(action: () => void) {
    clearPendingTimeout();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      action();
    }, mockDelayMs);
  }

  function createPlan(refinement?: string) {
    return createMockAiPlan(mission, refinement, {
      assignedTo: defaultAssignedTo,
      iterationPath: defaultIterationPath,
    });
  }

  function handleGenerate() {
    if (!mission.trim()) {
      setError("Describe the mission before generating work items.");
      missionInputRef.current?.focus();
      return;
    }
    setError(null);
    setStep("generating");
    scheduleMockAction(() => {
      setPlan(createPlan());
      setStep("preview");
    });
  }

  function handleRegenerate() {
    if (!refinementRequest.trim()) {
      setError("Describe the changes you want the AI to make.");
      return;
    }
    setError(null);
    setStep("generating");
    scheduleMockAction(() => {
      setPlan(createPlan(refinementRequest));
      setRefinementRequest("");
      setStep("preview");
    });
  }

  function handleFinalSubmit() {
    setError(null);
    setStep("submitting");
    scheduleMockAction(() => setStep("success"));
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) {
      return;
    }

    const focusableElements = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusableElements.length === 0) {
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  const isBusy = step === "generating" || step === "submitting";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) {
          closeModal();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-planner-title"
        onKeyDown={handleDialogKeyDown}
        className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-gray-50 shadow-2xl dark:bg-gray-900"
      >
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
          <div>
            <h2
              id="ai-planner-title"
              className="text-xl font-bold text-gray-900 dark:text-gray-100"
            >
              {"AI Work Item Planner"}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {"Turn a mission into a reviewable Azure DevOps work-item plan."}
            </p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            disabled={isBusy}
            aria-label="Close AI planner"
            className="rounded p-2 text-xl text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
          >
            {"x"}
          </button>
        </header>

        <div className="overflow-y-auto p-6">
          {step === "describe" && (
            <div className="mx-auto max-w-2xl">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {"Describe your mission"}
              </h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {
                  "Please describe your mission with as much context as possible. Include the goal, users, constraints, and expected result."
                }
              </p>
              <label className="mt-5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {"Mission"}
                <textarea
                  ref={missionInputRef}
                  value={mission}
                  onChange={(event) => {
                    setMission(event.target.value);
                    setError(null);
                  }}
                  placeholder="For example: Add a way for users to..."
                  rows={9}
                  className="mt-2 w-full resize-y rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-blue-900"
                />
              </label>
              {error && (
                <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  {"Cancel"}
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                >
                  {"Generate preview"}
                </button>
              </div>
            </div>
          )}

          {step === "generating" && (
            <LoadingIndicator message="Generating your work-item plan..." />
          )}
          {step === "submitting" && <LoadingIndicator message="Submitting the approved plan..." />}

          {step === "preview" && plan && preview && (
            <div>
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {"Review generated work items"}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {
                      "Only this proposed plan is shown. You can use the same graph operations as on the main board."
                    }
                  </p>
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  {"Mock preview - nothing has been created in ADO"}
                </span>
              </div>

              <div
                aria-label="Generated work-item graph"
                className="h-[500px] overflow-hidden rounded-lg border border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-950"
              >
                <GraphView boardData={preview.boardData} previewActions={previewActions} />
              </div>

              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {
                  "State, sprint, and dependency changes update only this temporary preview and are not written to ADO."
                }
              </p>

              <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
                <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {"Ask AI to change the plan"}
                  <textarea
                    value={refinementRequest}
                    onChange={(event) => {
                      setRefinementRequest(event.target.value);
                      setError(null);
                    }}
                    placeholder="For example: Split the implementation into separate frontend and backend tasks."
                    rows={3}
                    className="mt-2 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 font-normal text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-blue-900"
                  />
                </label>
                {error && (
                  <p
                    role="alert"
                    className="mt-2 text-sm font-medium text-red-600 dark:text-red-400"
                  >
                    {error}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    className="rounded-lg border border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 dark:bg-gray-800 dark:text-blue-300 dark:hover:bg-gray-700"
                  >
                    {"Regenerate"}
                  </button>
                  <button
                    type="button"
                    onClick={handleFinalSubmit}
                    className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                  >
                    {"Final submit"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === "success" && (
            <div className="mx-auto flex min-h-72 max-w-xl flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl font-bold text-green-700 dark:bg-green-900/40 dark:text-green-300">
                {"OK"}
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {"Mock submission completed"}
              </h3>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                {
                  "The UI flow is complete, but no work items were created in Azure DevOps. Real submission will be connected in a later milestone."
                }
              </p>
              <button
                type="button"
                onClick={closeModal}
                className="mt-6 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {"Done"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
