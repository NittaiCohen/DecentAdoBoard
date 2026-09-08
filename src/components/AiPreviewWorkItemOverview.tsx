import { useMemo, useState } from "react";
import type { AiPlannerContext, GeneratedWorkItem, GeneratedWorkItemPlan } from "../types";
import RichTextFieldEditor from "./RichTextFieldEditor";
import { DEFAULT_TYPE_COLOR, TYPE_COLORS } from "../utils/workItemColors";

interface AiPreviewWorkItemOverviewProps {
  item: GeneratedWorkItem;
  plan: GeneratedWorkItemPlan;
  context: AiPlannerContext;
  onClose: () => void;
  onSave: (item: GeneratedWorkItem) => void;
}

const inputClass =
  "w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900";

function parseWorkItemType(value: string): GeneratedWorkItem["type"] | null {
  switch (value) {
    case "Bug":
    case "Task":
    case "User Story":
    case "Feature":
    case "Epic":
    case "Product Backlog Item":
      return value;
    default:
      return null;
  }
}

function collectDescendantIds(plan: GeneratedWorkItemPlan, rootTemporaryId: string): Set<string> {
  const descendants = new Set<string>();
  const pending = [rootTemporaryId];
  while (pending.length > 0) {
    const parentTemporaryId = pending.pop();
    for (const candidate of plan.items) {
      if (
        candidate.parentTemporaryId === parentTemporaryId &&
        !descendants.has(candidate.temporaryId)
      ) {
        descendants.add(candidate.temporaryId);
        pending.push(candidate.temporaryId);
      }
    }
  }
  return descendants;
}

function wouldCreateDependencyCycle(
  plan: GeneratedWorkItemPlan,
  predecessorTemporaryId: string,
  targetTemporaryId: string,
): boolean {
  const successors = new Map<string, string[]>();
  for (const item of plan.items) {
    for (const dependencyTemporaryId of item.dependencyTemporaryIds) {
      const current = successors.get(dependencyTemporaryId) ?? [];
      current.push(item.temporaryId);
      successors.set(dependencyTemporaryId, current);
    }
  }

  const pending = [targetTemporaryId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    if (current === predecessorTemporaryId) {
      return true;
    }
    visited.add(current);
    pending.push(...(successors.get(current) ?? []));
  }
  return false;
}

export default function AiPreviewWorkItemOverview({
  item,
  plan,
  context,
  onClose,
  onSave,
}: AiPreviewWorkItemOverviewProps) {
  const [draft, setDraft] = useState(item);
  const typeMetadata = context.workItemTypes.find((metadata) => metadata.name === draft.type);
  const typeColorClass = TYPE_COLORS[draft.type] ?? DEFAULT_TYPE_COLOR;
  const otherItems = useMemo(
    () => plan.items.filter((candidate) => candidate.temporaryId !== item.temporaryId),
    [item.temporaryId, plan.items],
  );
  const descendantIds = useMemo(
    () => collectDescendantIds(plan, item.temporaryId),
    [item.temporaryId, plan],
  );

  function update<K extends keyof GeneratedWorkItem>(key: K, value: GeneratedWorkItem[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function changeType(workItemType: string) {
    const parsedWorkItemType = parseWorkItemType(workItemType);
    if (!parsedWorkItemType) {
      return;
    }
    const metadata = context.workItemTypes.find((candidate) => candidate.name === workItemType);
    const parent = plan.items.find(
      (candidate) => candidate.temporaryId === draft.parentTemporaryId,
    );
    setDraft((current) => ({
      ...current,
      type: parsedWorkItemType,
      state: metadata?.initialState ?? current.state,
      parentTemporaryId: parent?.type === parsedWorkItemType ? null : current.parentTemporaryId,
    }));
  }

  function toggleDependency(temporaryId: string) {
    setDraft((current) => ({
      ...current,
      dependencyTemporaryIds: current.dependencyTemporaryIds.includes(temporaryId)
        ? current.dependencyTemporaryIds.filter((value) => value !== temporaryId)
        : [...current.dependencyTemporaryIds, temporaryId],
    }));
  }

  function changeParent(parentTemporaryId: string | null) {
    setDraft((current) => ({
      ...current,
      parentTemporaryId,
      dependencyTemporaryIds: parentTemporaryId
        ? current.dependencyTemporaryIds.filter((value) => value !== parentTemporaryId)
        : current.dependencyTemporaryIds,
    }));
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="flex h-[95vh] w-[95vw] flex-col overflow-hidden rounded-xl bg-gray-50 text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-gray-100"
        role="dialog"
        aria-modal="true"
        aria-label="Preview work item overview"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header
          className={`flex items-start justify-between gap-4 border-b border-l-4 border-gray-200 px-6 py-4 dark:border-gray-700 ${typeColorClass}`}
        >
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {`${draft.type} - temporary AI preview`}
            </p>
            <input
              aria-label="Title"
              className="w-full bg-transparent text-xl font-semibold outline-none"
              value={draft.title}
              onChange={(event) => update("title", event.target.value)}
            />
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                {"Type"}
                <select
                  className={inputClass}
                  value={draft.type}
                  onChange={(event) => changeType(event.target.value)}
                >
                  {context.workItemTypes.map((metadata) => (
                    <option key={metadata.name} value={metadata.name}>
                      {metadata.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                {"State"}
                <select
                  className={inputClass}
                  value={draft.state}
                  onChange={(event) => update("state", event.target.value)}
                >
                  {(typeMetadata?.states ?? [draft.state]).map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                {"Sprint"}
                <select
                  className={inputClass}
                  value={draft.iterationPath}
                  onChange={(event) => update("iterationPath", event.target.value)}
                >
                  {context.iterations.map((iteration) => (
                    <option key={iteration.path} value={iteration.path}>
                      {iteration.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                {"Assigned to"}
                <input
                  className={inputClass}
                  value={draft.assignedTo}
                  onChange={(event) => update("assignedTo", event.target.value)}
                />
              </label>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Close overview"
          >
            {"x"}
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <RichTextFieldEditor
              label="Description"
              value={draft.description}
              editable
              onChange={(value) => update("description", value)}
            />
            <RichTextFieldEditor
              label="Acceptance criteria"
              value={draft.acceptanceCriteria}
              editable
              onChange={(value) => update("acceptanceCriteria", value)}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              {"Parent"}
              <select
                className={inputClass}
                value={draft.parentTemporaryId ?? ""}
                onChange={(event) => changeParent(event.target.value || null)}
              >
                <option value="">{"No parent"}</option>
                {otherItems
                  .filter(
                    (candidate) =>
                      !(candidate.type === "Task" && draft.type === "Task") &&
                      !descendantIds.has(candidate.temporaryId),
                  )
                  .map((candidate) => (
                    <option key={candidate.temporaryId} value={candidate.temporaryId}>
                      {candidate.title}
                    </option>
                  ))}
              </select>
            </label>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{"Predecessors"}</legend>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {
                  "This work item waits for the selected items. Parent-child is hierarchy, not dependency."
                }
              </p>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-gray-300 p-2 dark:border-gray-600">
                {otherItems.map((candidate) => (
                  <label key={candidate.temporaryId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.dependencyTemporaryIds.includes(candidate.temporaryId)}
                      disabled={
                        draft.parentTemporaryId === candidate.temporaryId ||
                        candidate.parentTemporaryId === draft.temporaryId ||
                        wouldCreateDependencyCycle(
                          {
                            ...plan,
                            items: plan.items.map((planItem) =>
                              planItem.temporaryId === draft.temporaryId ? draft : planItem,
                            ),
                          },
                          candidate.temporaryId,
                          draft.temporaryId,
                        )
                      }
                      onChange={() => toggleDependency(candidate.temporaryId)}
                    />
                    <span>{candidate.title}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-gray-200 px-6 py-3 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-gray-200 px-4 py-2 text-sm dark:bg-gray-700"
          >
            {"Cancel"}
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            disabled={!draft.title.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {"Save preview changes"}
          </button>
        </footer>
      </div>
    </div>
  );
}
