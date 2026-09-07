import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useKeyDown } from "../hooks/useKeyDown";
import type { StateOption } from "../utils/workItemStates";
import StateBadge from "./StateBadge";

const MENU_GAP_PX = 4;
const DROPDOWN_Z_INDEX = 9999;

interface StateSelectorProps {
  value: string;
  options: StateOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  portal?: boolean;
  ariaLabel?: string;
  onOpenChange?: (isOpen: boolean) => void;
}

export default function StateSelector({
  value,
  options,
  onChange,
  disabled = false,
  portal = false,
  ariaLabel = "Change state",
  onOpenChange,
}: StateSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const openSelector = useCallback(() => {
    if (portal && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + MENU_GAP_PX, left: rect.left });
    }
    setIsOpen(true);
    onOpenChange?.(true);
  }, [onOpenChange, portal]);

  const closeSelector = useCallback(() => {
    setIsOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleClickOutside(event: MouseEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }
      const clickedButton = buttonRef.current?.contains(event.target) ?? false;
      const clickedMenu = menuRef.current?.contains(event.target) ?? false;
      if (!clickedButton && !clickedMenu) {
        closeSelector();
      }
    }

    document.addEventListener("mousedown", handleClickOutside, true);
    return () => document.removeEventListener("mousedown", handleClickOutside, true);
  }, [closeSelector, isOpen]);

  useEffect(() => {
    if (!isOpen || !portal) {
      return;
    }

    function handleViewportMove() {
      closeSelector();
    }

    window.addEventListener("scroll", handleViewportMove, true);
    window.addEventListener("wheel", handleViewportMove, true);
    return () => {
      window.removeEventListener("scroll", handleViewportMove, true);
      window.removeEventListener("wheel", handleViewportMove, true);
    };
  }, [closeSelector, isOpen, portal]);

  useKeyDown("Escape", closeSelector, { enabled: isOpen, preventDefault: false });

  function renderMenu() {
    const menu = (
      <div
        ref={menuRef}
        className={`min-w-[140px] rounded-lg border border-gray-300 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800 ${
          portal ? "fixed" : "absolute left-0 top-full z-20 mt-1"
        }`}
        style={
          portal && menuPos
            ? { top: menuPos.top, left: menuPos.left, zIndex: DROPDOWN_Z_INDEX }
            : undefined
        }
      >
        {options.map((option) => {
          const isSelected = option.name === value;

          return (
            <button
              key={option.name}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (!isSelected) {
                  onChange(option.name);
                  closeSelector();
                }
              }}
              disabled={isSelected}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
                isSelected ? "cursor-default opacity-50" : "cursor-pointer"
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full bg-gray-400"
                style={option.color ? { backgroundColor: `#${option.color}` } : undefined}
              />
              <StateBadge state={option.name} />
            </button>
          );
        })}
      </div>
    );

    return portal ? createPortal(menu, document.body) : menu;
  }

  return (
    <span className={`relative inline-block ${portal ? "nodrag nopan" : ""}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onClick={(event) => {
          event.stopPropagation();
          if (isOpen) {
            closeSelector();
          } else {
            openSelector();
          }
        }}
        className="cursor-pointer rounded transition-all hover:ring-1 hover:ring-gray-400 dark:hover:ring-gray-500 disabled:cursor-default disabled:hover:ring-0"
        title={ariaLabel}
      >
        <StateBadge state={value} />
      </button>
      {isOpen && (!portal || menuPos !== null) && renderMenu()}
    </span>
  );
}
