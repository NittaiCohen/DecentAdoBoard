import { describe, expect, it } from "vitest";
import { getCurrentIterationPath } from "./iterations";

describe("getCurrentIterationPath", () => {
  it("returns the iteration containing the current time", () => {
    const currentTime = new Date("2026-09-08T11:12:11.126Z");

    expect(
      getCurrentIterationPath(
        [
          {
            id: "past",
            name: "Past",
            path: "Project\\Past",
            start_date: "2026-08-01T00:00:00.000Z",
            finish_date: "2026-08-31T23:59:59.999Z",
          },
          {
            id: "current",
            name: "Current",
            path: "Project\\Current",
            start_date: "2026-09-01T00:00:00.000Z",
            finish_date: "2026-09-30T23:59:59.999Z",
          },
        ],
        currentTime,
      ),
    ).toBe("Project\\Current");
  });

  it("returns null when no iteration contains the current time", () => {
    expect(
      getCurrentIterationPath(
        [
          {
            id: "future",
            name: "Future",
            path: "Project\\Future",
            start_date: "2026-10-01T00:00:00.000Z",
            finish_date: "2026-10-31T23:59:59.999Z",
          },
        ],
        new Date("2026-09-08T11:12:11.126Z"),
      ),
    ).toBeNull();
  });
});
