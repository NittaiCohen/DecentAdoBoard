import type { JsonValue } from "../types";

export function parseTags(value: JsonValue): string[] {
  if (typeof value !== "string") {
    return [];
  }

  const tags = value
    .split(";")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  return tags.filter(
    (tag, index) =>
      tags.findIndex((candidate) => candidate.toLowerCase() === tag.toLowerCase()) === index,
  );
}

export function serializeTags(tags: string[]): string {
  return tags.join("; ");
}
