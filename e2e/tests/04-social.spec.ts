import { test, expect } from "@playwright/test";
import { MEMBER, MEMBER2, apiLogin, apiRegister, userId, uiLogin } from "./helpers";

/**
 * Social graph flows between two members. member1 exists from 02-auth; member2
 * is registered via the API here. Follow + profile-wall are driven through the
 * UI; block and the private-follower-list privacy rule are asserted at the API
 * level (there is no block button on the profile page, and a private list
 * returns 403 which the UI intentionally renders as an empty list).
 */

test("member1 follows then unfollows member2", async ({ page, request }) => {
  await apiRegister(request, MEMBER2);

  await uiLogin(page, MEMBER.email, MEMBER.password);
  await page.goto(`/u/${MEMBER2.username}`);

  const btn = page.locator(".profile-follow-btn");
  await expect(btn).toHaveText("Follow");
  await btn.click();
  await expect(btn).toHaveText("Following");
  await btn.click();
  await expect(btn).toHaveText("Follow");
});

test("member1 posts on member2's wall", async ({ page, request }) => {
  await apiRegister(request, MEMBER2);

  await uiLogin(page, MEMBER.email, MEMBER.password);
  await page.goto(`/u/${MEMBER2.username}`);
  await page.getByRole("button", { name: "Wall" }).click();

  const msg = "Welcome to the community!";
  await page.locator(".profile-wall__composer.nvc--collapsed").click();
  await page.locator(".profile-wall .nvc-content").click();
  await page.keyboard.type(msg);
  await page.locator(".profile-wall").getByRole("button", { name: /^Post/ }).click();

  await expect(
    page.locator(".profile-wall__comment-text").filter({ hasText: msg }),
  ).toBeVisible({ timeout: 15_000 });
});

test("blocking a user removes the follow relationship", async ({ request }) => {
  await apiRegister(request, MEMBER2);
  const m1 = await apiLogin(request, MEMBER.email, MEMBER.password);
  const m1Id = await userId(request, MEMBER.username);
  const m2Id = await userId(request, MEMBER2.username);
  const auth = { Authorization: `Bearer ${m1}` };

  // Follow, confirm the relationship exists.
  await request.post(`/api/users/${m2Id}/follow`, { headers: auth });
  let following = await (await request.get(`/api/users/${m1Id}/following`)).json();
  expect(following.items.some((u: { id: string }) => u.id === m2Id)).toBeTruthy();

  // Block — the transaction must remove the follow in both directions.
  const blockRes = await request.post(`/api/users/${m2Id}/block`, { headers: auth });
  expect(blockRes.ok()).toBeTruthy();

  following = await (await request.get(`/api/users/${m1Id}/following`)).json();
  expect(following.items.some((u: { id: string }) => u.id === m2Id)).toBeFalsy();

  // The block is recorded.
  const blocks = await (await request.get(`/api/users/me/blocks`, { headers: auth })).json();
  expect(JSON.stringify(blocks)).toContain(m2Id);

  // Cleanup so later assertions aren't affected.
  await request.delete(`/api/users/${m2Id}/block`, { headers: auth });
});

test("a private follower list is hidden from non-owners (403)", async ({ request }) => {
  await apiRegister(request, MEMBER2);
  const m2 = await apiLogin(request, MEMBER2.email, MEMBER2.password);
  const m1 = await apiLogin(request, MEMBER.email, MEMBER.password);
  const m2Id = await userId(request, MEMBER2.username);

  // member2 makes their follower list private.
  const patch = await request.patch("/api/account/privacy", {
    headers: { Authorization: `Bearer ${m2}` },
    data: { showFollowersPublic: false },
  });
  expect(patch.ok()).toBeTruthy();

  // Another logged-in member is forbidden…
  const asOther = await request.get(`/api/users/${m2Id}/followers`, {
    headers: { Authorization: `Bearer ${m1}` },
  });
  expect(asOther.status()).toBe(403);

  // …but the owner can still see their own list.
  const asOwner = await request.get(`/api/users/${m2Id}/followers`, {
    headers: { Authorization: `Bearer ${m2}` },
  });
  expect(asOwner.ok()).toBeTruthy();

  // Restore the default so the suite stays re-runnable.
  await request.patch("/api/account/privacy", {
    headers: { Authorization: `Bearer ${m2}` },
    data: { showFollowersPublic: true },
  });
});
