/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ColorInput } from "./ColorInput";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ColorInput", () => {
  it("follows a drag at once but hands it on at most every 100 ms, and the last colour always", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = render(<ColorInput value="#000000" onChange={onChange} aria-label="c" />);
    const input = container.querySelector("input")!;
    // Ten drag steps at once. A drag fires `input`; `change` comes when the picker closes.
    for (let i = 1; i <= 10; i++) fireEvent.input(input, { target: { value: `#0000${String(i).padStart(2, "0")}` } });
    expect(input.value).toBe("#000010");
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith("#000010");
  });

  it("sends the final colour when the picker closes", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = render(<ColorInput value="#000000" onChange={onChange} aria-label="c" />);
    const input = container.querySelector("input")!;
    fireEvent.input(input, { target: { value: "#111111" } });
    fireEvent.input(input, { target: { value: "#222222" } });
    input.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith("#222222");
  });

  it("shows a new value from outside", () => {
    const { container, rerender } = render(<ColorInput value="#000000" onChange={() => {}} aria-label="c" />);
    rerender(<ColorInput value="#abcdef" onChange={() => {}} aria-label="c" />);
    expect(container.querySelector("input")!.value).toBe("#abcdef");
  });
});
