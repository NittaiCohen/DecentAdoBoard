import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the Tauri invoke calls
vi.mock("../hooks/useAdoData", () => ({
  getWorkItemTypeStatesTauri: vi.fn().mockResolvedValue([
    { name: "New", color: "b2b2b2", category: "Proposed" },
    { name: "Active", color: "007acc", category: "InProgress" },
    { name: "Resolved", color: "339933", category: "Resolved" },
    { name: "Closed", color: "339933", category: "Completed" },
  ]),
  updateWorkItemStateTauri: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/storage", () => ({
  getSavedConfig: vi.fn().mockReturnValue({
    organization: "testorg",
    project: "testproj",
    areaPath: "testarea",
  }),
}));

import StateDropdown from "./StateDropdown";
import { getWorkItemTypeStatesTauri, updateWorkItemStateTauri } from "../hooks/useAdoData";

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("StateDropdown", () => {
  it("renders current state as a button", () => {
    render(
      createElement(StateDropdown, {
        workItemId: 1,
        workItemType: "Task",
        currentState: "Active",
      }),
      { wrapper: createWrapper() },
    );
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("opens dropdown on click and shows loading", async () => {
    render(
      createElement(StateDropdown, {
        workItemId: 1,
        workItemType: "Task",
        currentState: "Active",
      }),
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByText("Active"));

    // Should show loading or states
    await waitFor(() => {
      expect(getWorkItemTypeStatesTauri).toHaveBeenCalledWith("Task");
    });
  });

  it("shows available states after loading", async () => {
    render(
      createElement(StateDropdown, {
        workItemId: 1,
        workItemType: "Task",
        currentState: "Active",
      }),
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByText("Active"));

    await waitFor(() => {
      expect(screen.getByText("Resolved")).toBeTruthy();
    });
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
  });

  it("calls updateWorkItemStateTauri when selecting a state", async () => {
    render(
      createElement(StateDropdown, {
        workItemId: 42,
        workItemType: "Task",
        currentState: "Active",
      }),
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByText("Active"));

    await waitFor(() => {
      expect(screen.getByText("Resolved")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Resolved"));

    await waitFor(() => {
      expect(updateWorkItemStateTauri).toHaveBeenCalledWith(42, "Resolved");
    });
  });

  it("closes dropdown on Escape key", async () => {
    render(
      createElement(StateDropdown, {
        workItemId: 1,
        workItemType: "Task",
        currentState: "Active",
      }),
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByText("Active"));

    await waitFor(() => {
      expect(screen.getByText("Resolved")).toBeTruthy();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Resolved")).toBeNull();
    });
  });

  it("does not allow selecting the current state", async () => {
    const mockedUpdate = vi.mocked(updateWorkItemStateTauri);
    mockedUpdate.mockClear();

    render(
      createElement(StateDropdown, {
        workItemId: 1,
        workItemType: "Task",
        currentState: "Active",
      }),
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByText("Active"));

    await waitFor(() => {
      // There should be two "Active" elements - the button and the dropdown item
      const activeElements = screen.getAllByText("Active");
      expect(activeElements.length).toBeGreaterThanOrEqual(2);
    });

    // The dropdown item for Active should be disabled
    const activeElements = screen.getAllByText("Active");
    const dropdownItem = activeElements.find((el) => el.closest("button[disabled]"));
    expect(dropdownItem).toBeTruthy();
  });
});
