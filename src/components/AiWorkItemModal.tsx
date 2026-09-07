import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AiPlannerContext, GeneratedWorkItemPlan, SubmitWorkItemPlanResult } from "../types";
import { generateWorkItemPlan, getAiPlannerContext, submitWorkItemPlan } from "../api/tauri";
import { createGeneratedPlanPreview } from "../utils/generatedPlanPreview";
import GraphView, { type GraphPreviewActions } from "./GraphView";

type ModalStep =
  | "describe"
  | "generating"
  | "preview"
  | "confirm"
  | "submitting"
  | "failure"
  | "success";

interface AiWorkItemModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function LoadingIndicator({ message }: { message: string }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center text-center">
      <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600 dark:border-blue-900 dark:border-t-blue-400" />
      <p className="font-medium text-gray-800 dark:text-gray-100">{message}</p>
    </div>
  );
}

function usePreviewActions(
  plan: GeneratedWorkItemPlan | null,
  context: AiPlannerContext | null,
  setPlan: Dispatch<SetStateAction<GeneratedWorkItemPlan | null>>,
): {
  preview: ReturnType<typeof createGeneratedPlanPreview> | null;
  previewActions: GraphPreviewActions | undefined;
} {
  const preview = useMemo(
    () => (plan ? createGeneratedPlanPreview(plan, context?.iterations) : null),
    [context?.iterations, plan],
  );

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

export default function AiWorkItemModal({ isOpen, onClose }: AiWorkItemModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<ModalStep>("describe");
  const [mission, setMission] = useState("");
  const [refinementRequest, setRefinementRequest] = useState("");
  const [plan, setPlan] = useState<GeneratedWorkItemPlan | null>(null);
  const [context, setContext] = useState<AiPlannerContext | null>(null);
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<SubmitWorkItemPlanResult | null>(null);
  const [existingAdoIds, setExistingAdoIds] = useState<Record<string, number>>({});
  const [submissionId, setSubmissionId] = useState("");
  const [isSubmissionLocked, setIsSubmissionLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missionInputRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const { preview, previewActions } = usePreviewActions(plan, context, setPlan);

  const closeModal = useCallback(() => {
    onClose();
  }, [onClose]);

  const loadContext = useCallback(() => {
    setIsContextLoading(true);
    setError(null);
    void getAiPlannerContext()
      .then(setContext)
      .catch((contextError: unknown) => {
        setError(String(contextError));
      })
      .finally(() => setIsContextLoading(false));
  }, []);

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
    setContext(null);
    setSubmissionResult(null);
    setExistingAdoIds({});
    setSubmissionId(globalThis.crypto.randomUUID());
    setIsSubmissionLocked(false);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => missionInputRef.current?.focus());
    loadContext();

    return () => {
      document.body.style.overflow = "";
      previousActiveElementRef.current?.focus();
    };
  }, [isOpen, loadContext]);

  if (!isOpen) {
    return null;
  }

  async function handleGenerate() {
    if (!mission.trim()) {
      setError("Describe the mission before generating work items.");
      missionInputRef.current?.focus();
      return;
    }
    setError(null);
    setStep("generating");
    try {
      const generatedPlan = await generateWorkItemPlan({ mission });
      setPlan(generatedPlan);
      setStep("preview");
    } catch (generationError) {
      setError(String(generationError));
      setStep("describe");
    }
  }

  async function handleRegenerate() {
    if (!refinementRequest.trim()) {
      setError("Describe the changes you want the AI to make.");
      return;
    }
    setError(null);
    setStep("generating");
    try {
      const generatedPlan = await generateWorkItemPlan({
        mission,
        refinementRequest,
        currentPlan: plan ?? undefined,
      });
      setPlan(generatedPlan);
      setRefinementRequest("");
      setStep("preview");
    } catch (generationError) {
      setError(String(generationError));
      setStep("preview");
    }
  }

  function handleFinalSubmit() {
    setError(null);
    setStep("confirm");
  }

  async function handleConfirmedSubmit() {
    if (!plan || !submissionId) {
      return;
    }
    setError(null);
    setIsSubmissionLocked(true);
    setStep("submitting");
    try {
      const result = await submitWorkItemPlan({
        plan,
        submissionId,
        existingAdoIds,
      });
      setSubmissionResult(result);
      setExistingAdoIds(result.adoIds);
      if (result.error) {
        setStep("failure");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["boardData"] });
      setStep("success");
    } catch (submissionError) {
      setError(String(submissionError));
      setStep("failure");
    }
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!isSubmissionLocked && step !== "submitting") {
        closeModal();
      }
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
  const hasPartialSubmission = isSubmissionLocked && step !== "success";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy && !hasPartialSubmission) {
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
            disabled={isBusy || hasPartialSubmission}
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
              {isContextLoading && (
                <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                  {"Loading Azure DevOps planning metadata..."}
                </p>
              )}
              {context && !context.aiReady && (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  <p className="font-semibold">{"AI is not available"}</p>
                  <p className="mt-1">{context.aiError}</p>
                  <button
                    type="button"
                    onClick={loadContext}
                    disabled={isContextLoading}
                    className="mt-3 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/70"
                  >
                    {isContextLoading ? "Checking..." : "Check again"}
                  </button>
                </div>
              )}
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
                  onClick={() => void handleGenerate()}
                  disabled={isContextLoading || !context || !context.aiReady}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-gray-900"
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
                  {"Preview - nothing has been created in ADO"}
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
                    onClick={() => void handleRegenerate()}
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

          {step === "confirm" && plan && (
            <div className="mx-auto max-w-xl">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {"Create these work items in Azure DevOps?"}
              </h3>
              <p className="mt-3 text-gray-600 dark:text-gray-400">
                {`This will create ${plan.items.length} work items, their parent-child hierarchy, and their dependency links in the configured project.`}
              </p>
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                {
                  "This is a real external write. If ADO rejects an item partway through, creation will stop and the IDs already created will be shown."
                }
              </div>
              <div className="mt-6 flex justify-end gap-3">
                {!hasPartialSubmission && (
                  <button
                    type="button"
                    onClick={() => setStep("preview")}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    {"Back to preview"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleConfirmedSubmit()}
                  className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700"
                >
                  {"Create in ADO"}
                </button>
              </div>
            </div>
          )}

          {step === "failure" && (
            <div className="mx-auto max-w-2xl">
              <h3 className="text-xl font-bold text-red-700 dark:text-red-400">
                {"ADO submission stopped"}
              </h3>
              <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
                {submissionResult?.error ?? error ?? "The submission failed."}
              </p>
              {Object.keys(existingAdoIds).length > 0 && (
                <div className="mt-4 rounded-lg border border-gray-300 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    {"ADO IDs already created"}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                    {Object.entries(existingAdoIds).map(([temporaryId, adoId]) => (
                      <li key={temporaryId}>{`${temporaryId}: #${adoId}`}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-6 flex justify-end gap-3">
                {!hasPartialSubmission && (
                  <button
                    type="button"
                    onClick={() => setStep("preview")}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    {"Back to preview"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleConfirmedSubmit()}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  {"Retry submission"}
                </button>
              </div>
            </div>
          )}

          {step === "success" && (
            <div className="mx-auto flex min-h-72 max-w-xl flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl font-bold text-green-700 dark:bg-green-900/40 dark:text-green-300">
                {"OK"}
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {"Work items created in Azure DevOps"}
              </h3>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                {`${Object.keys(existingAdoIds).length} work items are now linked to real ADO IDs, and the board data has been refreshed.`}
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
