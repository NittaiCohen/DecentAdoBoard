import { describe, it, expect, beforeEach } from "vitest";
import { getSavedPat, getSavedConfig, savePat, clearPat } from "./storage";

describe("storage utilities", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("savePat / getSavedPat", () => {
    it("returns null when no PAT is saved", () => {
      expect(getSavedPat()).toBeNull();
    });

    it("saves and retrieves a PAT", () => {
      savePat("my-secret-token");
      expect(getSavedPat()).toBe("my-secret-token");
    });

    it("returns PAT when expiry is in the future", () => {
      const future = new Date(Date.now() + 86400000).toISOString(); // +1 day
      savePat("valid-token", future);
      expect(getSavedPat()).toBe("valid-token");
    });

    it("returns null when PAT is expired", () => {
      const past = new Date(Date.now() - 86400000).toISOString(); // -1 day
      savePat("expired-token", past);
      expect(getSavedPat()).toBeNull();
    });

    it("clears localStorage when PAT is expired", () => {
      const past = new Date(Date.now() - 86400000).toISOString(); // -1 day
      savePat("expired-token", past);
      getSavedPat();
      expect(localStorage.getItem("ado_pat")).toBeNull();
      expect(localStorage.getItem("ado_pat_expiry")).toBeNull();
    });

    it("returns PAT when no expiry is set", () => {
      savePat("no-expiry-token");
      expect(getSavedPat()).toBe("no-expiry-token");
    });

    it("returns null when expiry is exactly now", () => {
      const now = new Date().toISOString();
      savePat("edge-token", now);
      // expiryDate <= new Date() should be true
      expect(getSavedPat()).toBeNull();
    });

    it("treats malformed expiry as no expiry and returns the PAT", () => {
      localStorage.setItem("ado_pat", "corrupt-expiry-token");
      localStorage.setItem("ado_pat_expiry", "not-a-valid-date");
      // new Date("not-a-valid-date") returns Invalid Date, which is NaN
      // NaN <= new Date() is false, so the PAT should be returned
      expect(getSavedPat()).toBe("corrupt-expiry-token");
    });
  });

  describe("clearPat", () => {
    it("removes PAT and expiry from storage", () => {
      savePat("to-be-cleared", new Date(Date.now() + 86400000).toISOString());
      clearPat();
      expect(getSavedPat()).toBeNull();
      expect(localStorage.getItem("ado_pat")).toBeNull();
      expect(localStorage.getItem("ado_pat_expiry")).toBeNull();
    });

    it("is a no-op when no PAT is saved", () => {
      clearPat(); // should not throw
      expect(getSavedPat()).toBeNull();
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
