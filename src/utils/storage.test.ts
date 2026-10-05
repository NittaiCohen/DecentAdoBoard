import { describe, it, expect, beforeEach } from "vitest";
import {
  clearConfig,
  getChildWorkItemTypePreference,
  getRecentWorkItemTypes,
  getSavedConfig,
  isWorkItemType,
  removeChildWorkItemTypePreference,
  removeRecentWorkItemType,
  saveConfig,
  saveChildWorkItemTypePreference,
  saveRecentWorkItemType,
} from "./storage";

describe("storage utilities", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("saveConfig / clearConfig", () => {
    it("saves and retrieves config", () => {
      const config = { organization: "myorg", project: "myproj", areaPath: "MyArea\\Team" };
      saveConfig(config);
      expect(getSavedConfig()).toEqual(config);
    });

    it("removes saved config", () => {
      saveConfig({ organization: "myorg", project: "myproj", areaPath: "MyArea\\Team" });
      clearConfig();
      expect(getSavedConfig()).toBeNull();
    });

    it("does not throw when nothing is saved", () => {
      clearConfig();
      expect(getSavedConfig()).toBeNull();
    });
  });

  describe("getSavedConfig", () => {
    it("returns null when no config is saved", () => {
      expect(getSavedConfig()).toBeNull();
    });

    it("returns valid config", () => {
      const config = { organization: "myorg", project: "myproj", areaPath: "MyArea\\Team" };
      localStorage.setItem("ado-config", JSON.stringify(config));
      expect(getSavedConfig()).toEqual(config);
    });

    it("returns null for invalid JSON", () => {
      localStorage.setItem("ado-config", "not-json{{{");
      expect(getSavedConfig()).toBeNull();
    });

    it("returns null when required fields are missing", () => {
      localStorage.setItem("ado-config", JSON.stringify({ organization: "org" }));
      expect(getSavedConfig()).toBeNull();
    });

    it("returns null when fields are empty strings", () => {
      const config = { organization: "", project: "proj", areaPath: "area" };
      localStorage.setItem("ado-config", JSON.stringify(config));
      expect(getSavedConfig()).toBeNull();
    });

    it("returns null for non-string field values", () => {
      const config = { organization: 123, project: "proj", areaPath: "area" };
      localStorage.setItem("ado-config", JSON.stringify(config));
      expect(getSavedConfig()).toBeNull();
    });

    describe("recent work item types", () => {
      it("accepts custom ADO work item types", () => {
        expect(isWorkItemType("Custom Review Item")).toBe(true);
        expect(isWorkItemType("")).toBe(false);
      });

      it("stores the newest type first and removes duplicates", () => {
        saveRecentWorkItemType("Bug");
        saveRecentWorkItemType("Task");
        saveRecentWorkItemType("Bug");

        expect(getRecentWorkItemTypes()).toEqual(["Bug", "Task"]);
      });

      it("keeps only the five most recent types", () => {
        ["Bug", "Task", "Feature", "Epic", "User Story", "Product Backlog Item"].forEach(
          saveRecentWorkItemType,
        );

        expect(getRecentWorkItemTypes()).toEqual([
          "Product Backlog Item",
          "User Story",
          "Epic",
          "Feature",
          "Task",
        ]);
      });

      it("removes a type from the recent list", () => {
        saveRecentWorkItemType("Bug");
        saveRecentWorkItemType("Task");
        removeRecentWorkItemType("Bug");

        expect(getRecentWorkItemTypes()).toEqual(["Task"]);
      });
    });

    describe("child work item type preferences", () => {
      it("stores a preference by parent work item type", () => {
        saveChildWorkItemTypePreference("Bug", "Task");

        expect(getChildWorkItemTypePreference("Bug")).toEqual(["Task"]);
        expect(getChildWorkItemTypePreference("Product Backlog Item")).toEqual([]);
      });

      it("keeps the five most recent child types for a parent work item type", () => {
        saveChildWorkItemTypePreference("Bug", "Task");
        saveChildWorkItemTypePreference("Bug", "User Story");
        saveChildWorkItemTypePreference("Bug", "Feature");
        saveChildWorkItemTypePreference("Bug", "Epic");
        saveChildWorkItemTypePreference("Bug", "Product Backlog Item");
        saveChildWorkItemTypePreference("Bug", "Task");

        expect(getChildWorkItemTypePreference("Bug")).toEqual([
          "Task",
          "Product Backlog Item",
          "Epic",
          "Feature",
          "User Story",
        ]);
      });

      it("keeps preferences for different parent types separate", () => {
        saveChildWorkItemTypePreference("Bug", "Task");
        saveChildWorkItemTypePreference("Product Backlog Item", "Bug");

        expect(getChildWorkItemTypePreference("Bug")).toEqual(["Task"]);
        expect(getChildWorkItemTypePreference("Product Backlog Item")).toEqual(["Bug"]);
      });

      it("removes a child type without removing other preferences", () => {
        saveChildWorkItemTypePreference("Bug", "Task");
        saveChildWorkItemTypePreference("Bug", "User Story");
        removeChildWorkItemTypePreference("Bug", "Task");

        expect(getChildWorkItemTypePreference("Bug")).toEqual(["User Story"]);
      });
    });
  });
});
