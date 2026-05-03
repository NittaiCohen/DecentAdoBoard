import { describe, it, expect } from "vitest";
import {
  TYPE_COLORS,
  DEFAULT_TYPE_COLOR,
  STATE_BADGES,
  DEFAULT_STATE_BADGE,
} from "./workItemColors";

/** Simulates how consuming code resolves a type color (map lookup with fallback). */
function getTypeColor(type: string): string {
  return TYPE_COLORS[type] ?? DEFAULT_TYPE_COLOR;
}

/** Simulates how consuming code resolves a state badge (map lookup with fallback). */
function getStateBadge(state: string): string {
  return STATE_BADGES[state] ?? DEFAULT_STATE_BADGE;
}

describe("TYPE_COLORS", () => {
  it("returns correct color for known work item types", () => {
    expect(TYPE_COLORS["Bug"]).toContain("red");
    expect(TYPE_COLORS["Task"]).toContain("yellow");
    expect(TYPE_COLORS["User Story"]).toContain("blue");
    expect(TYPE_COLORS["Feature"]).toContain("purple");
    expect(TYPE_COLORS["Epic"]).toContain("orange");
    expect(TYPE_COLORS["Product Backlog Item"]).toContain("blue");
  });

  it("falls back to DEFAULT_TYPE_COLOR for unknown types", () => {
    const color = getTypeColor("UnknownType");
    expect(color).toBe(DEFAULT_TYPE_COLOR);
    expect(color).toContain("gray");
    expect(color).toContain("border-");
    expect(color).toContain("bg-");
  });

  it("every known type includes border and bg classes", () => {
    for (const [type, classes] of Object.entries(TYPE_COLORS)) {
      expect(classes, `${type} should have border`).toContain("border-");
      expect(classes, `${type} should have bg`).toContain("bg-");
    }
  });
});

describe("STATE_BADGES", () => {
  it("returns correct badge for known states", () => {
    expect(STATE_BADGES["New"]).toContain("gray");
    expect(STATE_BADGES["Active"]).toContain("blue");
    expect(STATE_BADGES["In Progress"]).toContain("blue");
    expect(STATE_BADGES["In Review"]).toContain("purple");
    expect(STATE_BADGES["Done"]).toContain("green");
    expect(STATE_BADGES["Closed"]).toContain("green");
    expect(STATE_BADGES["Resolved"]).toContain("green");
    expect(STATE_BADGES["Removed"]).toContain("gray");
  });

  it("falls back to DEFAULT_STATE_BADGE for unknown states", () => {
    const badge = getStateBadge("FakeState");
    expect(badge).toBe(DEFAULT_STATE_BADGE);
    expect(badge).toContain("gray");
    expect(badge).toContain("bg-");
    expect(badge).toContain("text-");
  });

  it("every known state includes bg and text classes", () => {
    for (const [state, classes] of Object.entries(STATE_BADGES)) {
      expect(classes, `${state} should have bg`).toContain("bg-");
      expect(classes, `${state} should have text`).toContain("text-");
    }
  });
});
