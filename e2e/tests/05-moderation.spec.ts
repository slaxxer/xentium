import { test, expect } from "@playwright/test";
import { ADMIN, MEMBER, apiLogin, userId, uiLogin } from "./helpers";

/**
 * Moderation + admin account actions, all targeting member1 (who authored the
 * comment from 03-article). Ban, force-logout and password-reset are driven
 * through the ACP UI; warnings live in the ModCanvas so they are issued + read
 * via the admin API; the comment tombstone is asserted on the public reader.
 */

const WARN_REASON = "E2E warning: please follow the guidelines.";
const BAN_REASON = "E2E permanent ban.";
const DEL_REASON = "E2E removed for spam.";

test("admin warns a member (issued + listed via the moderation API)", async ({ request }) => {
  const token = await apiLogin(request, ADMIN.email, ADMIN.password);
  const auth = { Authorization: `Bearer ${token}` };
  const m1Id = await userId(request, MEMBER.username);

  const issued = await request.post("/api/admin/warnings", {
    headers: auth,
    data: { userId: m1Id, reason: WARN_REASON },
  });
  expect(issued.status()).toBe(201);

  const list = await (await request.get("/api/admin/warnings", { headers: auth })).json();
  const blob = JSON.stringify(list);
  expect(blob).toContain(WARN_REASON);
  expect(blob).toContain(m1Id);
});

test("admin bans a member via the ACP", async ({ page, request }) => {
  const token = await apiLogin(request, ADMIN.email, ADMIN.password);
  const m1Id = await userId(request, MEMBER.username);

  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto(`/admin/users/${m1Id}`);

  await page.getByRole("button", { name: "Ban", exact: true }).click();
  await page.locator(".acp-modal select").selectOption("permanent");
  await page.locator(".acp-modal textarea").fill(BAN_REASON);
  await page.getByRole("button", { name: "Issue Ban" }).click();

  await expect(page.locator(".acp-badge--danger").filter({ hasText: "Banned" })).toBeVisible({
    timeout: 15_000,
  });
});

test("admin force-logs-out and resets a member's password via the ACP", async ({ page, request }) => {
  const m1Id = await userId(request, MEMBER.username);

  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto(`/admin/users/${m1Id}`);

  // Reset password → confirm dialog → success toast.
  await page.getByRole("button", { name: "Reset Password" }).click();
  await page.locator(".swal2-confirm").click();
  await expect(page.locator(".swal2-toast")).toContainText("Password reset email sent", {
    timeout: 15_000,
  });

  // Force logout → confirm dialog → success toast.
  await page.getByRole("button", { name: "Log Out" }).click();
  await page.locator(".swal2-confirm").click();
  await expect(page.locator(".swal2-toast")).toContainText("Logged out", { timeout: 15_000 });
});

test("a moderator soft-deletes an article comment, showing a tombstone", async ({ page, request }) => {
  const token = await apiLogin(request, ADMIN.email, ADMIN.password);
  const auth = { Authorization: `Bearer ${token}` };

  // Locate the published article and member1's comment on it (from 03-article).
  const articles = await (await request.get("/api/articles?limit=20")).json();
  const article = articles.data[0];
  expect(article, "a published article must exist").toBeTruthy();

  const comments = await (await request.get(`/api/articles/${article.id}/comments`)).json();
  const comment =
    comments.data.find((c: { author: { username: string } }) => c.author.username === MEMBER.username) ??
    comments.data[0];
  expect(comment, "member1's comment must exist").toBeTruthy();

  const del = await request.delete(`/api/admin/comments/article/${comment.id}`, {
    headers: auth,
    data: { reason: DEL_REASON },
  });
  expect(del.ok()).toBeTruthy();

  // The reader renders a tombstone in place of the deleted comment (§33).
  await page.goto(`/articles/${article.slug}`);
  const tombstone = page.locator(".ard__comment-tombstone");
  await expect(tombstone).toBeVisible({ timeout: 15_000 });
  await expect(tombstone).toContainText(`deleted by ${ADMIN.username}`);
  await expect(tombstone).toContainText(DEL_REASON);
});
