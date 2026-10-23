import { test, expect } from "@playwright/test";
import { ADMIN, MEMBER, apiLogin, userId, uiLogin } from "./helpers";

/**
 * Moderation + admin account actions, all targeting member1 (who authored the
 * comment from 03-article). Ban, sign-out-everywhere and password reset are
 * driven through the ACP UI; warnings are issued + read via the admin API; a
 * removed comment must be gone from the public reader.
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
  const m1Id = await userId(request, MEMBER.username);

  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto(`/admin/users/${m1Id}`);

  await page.getByRole("button", { name: /^Ban…/ }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "Permanent" }).click();
  await modal.locator("textarea").fill(BAN_REASON);
  await modal.getByRole("button", { name: "Issue ban" }).click();

  await expect(page.getByText(/Banned/).first()).toBeVisible({ timeout: 15_000 });
});

test("admin force-logs-out and resets a member's password via the ACP", async ({ page, request }) => {
  const m1Id = await userId(request, MEMBER.username);

  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto(`/admin/users/${m1Id}`);

  // Reset password → confirm dialog → success toast.
  await page.getByRole("button", { name: /^Reset Password/ }).click();
  await page.locator(".xt-dialog").getByRole("button", { name: "Send Email" }).click();
  await expect(page.locator(".xt-toast").filter({ hasText: "Password reset email sent" })).toBeVisible({ timeout: 15_000 });

  // Sign out everywhere → confirm dialog → success toast.
  await page.getByRole("button", { name: /^Sign out everywhere/ }).click();
  await page.locator(".xt-dialog").getByRole("button", { name: "Log Out" }).click();
  await expect(page.locator(".xt-toast").filter({ hasText: "Logged out" })).toBeVisible({ timeout: 15_000 });
});

test("a moderator removes an article comment, and it leaves the page", async ({ page, request }) => {
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

  // A removed comment leaves the list entirely (no tombstone), on the page and in the API.
  const after = await (await request.get(`/api/articles/${article.id}/comments`)).json();
  expect(after.data.some((c: { id: string }) => c.id === comment.id)).toBeFalsy();
  await page.goto(`/articles/${article.slug}`);
  await expect(page.locator(".ard__comments")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`#comment-${comment.id}`)).toHaveCount(0);
});
