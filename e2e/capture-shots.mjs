/**
 * Capture the storefront gallery images for the five official plugins.
 *
 * Not a test and not part of the suite: it drives a real logged-in browser over
 * the dev instance and writes PNGs next to each plugin's `assets/`, which is
 * where `manifest.screenshots` points and the packager reads from.
 *
 *   node capture-shots.mjs            (from e2e/, with the dev stack up)
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = "http://localhost:5173";
const API  = "http://localhost:4000/api";
const ROOT = path.resolve(import.meta.dirname, "../plugins/official");
const PW   = "devpassword123";

// 16:10 — the aspect ratio of the storefront's gallery frame. Matching it means
// the picture fills the frame instead of letterboxing inside it.
const VIEWPORT = { width: 1440, height: 900 };

async function api(pathname, body) {
  const res = await fetch(API + pathname, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${pathname} → ${res.status}`);
  return res.json();
}

/** Sign the page's own browser context in, so the app boots authenticated. */
async function signIn(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async ([e, p]) => {
    await fetch("/api/auth/login", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: e, password: p }),
    });
  }, [email, PW]);
}

async function signOut(page) {
  await page.context().clearCookies();
}

const conversations = async () => {
  const tok = (await api("/auth/login", { email: "mara@xentium.test", password: PW })).accessToken;
  const res = await fetch(`${API}/p/xentium-messaging/conversations`, {
    headers: { authorization: `Bearer ${tok}` },
  });
  return res.json();
};

// plugin id, file name, who (null = signed out), url, scrollY, text of a tab to
// click first. The tabs are local component state, not a query parameter, so a
// second view of the same page has to be reached the way a person reaches it.
const SHOTS = [
  ["xentium-forum",     "forum-index.png",  "mara@xentium.test",  "/forum", 250],
  ["xentium-forum",     "forum-thread.png", "mara@xentium.test",  "/forum/thread/xentium-1-0-is-out", 170],
  ["xentium-messaging", "messages-list.png","mara@xentium.test",  "/messages", 170],
  ["xentium-messaging", "conversation.png", "mara@xentium.test",  null, 170],   // filled in below
  ["xentium-shoutbox",  "shoutbox-home.png","mara@xentium.test",  "/", 250],
  ["xentium-shoutbox",  "shoutbox-acp.png", "admin@xentium.test", "/admin/shoutbox", 0],
  ["xentium-advanced-moderation", "advmod-acp.png", "admin@xentium.test", "/admin/advmod", 0],
  ["xentium-advanced-moderation", "advmod-detection.png", "admin@xentium.test", "/admin/advmod", 0, "Detection"],
  ["xentium-launch",    "launch-landing.png", null,               "/launch", 0],
  // The funnel below the hero, not the ACP form: what a buyer is shopping for is
  // the page their visitors will see.
  ["xentium-launch",    "launch-perks.png", null,                 "/launch", 900],
];

const convos = await conversations();
const convoId = convos[0]?.id;
if (convoId) {
  const row = SHOTS.find((s) => s[1] === "conversation.png");
  row[3] = `/messages/${convoId}`;
}

// No Playwright browser is downloaded on this box; the system Chrome is right
// there and this is a local capture, not a cross-browser test.
const browser = await chromium.launch({ channel: "chrome" });
// One theme across the whole set. A gallery that alternates light and dark
// reads as a mistake, and a fresh context follows the host's prefers-color-scheme
// — which is light in headless and dark on the machine that took the first pass.
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: "dark" });
const page = await ctx.newPage();

let current = "";
for (const [pluginId, file, who, url, scrollY, tab] of SHOTS) {
  if (!url) { console.log(`skip  ${file} — no url`); continue; }

  if (who !== current) {
    if (who) await signIn(page, who); else await signOut(page);
    current = who;
  }

  // NOT `networkidle`: the appearance live-sync stream never goes idle, so the
  // page would time out waiting for silence that by design never comes.
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  if (tab) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.waitForTimeout(1500);
  }
  if (scrollY) {
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await page.waitForTimeout(600);
  }

  const dir = path.join(ROOT, pluginId, "assets");
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, file);
  await page.screenshot({ path: out });
  console.log(`ok    ${pluginId}/${file}  ← ${url}`);
}

await browser.close();
