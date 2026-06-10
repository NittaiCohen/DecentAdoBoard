import { renderHook } from "@testing-library/react";
import { useKeyDown } from "./useKeyDown";

function fireKey(
  key: string,
  options: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  document.dispatchEvent(event);
  return event;
}

describe("useKeyDown", () => {
  it("calls handler when key matches", () => {
    const handler = vi.fn();
    renderHook(() => useKeyDown("Escape", handler));

    fireKey("Escape");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not call handler for non-matching key", () => {
    const handler = vi.fn();
    renderHook(() => useKeyDown("Escape", handler));

    fireKey("Enter");
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not call handler when disabled", () => {
    const handler = vi.fn();
    renderHook(() => useKeyDown("Escape", handler, { enabled: false }));

    fireKey("Escape");
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports an array of plain string keys", () => {
    const handler = vi.fn();
    renderHook(() => useKeyDown(["=", "+"], handler));

    fireKey("=");
    fireKey("+");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("supports an object binding with modifiers", () => {
    const handler = vi.fn();
    renderHook(() => useKeyDown({ key: "z", modifiers: ["ctrl"] }, handler));

    fireKey("z");
    expect(handler).not.toHaveBeenCalled();

    fireKey("z", { ctrlKey: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("supports a mixed array of string and object bindings", () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyDown(
        [
          { key: "=", modifiers: ["ctrl"] },
          { key: "+", modifiers: ["ctrl"] },
        ],
        handler,
      ),
    );

    fireKey("=", { ctrlKey: true });
    fireKey("+", { ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(2);

    // Without ctrl, should not match
    fireKey("=");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("treats metaKey as ctrl when ctrl modifier is specified", () => {
    const handler = vi.fn();
    renderHook(() => useKeyDown({ key: "z", modifiers: ["ctrl"] }, handler));

    fireKey("z", { metaKey: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("requires all specified modifiers to be pressed", () => {
    const handler = vi.fn();
    renderHook(() => useKeyDown({ key: "z", modifiers: ["ctrl", "shift"] }, handler));

    fireKey("z", { ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();

    fireKey("z", { shiftKey: true });
    expect(handler).not.toHaveBeenCalled();

    fireKey("z", { ctrlKey: true, shiftKey: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("rejects extra modifiers not in the spec", () => {
    const handler = vi.fn();
    renderHook(() => useKeyDown("z", handler));

    fireKey("z", { shiftKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls preventDefault by default", () => {
    const handler = vi.fn();
    renderHook(() => useKeyDown("Escape", handler));

    const event = fireKey("Escape");
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not call preventDefault when option is false", () => {
    const handler = vi.fn();
    renderHook(() => useKeyDown("Escape", handler, { preventDefault: false }));

    const event = fireKey("Escape");
    expect(event.defaultPrevented).toBe(false);
  });

  it("cleans up listener on unmount", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useKeyDown("Escape", handler));

    unmount();
    fireKey("Escape");
    expect(handler).not.toHaveBeenCalled();
  });

  it("cleans up listener when enabled changes to false", () => {
    const handler = vi.fn();
    const { rerender } = renderHook(({ enabled }) => useKeyDown("Escape", handler, { enabled }), {
      initialProps: { enabled: true },
    });

    fireKey("Escape");
    expect(handler).toHaveBeenCalledOnce();

    rerender({ enabled: false });
    fireKey("Escape");
    expect(handler).toHaveBeenCalledOnce(); // no additional call
  });
});
