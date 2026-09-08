import { useState, useEffect, useRef, useCallback } from "react";

interface ComboBoxProps {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  loading?: boolean;
  placeholder: string;
  disabled?: boolean;
}

function DropdownList({
  filtered,
  value,
  onSelect,
}: {
  filtered: string[];
  value: string;
  onSelect: (opt: string) => void;
}) {
  return (
    <ul className="absolute z-50 mt-1 w-full max-h-48 overflow-auto bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded shadow-lg">
      {filtered.map((opt) => (
        <li
          key={opt}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(opt);
          }}
          className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-600 hover:text-white ${
            opt === value ? "bg-blue-700 text-white" : "text-gray-800 dark:text-gray-200"
          }`}
        >
          {opt}
        </li>
      ))}
    </ul>
  );
}

function ChevronButton({
  open,
  disabled,
  onClick,
}: {
  open: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClick}
      disabled={disabled}
      className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <svg
        className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

/** Hook that calls a callback when a click occurs outside the referenced container. */
function useClickOutside(
  containerRef: React.RefObject<HTMLDivElement | null>,
  onClickOutside: () => void,
) {
  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        !containerRef.current.contains(e.target)
      ) {
        onClickOutside();
      }
    },
    [containerRef, onClickOutside],
  );

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [handleClickOutside]);
}

export default function ComboBox({
  label,
  value,
  onChange,
  options,
  loading,
  placeholder,
  disabled,
}: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const safeOptions = options.filter((o): o is string => typeof o === "string" && o.length > 0);
  const filtered = safeOptions.filter((o) => o.toLowerCase().includes(filter.toLowerCase()));

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setFilter("");
  }, []);

  useClickOutside(containerRef, closeDropdown);

  function toggleOpen() {
    if (disabled) {
      return;
    }
    if (open) {
      closeDropdown();
    } else {
      setOpen(true);
      setFilter(value);
      inputRef.current?.focus();
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(e.target.value);
    onChange(e.target.value);
    if (!open) {
      setOpen(true);
    }
  };

  const handleInputFocus = () => {
    setOpen(true);
    setFilter(value);
  };

  function handleSelect(opt: string) {
    onChange(opt);
    closeDropdown();
  }

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {label}
          {loading && (
            <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{"Loading..."}</span>
          )}
        </label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={open ? filter : value}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 pr-8 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <ChevronButton open={open} disabled={disabled} onClick={toggleOpen} />
      </div>
      {open && filtered.length > 0 && (
        <DropdownList filtered={filtered} value={value} onSelect={handleSelect} />
      )}
      {open && safeOptions.length > 0 && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded shadow-lg px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
          {"No matches"}
        </div>
      )}
    </div>
  );
}
