import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "../hooks/useTheme";
import { useKeyDown } from "../hooks/useKeyDown";
import { THEME_LABELS, THEME_ICONS } from "../utils/themeConstants";

interface HamburgerMenuProps {
  onChangeProject: () => void;
  onSignOut: () => void;
}

export default function HamburgerMenu({ onChangeProject, onSignOut }: HamburgerMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { preference, cycle } = useTheme();

  const closeMenu = useCallback(() => setIsOpen(false), []);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handleClickOutside(event: MouseEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }
      const clickedButton = buttonRef.current?.contains(event.target) ?? false;
      const clickedPanel = panelRef.current?.contains(event.target) ?? false;
      if (!clickedButton && !clickedPanel) {
        closeMenu();
      }
    }
    document.addEventListener("mousedown", handleClickOutside, true);
    return () => document.removeEventListener("mousedown", handleClickOutside, true);
  }, [isOpen, closeMenu]);

  useKeyDown("Escape", closeMenu, { enabled: isOpen, preventDefault: false });

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="absolute top-3 left-3 z-20 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium w-8 h-8 rounded shadow transition-colors flex items-center justify-center"
        title="Menu"
      >
        {"☰"}
      </button>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 dark:bg-black/40 z-30 transition-opacity"
          onClick={closeMenu}
        />
      )}

      {/* Side panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 left-0 h-full w-56 bg-white dark:bg-gray-800 border-r border-gray-300 dark:border-gray-600 shadow-lg z-40 transform transition-transform duration-200 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{"Menu"}</span>
          <button
            onClick={closeMenu}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg transition-colors"
            title="Close menu"
          >
            {"✕"}
          </button>
        </div>

        <div className="py-2">
          <button
            onClick={cycle}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2 text-gray-700 dark:text-gray-300"
          >
            {`${THEME_ICONS[preference]} Theme: ${THEME_LABELS[preference]}`}
          </button>
          <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
          <button
            onClick={() => {
              closeMenu();
              onChangeProject();
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
          >
            {"⚙ Change Project"}
          </button>
          <button
            onClick={() => {
              closeMenu();
              onSignOut();
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
          >
            {"⎋ Sign Out"}
          </button>
        </div>
      </div>
    </>
  );
}
