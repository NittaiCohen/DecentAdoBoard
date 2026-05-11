import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getWorkItemTypeStates, updateWorkItemState } from "../api/tauri";
import { STATE_BADGES, DEFAULT_STATE_BADGE } from "../utils/workItemColors";
import { getSavedConfig } from "../utils/storage";

const MENU_GAP_PX = 4;
const FIVE_MINUTES_MS = 300_000;

interface StateDropdownProps {
  workItemId: number;
  workItemType: string;
  currentState: string;
}

export default function StateDropdown({
  workItemId,
  workItemType,
  currentState,
}: StateDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [displayState, setDisplayState] = useState(currentState);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const queryClient = useQueryClient();

  // Stay in sync when boardData refetches with authoritative data
  useEffect(() => {
    setDisplayState(currentState);
  }, [currentState]);

  // Read org+project from saved config for cache key scoping
  const config = useMemo(() => getSavedConfig(), []);

  const { data: states, isLoading } = useQuery({
    queryKey: [
      "workItemTypeStates",
      config?.organization ?? "",
      config?.project ?? "",
      workItemType,
    ],
    queryFn: () => getWorkItemTypeStates(workItemType),
    enabled: isOpen,
    staleTime: FIVE_MINUTES_MS,
  });

  const mutation = useMutation({
    mutationFn: (newState: string) => updateWorkItemState(workItemId, newState),
    onSuccess: (_data, newState) => {
      setIsOpen(false);
      setDisplayState(newState);
      void queryClient.invalidateQueries({ queryKey: ["boardData"] });
    },
  });

  const openDropdown = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + MENU_GAP_PX, left: rect.left });
    }
    setIsOpen(true);
  }, []);

  // Close dropdown on any scroll or wheel (viewport moved)
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handleScroll() {
      setIsOpen(false);
    }
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("wheel", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("wheel", handleScroll, true);
    };
  }, [isOpen]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handleClickOutside(e: MouseEvent) {
      if (!(e.target instanceof Node)) {
        return;
      }
      const clickedButton = buttonRef.current?.contains(e.target) ?? false;
      const clickedMenu = menuRef.current?.contains(e.target) ?? false;
      if (!clickedButton && !clickedMenu) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [isOpen]);

  // Close dropdown on Escape
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const stateClass = STATE_BADGES[displayState] ?? DEFAULT_STATE_BADGE;

  return (
    <span className="relative inline-block nodrag nopan">
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) {
            setIsOpen(false);
          } else {
            openDropdown();
          }
        }}
        disabled={mutation.isPending}
        className={`text-[10px] px-1 py-0.5 rounded cursor-pointer hover:ring-1 hover:ring-gray-400 dark:hover:ring-gray-500 transition-all ${stateClass} ${mutation.isPending ? "opacity-40 cursor-wait" : ""}`}
        title="Click to change state"
      >
        {displayState}
      </button>

      {isOpen &&
        menuPos !== null &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed min-w-[140px] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg py-1"
            style={{ top: menuPos.top, left: menuPos.left, zIndex: 9999 }}
          >
            {isLoading && (
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                {"Loading..."}
              </div>
            )}

            {states?.map((state) => {
              const isActive = state.name === displayState;
              const itemStateClass = STATE_BADGES[state.name] ?? DEFAULT_STATE_BADGE;

              return (
                <button
                  key={state.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isActive && !mutation.isPending) {
                      mutation.mutate(state.name);
                    }
                  }}
                  disabled={isActive || mutation.isPending}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${isActive ? "opacity-50 cursor-default" : "cursor-pointer"}`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: `#${state.color}` }}
                  />
                  <span className={`px-1 py-0.5 rounded ${itemStateClass}`}>{state.name}</span>
                </button>
              );
            })}

            {mutation.isError && (
              <div className="px-3 py-1.5 text-[10px] text-red-600 dark:text-red-400 border-t border-gray-200 dark:border-gray-700">
                {`Error: ${String(mutation.error)}`}
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
