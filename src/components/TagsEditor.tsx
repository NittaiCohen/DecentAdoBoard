import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchProjectTags } from "../api/tauri";
import type { JsonValue } from "../types";
import { getSavedConfig } from "../utils/storage";
import { parseTags, serializeTags } from "../utils/tags";

const TAG_SEARCH_DEBOUNCE_MS = 250;
const MIN_TAG_SEARCH_LENGTH = 2;

interface TagsEditorProps {
  value: JsonValue;
  disabled?: boolean;
  onChange: (value: JsonValue) => void;
}

function TagPill({
  tag,
  removable,
  onRemove,
}: {
  tag: string;
  removable: boolean;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200">
      <span className="max-w-48 truncate">{tag}</span>
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full px-0.5 text-gray-500 hover:bg-gray-300 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:text-gray-100"
          aria-label={`Remove tag ${tag}`}
          title={`Remove tag ${tag}`}
        >
          {"×"}
        </button>
      )}
    </span>
  );
}

export default function TagsEditor({ value, disabled = false, onChange }: TagsEditorProps) {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [searchText, setSearchText] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const tags = useMemo(() => parseTags(value), [value]);
  const savedConfig = getSavedConfig();
  const normalizedSearchText = searchText.trim().toLowerCase();
  const {
    data: projectTags = [],
    error,
    isFetching,
  } = useQuery({
    queryKey: [
      "projectTags",
      savedConfig?.organization,
      savedConfig?.project,
      normalizedSearchText,
    ],
    queryFn: () => {
      if (!savedConfig) {
        throw new Error("Project configuration is unavailable.");
      }

      return searchProjectTags(savedConfig.organization, savedConfig.project, normalizedSearchText);
    },
    enabled:
      isOpen &&
      !disabled &&
      savedConfig !== null &&
      normalizedSearchText.length >= MIN_TAG_SEARCH_LENGTH,
    staleTime: 300_000,
  });
  const normalizedInput = inputValue.trim().toLowerCase();
  const filteredTags = projectTags.filter(
    (tag) =>
      tag.name.trim().length > 0 &&
      tag.name.toLowerCase().includes(normalizedInput) &&
      !tags.some((selectedTag) => selectedTag.toLowerCase() === tag.name.toLowerCase()),
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
        setIsAddingTag(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchText(inputValue);
    }, TAG_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [inputValue]);

  function addTag(tagValue: string) {
    const trimmedTag = tagValue.trim();
    if (
      trimmedTag.length === 0 ||
      tags.some((tag) => tag.toLowerCase() === trimmedTag.toLowerCase())
    ) {
      return;
    }

    onChange(serializeTags([...tags, trimmedTag]));
    setInputValue("");
    setIsOpen(true);
  }

  function openTagInput() {
    setIsAddingTag(true);
    setIsOpen(true);
  }

  function removeTag(tagToRemove: string) {
    onChange(serializeTags(tags.filter((tag) => tag !== tagToRemove)));
  }

  return (
    <div ref={containerRef} className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <TagPill key={tag} tag={tag} removable={!disabled} onRemove={() => removeTag(tag)} />
        ))}
        {!disabled && !isAddingTag && (
          <button
            type="button"
            onClick={openTagInput}
            className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:border-blue-500 hover:text-blue-600 dark:border-gray-600 dark:text-gray-300 dark:hover:border-blue-400 dark:hover:text-blue-300"
          >
            {"+ Add tag"}
          </button>
        )}
        {!disabled && isAddingTag && (
          <div className="relative">
            <input
              autoFocus
              type="text"
              value={inputValue}
              onFocus={() => setIsOpen(true)}
              onChange={(event) => {
                setInputValue(event.target.value);
                setIsOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag(inputValue);
                } else if (event.key === "Escape") {
                  setIsOpen(false);
                  setIsAddingTag(false);
                  setInputValue("");
                  setSearchText("");
                }
              }}
              placeholder="Add tag"
              aria-label="Add a tag"
              className="w-32 rounded-full border border-blue-500 bg-white px-2 py-0.5 text-xs text-gray-900 outline-none dark:bg-gray-900 dark:text-gray-100"
            />
            {isOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-56 overflow-auto rounded border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
                {isFetching && (
                  <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                    {"Loading tags..."}
                  </p>
                )}
                {!isFetching &&
                  filteredTags.map((tag) => (
                    <button
                      key={tag.name}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => addTag(tag.name)}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-blue-600 hover:text-white dark:text-gray-200"
                    >
                      {tag.name}
                    </button>
                  ))}
                {error && (
                  <p className="px-3 py-2 text-sm text-red-600 dark:text-red-400">
                    {String(error)}
                  </p>
                )}
                {!isFetching && normalizedInput.length < MIN_TAG_SEARCH_LENGTH && (
                  <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                    {"Type at least 2 characters to search project tags"}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
