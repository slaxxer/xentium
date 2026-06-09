import { test, expect } from "@playwright/test";
import { ADMIN, MEMBER, PNG_1x1, apiLogin, uiLogin } from "./helpers";

/**
 * Article authoring + commenting. The admin creates and publishes an article
 * through the real editor (a category is provisioned via the admin API first,
 * since publishing requires one), then a member comments on it via the reader.
 *
 * The published slug is shared across the two tests in this file (serial run).
 */
let articleSlug = "";
const TITLE = `E2E Launch Notes ${Date.now()}`;

test("admin creates and publishes an article via the editor", async ({ page, request }) => {
  // Precondition: publishing requires a category. Create one as admin via API.
  const token = await apiLogin(request, ADMIN.email, ADMIN.password);
  const catRes = await request.post("/api/article-categories", {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: "General" },
  });
  expect(catRes.ok(), `category create: ${catRes.status()}`).toBeTruthy();

  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto("/articles/new");

  // Title, body (10+ words to satisfy the publish gate), excerpt.
  await page.locator(".aep__title-input").fill(TITLE);
  await page.locator(".article-editor__content").click();
  await page.keyboard.type(
    "This end to end article body has clearly more than ten words in it.",
  );
  await page.locator(".aep__excerpt-input").fill("A short excerpt for the listing.");

  // One tag (Enter commits it).
  await page.locator('.aep__input[placeholder="Add tag…"]').fill("launch");
  await page.locator('.aep__input[placeholder="Add tag…"]').press("Enter");

  // Category + featured image (the upload creates the draft).
  await page.locator(".aep__select").selectOption({ label: "General" });
  await page.locator('input[type="file"]').setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: PNG_1x1,
  });

  // Publish becomes enabled once all requirements are met.
  const publishBtn = page.locator(".aep__btn--primary");
  await expect(publishBtn).toBeEnabled({ timeout: 20_000 });
  await publishBtn.click();

  // Redirects to the reader on success.
  await page.waitForURL(/\/articles\/[^/]+$/, { timeout: 20_000 });
  await expect(page.locator(".ard__title")).toHaveText(TITLE);
  articleSlug = page.url().split("/articles/")[1]!.replace(/\/$/, "");
});

test("a member can comment on the published article", async ({ page }) => {
  expect(articleSlug, "article must have been published first").not.toBe("");

  await uiLogin(page, MEMBER.email, MEMBER.password);
  await page.goto(`/articles/${articleSlug}`);

  const comment = "Great write-up — thanks for sharing!";
  await page.locator(".mini-editor__content").click();
  await page.keyboard.type(comment);
  await page.getByRole("button", { name: "Post Comment" }).click();

  await expect(page.locator(".ard__comment-text").filter({ hasText: comment })).toBeVisible({
    timeout: 15_000,
  });
});
