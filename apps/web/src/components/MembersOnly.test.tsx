// @vitest-environment jsdom
/**
 * Members-only pages and header widgets: a guest is sent to sign in (and back), a
 * member gets through, and nothing is decided while the session is still restoring —
 * or every reload would bounce a member to the sign-in page.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const auth = { isAuthenticated: false, isLoading: false };
vi.mock("../hooks/useAuth", () => ({ useAuth: () => auth }));
const { MembersOnly, MemberWidget } = await import("./MembersOnly");

function Where() { const l = useLocation(); return <span data-testid="where">{l.pathname + l.search}</span>; }

function page() {
  render(
    <MemoryRouter initialEntries={["/messages/42?x=1"]}>
      <Routes>
        <Route path="/messages/:id" element={<MembersOnly><span>inbox</span></MembersOnly>} />
        <Route path="/login" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => { cleanup(); auth.isAuthenticated = false; auth.isLoading = false; });

describe("MembersOnly", () => {
  it("sends a guest to sign in, coming back to the same page", () => {
    page();
    expect(screen.getByTestId("where").textContent).toBe(`/login?returnTo=${encodeURIComponent("/messages/42?x=1")}`);
  });

  it("lets a member in", () => {
    auth.isAuthenticated = true;
    page();
    expect(screen.getByText("inbox")).toBeTruthy();
  });

  it("decides nothing while the session is restoring", () => {
    auth.isLoading = true;
    page();
    expect(screen.queryByText("inbox")).toBeNull();
    expect(screen.queryByTestId("where")).toBeNull();
  });
});

describe("MemberWidget", () => {
  it("hides a header widget from guests and shows it to members", () => {
    const { rerender } = render(<MemberWidget><button>inbox</button></MemberWidget>);
    expect(screen.queryByText("inbox")).toBeNull();
    auth.isAuthenticated = true;
    rerender(<MemberWidget><button>inbox</button></MemberWidget>);
    expect(screen.getByText("inbox")).toBeTruthy();
  });
});
