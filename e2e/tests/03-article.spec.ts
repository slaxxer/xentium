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

  // Title, excerpt, and a body long enough for the publish checklist.
  await page.locator(".aed-title").fill(TITLE);
  await page.locator(".aed-excerpt").fill("A short excerpt for the listing.");
  await page.locator(".nvc-content").click();
  await page.keyboard.type("This end to end article body has clearly more than ten words in it.");

  // Details panel: category, one tag (Enter commits it), the featured image.
  await page.locator("select.aed-input").selectOption({ label: "General" });
  const tag = page.getByPlaceholder("Add a tag, then press Enter");
  await tag.fill("launch");
  await tag.press("Enter");
  await page.locator('aside input[type="file"]').setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: PNG_1x1 });

  // Publish opens once everything it needs is there; the reader opens on success.
  const publish = page.locator(".aed-btn--primary").first();
  await expect(publish).not.toHaveClass(/is-blocked/, { timeout: 20_000 });
  await publish.click();
  await page.waitForURL(/\/articles\/[^/]+$/, { timeout: 20_000 });
  await expect(page.locator(".ard__title")).toHaveText(TITLE);
  articleSlug = page.url().split("/articles/")[1]!.replace(/\/$/, "");
});

test("a member can comment on the published article", async ({ page }) => {
  expect(articleSlug, "article must have been published first").not.toBe("");

  await uiLogin(page, MEMBER.email, MEMBER.password);
  await page.goto(`/articles/${articleSlug}`);

  const comment = "Great write-up, thanks for sharing!";
  await page.locator(".ard__comments .nvc--collapsed").click();
  await page.locator(".ard__comments .nvc-content").click();
  await page.keyboard.type(comment);
  await page.getByRole("button", { name: "Post Comment" }).click();

  await expect(page.locator(".ard__comment-text").filter({ hasText: comment })).toBeVisible({
    timeout: 15_000,
  });
});
