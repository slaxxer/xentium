// @vitest-environment jsdom
/**
 * The masthead's sign-in dropdown: it opens under the button, a wrong password marks
 * the fields in place, a good one signs in WITHOUT leaving the page, and Escape closes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const post = vi.fn();
const applyLogin = vi.fn(async (_token: string) => {});

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
vi.mock("../../../lib/api", () => ({
  api: {
    get: async (path: string) => {
      if (path === "/auth/methods") return { passkeys: false, magicLink: true, providers: [] };
      if (path === "/auth/doorway") return { siteName: "Probe", tagline: "", members: 1, online: 1, joinedThisWeek: 0, recent: [] };
      if (path === "/auth/registration-status") return { open: true, mode: "open", inviteRequired: false };
      if (path === "/site/config") return { auth: { loginMethod: "email" } };
      return {};
    },
    post: (...a: unknown[]) => post(...a),
  },
}));
vi.mock("../../../hooks/useAuth", () => ({ applyLogin: (t: string) => applyLogin(t) }));

const { SignInMenu } = await import("./SignInMenu");

function Where() { return <span data-testid="where">{useLocation().pathname}</span>; }

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/forum/thread-1"]}>
        <Routes><Route path="*" element={<><SignInMenu className="pub-nav__login-btn" /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const open = () => fireEvent.click(screen.getByRole("button", { name: /door.tabs.signIn/ }));
const fill = () => {
  fireEvent.change(document.querySelector(".dw-pop input[type=email]")!, { target: { value: "a@b.test" } });
  fireEvent.change(document.querySelector(".dw-pop input[type=password]")!, { target: { value: "secret-123" } });
  fireEvent.submit(document.querySelector(".dw-pop form")!);
};

beforeEach(() => { post.mockReset(); applyLogin.mockClear(); });
afterEach(cleanup);

describe("the masthead sign-in dropdown", () => {
  it("opens a sign-in form under the button", async () => {
    setup();
    open();
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("door.menu.sub")).toBeTruthy();
  });

  it("marks both fields on a wrong password and stays open", async () => {
    post.mockRejectedValueOnce({ detail: { error: { code: "XEC-AUTH-1001" } } });
    setup();
    open();
    await screen.findByRole("dialog");
    fill();
    await screen.findByText("door.err.invalid");
    expect(document.querySelectorAll(".dw-pop .dw-input.is-invalid")).toHaveLength(2);
  });

  it("signs in and closes, without leaving the page", async () => {
    post.mockResolvedValueOnce({ accessToken: "tok" });
    setup();
    open();
    await screen.findByRole("dialog");
    fill();
    await waitFor(() => expect(applyLogin).toHaveBeenCalledWith("tok"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("where").textContent).toBe("/forum/thread-1");
  });

  it("closes on Escape", async () => {
    setup();
    open();
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
