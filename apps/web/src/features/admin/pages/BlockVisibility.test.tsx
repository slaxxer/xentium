/**
 * The audience control.
 *
 * @vitest-environment jsdom
 *
 * Two behaviours carry weight beyond the UI. Choosing "Everyone" must emit
 * `undefined`, not `{ audience: 'everyone' }` — absent and default mean the same
 * thing to the renderer, so storing the default would make two identical layouts
 * compare unequal, and draft-vs-live status is a `JSON.stringify`. And an empty
 * group list has to warn rather than be refused, because an admin picking "Specific
 * groups" is momentarily in exactly that state.
 */
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import type { BlockVisibility } from "@xentium/contracts";

const groupsFixture = [
  { id: "g-users", name: "Registered", key: "registered" },
  { id: "g-admin", name: "Administrators", key: "administrator" },
];

// Mocked so the control's own fetch is not what is under test.
vi.mock("../../../lib/api", () => ({
  api: { get: vi.fn(async () => groupsFixture) },
}));

const { BlockVisibilityFields } = await import("./BlockVisibility");

beforeAll(async () => {
  // Empty resources: `t` returns the key, which keeps assertions stable and keeps
  // react-i18next from warning about a missing instance.
  await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { acp: {} } } });
});

let onChange: (next: BlockVisibility | undefined) => void;

const renderFields = (value?: BlockVisibility) => {
  onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BlockVisibilityFields value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
};

const radio = (audience: string) =>
  document.querySelector(`input[type="radio"][value="${audience}"]`) as HTMLInputElement;

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe("audience selection", () => {
  it("defaults to everyone when nothing is stored", () => {
    renderFields(undefined);
    expect(radio("everyone").checked).toBe(true);
  });

  it("offers every audience", () => {
    renderFields(undefined);
    for (const a of ["everyone", "guests", "members", "groups"]) {
      expect(radio(a), a).toBeTruthy();
    }
  });

  it("reflects a stored audience", () => {
    renderFields({ audience: "members", groups: [] });
    expect(radio("members").checked).toBe(true);
    expect(radio("everyone").checked).toBe(false);
  });

  it("emits a rule when narrowing", () => {
    renderFields(undefined);
    fireEvent.click(radio("members"));
    expect(onChange).toHaveBeenCalledWith({ audience: "members", groups: [] });
  });

  it("emits undefined — not the default object — when widening back to everyone", () => {
    renderFields({ audience: "members", groups: [] });
    fireEvent.click(radio("everyone"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("keeps a chosen group list when switching away and back", () => {
    // The list is preserved on the value, so flipping to Members and back does not
    // silently discard the groups an admin picked.
    renderFields({ audience: "groups", groups: ["g-admin"] });
    fireEvent.click(radio("members"));
    expect(onChange).toHaveBeenCalledWith({ audience: "members", groups: ["g-admin"] });
  });
});

describe("group selection", () => {
  it("shows no group list unless the groups audience is chosen", () => {
    renderFields({ audience: "members", groups: [] });
    expect(document.querySelector(".lay__vis-groups")).toBeNull();
  });

  it("lists the site's groups by name", async () => {
    renderFields({ audience: "groups", groups: [] });
    await waitFor(() => expect(screen.getByText("Administrators")).toBeTruthy());
    expect(screen.getByText("Registered")).toBeTruthy();
  });

  it("checks the groups already selected", async () => {
    renderFields({ audience: "groups", groups: ["g-admin"] });
    await waitFor(() => expect(screen.getByText("Administrators")).toBeTruthy());
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, true]);
  });

  it("adds a group without dropping the others", async () => {
    renderFields({ audience: "groups", groups: ["g-users"] });
    await waitFor(() => expect(screen.getByText("Administrators")).toBeTruthy());
    fireEvent.click(screen.getByText("Administrators"));
    expect(onChange).toHaveBeenCalledWith({ audience: "groups", groups: ["g-users", "g-admin"] });
  });

  it("removes a selected group", async () => {
    renderFields({ audience: "groups", groups: ["g-users", "g-admin"] });
    await waitFor(() => expect(screen.getByText("Administrators")).toBeTruthy());
    fireEvent.click(screen.getByText("Administrators"));
    expect(onChange).toHaveBeenCalledWith({ audience: "groups", groups: ["g-users"] });
  });

  it("warns when the list is empty instead of refusing it", async () => {
    renderFields({ audience: "groups", groups: [] });
    await waitFor(() => expect(screen.getByText("layoutEditor.audienceNobody")).toBeTruthy());
  });

  it("drops the warning once a group is chosen", async () => {
    renderFields({ audience: "groups", groups: ["g-admin"] });
    await waitFor(() => expect(screen.getByText("Administrators")).toBeTruthy());
    expect(screen.queryByText("layoutEditor.audienceNobody")).toBeNull();
  });
});

describe("the hint that this is not access control", () => {
  it("is always shown", () => {
    // An admin will otherwise assume hiding a block protects its data. It does not
    // — the endpoint behind it does.
    renderFields(undefined);
    expect(screen.getByText("layoutEditor.audienceNote")).toBeTruthy();
  });
});
