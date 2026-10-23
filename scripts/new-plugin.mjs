#!/usr/bin/env node
/**
 * pnpm plugin:new <id> [--name "My Plugin"] [--vendor "You"] [--dir plugins/local]
 *
 * Starts a new plugin: a working one, built on core's plugin platform, ready to
 * build, package and install. It has
 *   - a table (migration) served as a RESOURCE: list, read, create, update, delete;
 *   - SETTINGS declared as a schema (core draws the ACP page);
 *   - a background JOB on a schedule, and an EVENT listener;
 *   - a public page that lists and creates items, in the site's own look;
 *   - English strings, a test, and the build setup (server: tsup, web: vite).
 *
 * The guide is docs/plugin-platform.md. Generated plugins land in plugins/local/,
 * which git ignores: a plugin is its own project.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const id = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));

function die(msg) {
  console.error(`\n  ✗ ${msg}\n\n  Usage: pnpm plugin:new <id> [--name "My Plugin"] [--vendor "You"] [--dir plugins/local]\n`);
  process.exit(1);
}
if (!id) die("Name the plugin: an id like my-gallery (lowercase letters, digits, dashes).");
if (!/^[a-z][a-z0-9-]{1,40}$/.test(id) || id.endsWith("-")) die(`"${id}" is not a plugin id: lowercase letters, digits and dashes, starting with a letter.`);
if (/^xentium-/.test(id)) die(`"xentium-" is reserved for official plugins; pick your own name.`);

const words = id.split("-");
const name = flag("name", words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" "));
const vendor = flag("vendor", "Your name");
const dir = path.resolve(ROOT, flag("dir", "plugins/local"), id);
// Short and unique enough: initials + "_" (my-gallery → mg_), at least two letters.
const prefix = `${(words.length > 1 ? words.map((w) => w[0]).join("") : id.slice(0, 3)).replace(/[^a-z]/g, "") || "pl"}_`;
const ns = words.join("");             // translation namespace / permission domain
const table = `${prefix}items`;
const pageUrl = `/${id}`;
const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");

if (fs.existsSync(dir)) die(`${path.relative(ROOT, dir)} already exists.`);

const files = {
  "manifest.json": JSON.stringify({
    id, name, version: "1.0.0", vendor,
    minXentiumVersion: "1.0.0",
    licenseRequired: false,
    tablePrefix: prefix,
    permissions: [`${ns}.create`, `${ns}.manage`],
    migrations: [`001_${table}`],
    entrypoints: { server: "server/dist/index.js", web: "web/dist/index.umd.js" },
  }, null, 2) + "\n",

  "package.json": JSON.stringify({
    name: `@local/${id}`,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      build: "pnpm build:server && pnpm build:web",
      "build:server": "tsup",
      "build:web": "vite build",
      typecheck: "tsc -p tsconfig.server.json --noEmit && tsc -p web/tsconfig.json --noEmit",
      test: "vitest run",
    },
    dependencies: { "@xentium/plugin-sdk": "workspace:*", express: "catalog:", zod: "catalog:" },
    devDependencies: {
      "@types/express": "^5.0.6", "@types/node": "^24.19.2", "@vitejs/plugin-react": "catalog:",
      tsup: "^8.5.1", typescript: "catalog:", vite: "catalog:", vitest: "catalog:",
    },
    peerDependencies: {
      "@tanstack/react-query": "^5", "@types/react": "*", react: "^19.2.6",
      "react-i18next": "*", "react-router-dom": "^7",
    },
  }, null, 2) + "\n",

  "CHANGELOG.md": `# ${name}\n\n## 1.0.0\n\n- First version.\n`,

  [`migrations/001_${table}.up.sql`]: `-- ${name}: the items it keeps. Every table carries the prefix "${prefix}" (manifest.tablePrefix).
-- The columns are what core's resource endpoints expect: id, one per schema field,
-- the owner, created_at / updated_at, and deleted_at for soft delete.
CREATE TABLE ${table} (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  author_id   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX ${table}_created_idx ON ${table} (created_at DESC);
`,
  [`migrations/001_${table}.down.sql`]: `DROP TABLE IF EXISTS ${table};\n`,

  "server/index.ts": `import type { PluginDefinition } from "@xentium/plugin-sdk";
import { Router } from "express";

/**
 * ${name}. Built on core's plugin platform (docs/plugin-platform.md):
 * core serves the items, draws the settings page, runs the job and calls the
 * listener; this file only describes them.
 */
const plugin: PluginDefinition = {
  id: "${id}",

  async onEnable(ctx) {
    const { host } = ctx;
    const z = host.zod;

    await ctx.registerPermissions([
      { key: "${ns}.create", label: "Create ${name} items", domain: "${name}", defaults: ["member", "moderator", "supermod", "admin"] },
      { key: "${ns}.manage", label: "Manage every ${name} item", domain: "${name}", defaults: ["admin"] },
    ]);

    // Settings: core stores them and draws ACP → Extensions → ${name}.
    const settings = ctx.registerSettings({
      title: "${name}",
      schema: z.object({
        perPage: z.number().int().min(5).max(100).default(20)
          .meta({ title: "${ns}:settings.perPage", description: "${ns}:settings.perPageHint", public: true }),
        keepDeletedDays: z.number().int().min(1).max(365).default(30)
          .meta({ title: "${ns}:settings.keepDeleted", description: "${ns}:settings.keepDeletedHint" }),
      }),
    });

    // The items: core serves GET/POST /api/p/${id}/items and GET/PATCH/DELETE /items/:id.
    await ctx.registerResource({
      name: "items",
      table: "${table}",
      schema: z.object({
        title: z.string().trim().min(1).max(120),
        body: z.string().max(5000).default(""),
      }),
      owner: "author_id",
      softDelete: true,
      access: { read: "public", create: "${ns}.create", update: "own", delete: "own", manage: "${ns}.manage" },
      sort: ["title"],
      search: ["title", "body"],
    });

    // Your own routes answer first and sit beside the resource.
    const router = Router();
    router.get("/about", async (_req, res) => {
      const { perPage } = await settings.get();
      res.json({ name: "${name}", perPage, zone: await host.time.zone() });
    });
    ctx.registerRoutes(router);

    // Background work: once a day, in the worker, kept across restarts.
    ctx.registerJob({
      name: "purge-deleted",
      handler: async () => {
        const { keepDeletedDays } = await settings.get();
        await host.prisma.$executeRawUnsafe(
          "DELETE FROM ${table} WHERE deleted_at < now() - ($1 || ' days')::interval", String(keepDeletedDays));
      },
    });
    await host.jobs.every("purge-deleted", { cron: "15 3 * * *" });

    // Core's events: react to what happens on the site.
    ctx.on("user.registered", async ({ userId }) => {
      host.logger.info({ userId }, "${name}: a new member joined");
    });
  },
};

export default plugin;
`,

  "server/index.test.ts": `import { describe, expect, it } from "vitest";
import manifest from "../manifest.json" with { type: "json" };
import plugin from "./index.js";

describe("${name}", () => {
  it("has the manifest's id", () => {
    expect(plugin.id).toBe(manifest.id);
  });
});
`,

  "web/index.tsx": `import { slotRegistry } from "@web/plugins/slotRegistry";
import { registerPluginTranslations } from "@web/plugins/pluginI18n";
import en from "./locales/en/${ns}.json";
import { ItemsPage } from "./ItemsPage";

registerPluginTranslations({ en: { ${ns}: en } });

slotRegistry.registerPluginMeta({ pluginId: "${id}" });
slotRegistry.registerRoute({ path: "${pageUrl}", layout: "public", component: ItemsPage });
`,

  "web/ItemsPage.tsx": `import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@web/lib/api";
import { useAuth } from "@web/hooks/useAuth";
import { usePublicPluginSettings } from "@web/plugins/pluginSettings";
import { toast } from "@web/lib/toast";

interface Item { id: string; title: string; body: string; ownerId: string; createdAt: string }
interface Page { data: Item[]; meta: { total: number; page: number; totalPages: number } }

/** The list core serves for the "items" resource, and a form to add one. */
export function ItemsPage() {
  const { t } = useTranslation("${ns}");
  const { user } = useAuth();
  const qc = useQueryClient();
  const settings = usePublicPluginSettings<{ perPage: number }>("${id}");
  const perPage = settings.data?.perPage ?? 20;
  const items = useQuery<Page>({
    queryKey: ["${id}", "items", perPage],
    queryFn: () => api.get(\`/p/${id}/items?limit=\${perPage}\`),
  });
  const [title, setTitle] = useState("");
  const add = useMutation({
    mutationFn: () => api.post("/p/${id}/items", { title }),
    onSuccess: () => { setTitle(""); void qc.invalidateQueries({ queryKey: ["${id}"] }); toast.success(t("added")); },
    onError: () => toast.error(t("addFailed")),
  });

  return (
    <div style={{ maxWidth: "var(--content-max)", margin: "0 auto", padding: "var(--sp-6)" }}>
      <h1>{t("title")}</h1>
      {user && (
        <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }} style={{ display: "flex", gap: 8, margin: "16px 0" }}>
          <input className="inp" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={t("newPlaceholder")} />
          <button type="submit" className="btn-primary" disabled={add.isPending || !title.trim()}>{t("add")}</button>
        </form>
      )}
      {items.isLoading ? <p>{t("loading")}</p> : items.data?.data.length ? (
        <ul>{items.data.data.map((i) => <li key={i.id}>{i.title}</li>)}</ul>
      ) : <p>{t("empty")}</p>}
    </div>
  );
}
`,

  [`web/locales/en/${ns}.json`]: JSON.stringify({
    title: name, add: "Add", added: "Added.", addFailed: "Could not add it.", loading: "Loading…",
    empty: "Nothing here yet.", newPlaceholder: "Something new",
    settings: {
      perPage: "Items per page", perPageHint: "How many items the page lists at once.",
      keepDeleted: "Keep deleted items (days)", keepDeletedHint: "Deleted items can be restored until then.",
    },
  }, null, 2) + "\n",

  "web/globals.d.ts": `declare module "*.scss";\ndeclare module "*.css";\ndeclare module "*.svg";\n`,

  "web/tsconfig.json": JSON.stringify({
    compilerOptions: {
      jsx: "react-jsx", module: "ESNext", moduleResolution: "Bundler", target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"], strict: true, noEmit: true, skipLibCheck: true,
      esModuleInterop: true, resolveJsonModule: true, types: [],
      paths: { "@web/*": [path.relative(path.join(dir, "web"), path.join(ROOT, "apps/web/src")) + "/*"] },
    },
    include: ["."],
  }, null, 2) + "\n",

  "tsconfig.server.json": JSON.stringify({
    compilerOptions: {
      module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", lib: ["ES2023"], strict: true,
      noEmit: true, skipLibCheck: true, esModuleInterop: true, resolveJsonModule: true, types: ["node"],
    },
    include: ["server/**/*.ts", "tsup.config.ts"],
  }, null, 2) + "\n",

  "tsup.config.ts": `import { defineConfig } from "tsup";

// The server entry as one ESM file the site imports. express and zod come from
// the site's own node_modules; @xentium/plugin-sdk is types only.
export default defineConfig({
  entry: { index: "server/index.ts" },
  outDir: "server/dist",
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  splitting: false,
});
`,

  "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// The web entry as one script the site loads. Everything shared — React, the router,
// the query client, i18n and core's own modules (@web/*) — is the PAGE's copy, read
// from window.__XENTIUM_HOST__: never bundle a second React.
const H = "window.__XENTIUM_HOST__";
const externals: Record<string, string> = {
  "react": \`\${H}.React\`,
  "react/jsx-runtime": \`\${H}.ReactJsxRuntime\`,
  "react-router-dom": \`\${H}.ReactRouterDom\`,
  "@tanstack/react-query": \`\${H}.ReactQuery\`,
  "react-i18next": \`\${H}.ReactI18next\`,
  "@web/lib/api": \`\${H}.webApi\`,
  "@web/lib/toast": \`\${H}.webToast\`,
  "@web/lib/dialog": \`\${H}.webDialog\`,
  "@web/hooks/useAuth": \`\${H}.webUseAuth\`,
  "@web/plugins/slotRegistry": \`\${H}.webSlotRegistry\`,
  "@web/plugins/pluginI18n": \`\${H}.webPluginI18n\`,
  "@web/plugins/pluginSettings": \`\${H}.webPluginSettings\`,
  "@web/components/Uploader": \`\${H}.webUploader\`,
  "@web/components/AcpControls": \`\${H}.webAcpControls\`,
  "@web/components/Username": \`\${H}.webUsername\`,
  "@web/components/UserAvatar": \`\${H}.webUserAvatar\`,
  "@web/lib/datetime": \`\${H}.webDateTime\`,
};

export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "web/dist",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "web/index.tsx"),
      formats: ["iife"],
      name: "${pascal}Plugin",
      fileName: () => "index.umd.js",
    },
    rollupOptions: {
      external: Object.keys(externals),
      output: { globals: externals, extend: true },
    },
  },
});
`,
};

for (const [rel, content] of Object.entries(files)) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const shown = path.relative(ROOT, dir);
console.log(`
  ✓ ${name} is ready in ${shown}

    table prefix   ${prefix}
    page           ${pageUrl}
    API            /api/p/${id}/items · /api/p/${id}/about
    settings       ACP → Extensions → ${name}

  Next:
    pnpm install
    pnpm --filter @local/${id} build
    pnpm plugin:package ${shown}
    then upload the .xtplugin in ACP → Extensions → Installed, and enable it.

  The guide: docs/plugin-platform.md
`);
