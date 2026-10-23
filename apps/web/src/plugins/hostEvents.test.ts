import { describe, expect, it, vi } from "vitest";
import { hostEvents } from "./hostEvents";
import { authStore } from "../lib/authStore";

describe("host events", () => {
  it("calls listeners until they unsubscribe, and survives one that throws", () => {
    const fn = vi.fn();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    hostEvents.on("route.changed", () => { throw new Error("x"); });
    const off = hostEvents.on("route.changed", fn);
    hostEvents.emit("route.changed", { path: "/a", search: "" });
    off();
    hostEvents.emit("route.changed", { path: "/b", search: "" });
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith({ path: "/a", search: "" });
    err.mockRestore();
  });

  it("announces sign-in changes once per member, not per token refresh", () => {
    const fn = vi.fn();
    hostEvents.on("auth.changed", fn);
    const user = { id: "u1" } as never;
    authStore.set("t1", user);
    authStore.set("t2", user);
    authStore.clear();
    expect(fn.mock.calls.map((c) => c[0])).toEqual([{ userId: "u1" }, { userId: null }]);
  });
});
