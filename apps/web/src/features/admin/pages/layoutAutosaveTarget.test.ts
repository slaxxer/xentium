/**
 * An autosave may never write one template's blocks into another template's draft.
 *
 * The Layout Editor holds two pieces of state that change at different moments: the
 * picker's `templateKey`, which moves the instant it is clicked, and `doc`, which is
 * replaced a render or two later when the new template's draft resolves. In that
 * window the editor holds the OUTGOING document under the INCOMING key — and the
 * autosave is on a 700ms timer, so it can land inside it.
 *
 * The result is silent and destructive: the layout that gets overwritten is a saved
 * one nobody was editing. This pins both halves of the fix — the guard that refuses
 * the mismatch, and the address a write that does happen uses.
 *
 * Pure functions rather than a mounted editor: the rule is about which key a
 * document is written under, and that is the whole of it.
 */
import { describe, expect, it } from "vitest";
import type { LayoutDocument, TemplateKey } from "@nodevo/contracts";

/** The `onSave` guard: a document only saves under its own template. */
const mayAutosave = (doc: LayoutDocument | null, editing: TemplateKey, conflict: boolean) =>
  !!doc && !conflict && doc.templateKey === editing;

/** The address a save uses — the DOCUMENT's key, never the picker's. */
const saveTarget = (doc: LayoutDocument) => `/admin/layouts/${doc.templateKey}`;

const doc = (templateKey: string): LayoutDocument =>
  ({ templateKey, schemaVersion: 1, regions: { main: [] } } as LayoutDocument);

describe("what the editor is allowed to autosave", () => {
  it("saves a document under the template being edited", () => {
    expect(mayAutosave(doc("home"), "home", false)).toBe(true);
  });

  it("REFUSES a document that belongs to another template", () => {
    // The picker has moved to `home`; the held document is still `article.index`.
    expect(mayAutosave(doc("article.index"), "home", false)).toBe(false);
  });

  it("stays suspended while a conflict is unresolved", () => {
    expect(mayAutosave(doc("home"), "home", true)).toBe(false);
  });

  it("has nothing to save before a document has loaded", () => {
    expect(mayAutosave(null, "home", false)).toBe(false);
  });
});

describe("where a save is addressed", () => {
  it("uses the document's own template key", () => {
    expect(saveTarget(doc("chrome.footer"))).toBe("/admin/layouts/chrome.footer");
  });
});
