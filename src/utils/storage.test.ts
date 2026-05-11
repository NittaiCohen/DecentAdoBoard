import { describe, it, expect, beforeEach } from "vitest";
import { getSavedConfig, saveConfig, clearConfig } from "./storage";

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
  });
});
