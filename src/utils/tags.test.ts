import { describe, expect, it } from "vitest";
import { parseTags, serializeTags } from "./tags";

describe("parseTags", () => {
  it("trims, removes empty values, and deduplicates tags case-insensitively", () => {
    expect(parseTags("frontend; backend; ; Frontend")).toEqual(["frontend", "backend"]);
  });

  it("returns no tags for non-string values", () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags(42)).toEqual([]);
  });
});

describe("serializeTags", () => {
  it("uses Azure DevOps semicolon-delimited formatting", () => {
    expect(serializeTags(["frontend", "backend"])).toBe("frontend; backend");
  });
});
