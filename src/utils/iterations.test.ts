import { describe, expect, it } from "vitest";
import type { Iteration } from "../types";
import { findCurrentIterationPath } from "./iterations";

const iterations: Iteration[] = [
  {
    id: "past",
    name: "Past",
    path: "Project\\Past",
    start_date: "2026-08-01T00:00:00.000Z",
    finish_date: "2026-08-14T23:59:59.999Z",
  },
  {
    id: "current",
    name: "Current",
    path: "Project\\Current",
    start_date: "2026-09-01T00:00:00.000Z",
    finish_date: "2026-09-14T23:59:59.999Z",
  },
];

describe("findCurrentIterationPath", () => {
  it("returns the iteration containing the current date", () => {
    expect(findCurrentIterationPath(iterations, new Date("2026-09-07T12:00:00.000Z"))).toBe(
      "Project\\Current",
    );
  });

  it("returns undefined when no iteration contains the current date", () => {
    expect(findCurrentIterationPath(iterations, new Date("2026-10-01T12:00:00.000Z"))).toBe(
      undefined,
    );
  });
});
