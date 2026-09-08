import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { isObject } from "lodash-es";
import { searchIdentities } from "../api/tauri";
import type { IdentitySearchResult, JsonValue } from "../types";

interface AssignedToSelectorProps {
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  disabled?: boolean;
}

function getIdentityDisplayValue(value: JsonValue): string {
  if (typeof value === "string") {
    return value;
  }
  if (isObject(value) && !Array.isArray(value)) {
    const displayName = value.displayName;
    if (typeof displayName === "string") {
      return displayName;
    }
    const uniqueName = value.uniqueName;
    if (typeof uniqueName === "string") {
      return uniqueName;
    }
  }
  return "";
}

export default function AssignedToSelector({
  value,
  onChange,
  disabled = false,
}: AssignedToSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [selectedIdentity, setSelectedIdentity] = useState<IdentitySearchResult | null>(null);
  const currentValue = getIdentityDisplayValue(value);
  const trimmedSearchText = searchText.trim();
  const {
    data: identities = [],
    error,
    isFetching,
  } = useQuery({
    queryKey: ["identitySearch", trimmedSearchText],
    queryFn: () => searchIdentities(trimmedSearchText),
    enabled: isOpen && trimmedSearchText.length >= 2,
    staleTime: 300_000,
  });
  let selectedIdentityVisual: ReactNode = null;

  if (selectedIdentity?.avatarDataUrl) {
    selectedIdentityVisual = (
      <img
        src={selectedIdentity.avatarDataUrl}
        alt=""
        className="h-5 w-5 shrink-0 rounded-full object-cover"
      />
    );
  } else if (selectedIdentity) {
    selectedIdentityVisual = (
      <span
        aria-hidden="true"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300"
      >
        {selectedIdentity.displayName.charAt(0).toUpperCase()}
      </span>
    );
  }

  function openSelector() {
    if (!disabled) {
      setIsOpen(true);
      setSearchText("");
    }
  }

  function closeSelector() {
    setIsOpen(false);
    setSearchText("");
  }

  function selectIdentity(identity: IdentitySearchResult | null) {
    setSelectedIdentity(identity);
    onChange(identity?.uniqueName ?? null);
    closeSelector();
  }

  return (
    <div className="relative min-w-[200px]">
      {isOpen ? (
        <>
          <input
            autoFocus
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeSelector();
              }
            }}
            placeholder="Search people"
            className="w-full rounded border border-blue-500 bg-white px-2 py-1 text-sm text-gray-900 outline-none dark:bg-gray-800 dark:text-gray-100"
          />
          <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectIdentity(null)}
              className="block w-full px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              {"Unassigned"}
            </button>
            {isFetching && (
              <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{"Searching..."}</p>
            )}
            {!isFetching && trimmedSearchText.length < 2 && (
              <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                {"Type at least 2 characters"}
              </p>
            )}
            {!error && !isFetching && trimmedSearchText.length >= 2 && identities.length === 0 && (
              <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                {"No people found"}
              </p>
            )}
            {error && (
              <p className="px-3 py-2 text-sm text-red-600 dark:text-red-400">{String(error)}</p>
            )}
            {identities.map((identity) => (
              <button
                key={identity.uniqueName}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectIdentity(identity)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 hover:bg-blue-600 hover:text-white dark:text-gray-200"
              >
                {identity.avatarDataUrl ? (
                  <img
                    src={identity.avatarDataUrl}
                    alt=""
                    className="h-7 w-7 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  >
                    {identity.displayName.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate">{identity.displayName}</span>
                  {identity.uniqueName !== identity.displayName && (
                    <span className="block truncate text-xs opacity-70">{identity.uniqueName}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={openSelector}
          disabled={disabled}
          className="flex max-w-full items-center gap-2 truncate rounded border border-transparent px-1 py-0.5 text-sm text-gray-700 hover:border-gray-300 dark:text-gray-300 dark:hover:border-gray-600 disabled:cursor-default disabled:hover:border-transparent"
          title={currentValue || "Unassigned"}
        >
          {selectedIdentityVisual}
          <span className="truncate">{currentValue || "Unassigned"}</span>
        </button>
      )}
    </div>
  );
}
