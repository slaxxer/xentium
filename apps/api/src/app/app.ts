import express, {type Express} from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import path from 'node:path';
import { env, isProd } from '../config/env.js';
import { XENTIUM_VERSION } from '../config/version.js';
import { errorMiddleware } from '../shared/errors/errorMiddleware.js';
import { XentiumError } from '../shared/errors/XentiumError.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { installGuard } from "../shared/middleware/installGuard.js";
import { usersRouter } from '../modules/users/users.routes.js';
import { accountRouter } from '../modules/account/account.routes.js';
import { installerRouter } from "../modules/installer/installer.routes.js";
import { articlesRouter, articleCommentsRouter } from "../modules/articles/article.routes.js";
import { articleCategoriesRouter } from "../modules/article-categories/article-category.routes.js";
import { legalRouter, legalAdminRouter } from "../modules/legal/legal.routes.js";
import { emojiRouter, emojiAdminRouter } from "../modules/emojis/emojis.routes.js";
import { siteRouter } from "../modules/site/site.routes.js";
import { themePublicRouter } from "../modules/themes/themePublic.routes.js";
import { badgesAdminRouter, badgesPublicRouter } from "../modules/badges/badges.routes.js";
import { siteService, type FeatureKey } from "../modules/site/site.service.js";
import { requireFeature } from "../shared/middleware/requireFeature.js";
import { maintenanceRouter } from "../modules/maintenance/maintenance.routes.js";
import { maintenanceGuard } from "../shared/middleware/maintenanceGuard.js";
import { activityRouter, activityAdminRouter } from "../modules/activity/activity.routes.js";
import { acpActivityLogger } from "../shared/middleware/acpActivityLogger.js";
import { adminRouter } from "../modules/admin/admin.routes.js";
import { notificationRouter } from "../modules/notifications/notification.routes.js";
import { onlineRouter }       from "../modules/online/online.routes.js";
import { membersRouter }      from "../modules/members/members.routes.js";
import { homeRouter }         from "../modules/home/home.routes.js";
import { searchRouter }       from "../modules/search/search.routes.js";
import { optionalAuth }       from "../shared/middleware/optionalAuth.js";
import { inviteRouter }            from "../modules/invite/invite.routes.js";
import { moderationRouter }       from "../modules/moderation/moderation.routes.js";
import { appearanceRouter }        from "../modules/appearance/appearance.routes.js";
import { publicLayoutRouter }      from "../modules/layouts/layout.routes.js";
import { pluginManagementRouter }  from "../modules/plugins/plugin.routes.js";
import { pluginRouter }            from "../core/plugin-engine/plugin-router.js";
import { extractedDir } from "../core/plugin-engine/plugin-engine.js";
import { prisma } from "../infrastructure/db.js";
import { globalApiLimiter } from "../shared/middleware/rateLimit.js";
import { mountWebApp } from "./serveWeb.js";

const ALLOWED_UPLOAD_DIRS = ['avatars', 'covers', 'articles', 'pages', 'groups', 'forum-attachments', 'themes', 'layouts', 'emojis'];

export function createApp(): Express {
  const app = express();

  // 1. CRITICAL: first, before any middleware (correct client IPs behind a proxy).
  app.set('trust proxy', 1);

  // 2. Security + parsing
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  app.use(cors({
    origin: isProd ? env.APP_URL : 'http://localhost:5173',
    credentials: true,
  }));

  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser(env.COOKIE_SECRET));
  app.use(pinoHttp({ transport: isProd ? undefined : { target: 'pino-pretty' } }));

  // Coarse per-IP API limiter (§26). Prod-only; installer/health/meta exempt.
  app.use(globalApiLimiter);

  // 3. Static uploads — allowlisted subdirs only. Match the FULL relative prefix
  //    (not just the first path segment) so `themes/logo` does not also expose
  //    other `themes/*` dirs (e.g. private `themes/packs`).
  app.use('/uploads', (req, res, next) => {
    const rel = path.normalize(req.path).replace(/^[/\\]+/, '');
    if (rel.includes('..')) return next(XentiumError.notFound());
    const ok = ALLOWED_UPLOAD_DIRS.some(
      (d) => rel === d || rel.startsWith(d + '/') || rel.startsWith(d + path.sep),
    );
    if (!ok) return next(XentiumError.notFound());
    next();
  });

  app.use('/uploads', express.static(path.resolve(env.UPLOAD_DIR), {
    setHeaders: (res, filePath) => {
      // Forum attachments are uploadable by any authenticated member and the
      // stored MIME/extension is not magic-byte-verified, so they must never be
      // rendered inline as active content. Force download + block sniffing so a
      // .html/.svg attachment can't execute as same-origin HTML (stored XSS).
      const rel = filePath.split(path.sep).join('/');
      if (rel.includes('/forum-attachments/')) {
        res.setHeader('Content-Disposition', 'attachment');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      }
      // Theme assets arrive inside an imported .xttheme — an untrusted archive. Their
      // type IS magic-byte-verified on import, but SVG has no magic bytes and can carry
      // script, so navigating straight to one must not execute it. No attachment
      // disposition here: unlike an attachment these have to render in <img> and CSS
      // url(), which the sandbox CSP does not prevent.
      if (rel.includes('/themes/')) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      }
    },
  }));

  // 4. Install guard + routes
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: XENTIUM_VERSION, uptime: process.uptime(), env: env.NODE_ENV });
  });

  // Public — frontend uses this to decide which plugin JS bundles to activate
  app.get('/api/meta/enabled-plugins', async (_req, res) => {
    try {
      const plugins = await prisma.installedPlugin.findMany({
        where:  { status: 'enabled' },
        select: { id: true, installedVersion: true },
      });
      // { id, version } — the frontend cache-busts the web bundle URL by version
      // so a plugin update is always fetched fresh (injected <script> requests
      // otherwise hit the browser HTTP cache, serving the previous bundle).
      res.json(plugins.map((p) => ({ id: p.id, version: p.installedVersion })));
    } catch {
      res.json([]);
    }
  });

  // Public — the site default language (§60.3 resolution chain). Visitors with
  // no explicit language choice (no xt_locale cookie, no account preference)
  // render the UI in this locale. Pre-install / unset → null and clients keep
  // their local detection.
  app.get('/api/meta/site-locale', async (_req, res) => {
    try {
      const row = await prisma.setting.findUnique({ where: { key: 'site.locale' } });
      res.json({ locale: typeof row?.value === 'string' ? row.value : null });
    } catch {
      res.json({ locale: null });
    }
  });

  // Public — serves an enabled plugin's compiled web bundle (runtime UI loading).
  // The host loads this via <script> after setting window.__XENTIUM_HOST__.
  app.get('/api/meta/plugin-web/:pluginId', async (req, res) => {
    try {
      const pluginId = req.params.pluginId;
      if (!/^[a-z0-9-]+$/.test(pluginId)) return res.status(400).end();

      const record = await prisma.installedPlugin.findUnique({ where: { id: pluginId } });
      if (!record || record.status !== 'enabled') return res.status(404).end();

      const webEntry = (record.manifest as { entrypoints?: { web?: string } } | null)?.entrypoints?.web;
      if (!webEntry) return res.status(404).end();

      const base     = path.resolve(extractedDir(pluginId));
      const resolved = path.resolve(base, webEntry);
      if (resolved !== base && !resolved.startsWith(base + path.sep)) return res.status(400).end();

      res.type('application/javascript');
      // Always revalidate: the URL is cache-busted by ?v=<version>, but even for
      // the same version we never want a hard-cached stale bundle. ETag/304 keeps
      // revalidation cheap when unchanged.
      res.set('Cache-Control', 'no-cache');
      res.sendFile(resolved, { cacheControl: false }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
    } catch {
      if (!res.headersSent) res.status(404).end();
    }
  });

  // Serve the built SPA (prod) BEFORE installGuard so the installer page + its
  // assets load on a fresh instance. Injects per-request SEO meta from settings;
  // self-skips in dev (no build → Vite owns the frontend). Skips /api + /uploads.
  mountWebApp(app);

  app.use(installGuard);
  app.use(maintenanceGuard);

  app.use("/api/install", installerRouter);

  app.use("/api/auth", authRouter);
  app.use("/api/maintenance", maintenanceRouter);

  app.use("/api/users/", usersRouter);
  app.use("/api/account", accountRouter);
  app.use("/api/articles", requireFeature("articles"), articlesRouter);
  app.use("/api/article-comments", requireFeature("articles"), articleCommentsRouter);
  app.use("/api/article-categories", requireFeature("articles"), articleCategoriesRouter);
  app.use("/api/legal", legalRouter);
  app.use("/api/emojis", emojiRouter);
  // ACP action logging wraps every /api/admin/* router below it.
  app.use("/api/admin", acpActivityLogger);
  app.use("/api/admin", adminRouter);
  app.use("/api/admin/activity", activityAdminRouter);
  app.use("/api/admin/legal", legalAdminRouter);
  app.use("/api/admin/emojis", emojiAdminRouter);
  app.use("/api/admin/badges", badgesAdminRouter);
  app.use("/api/notifications", notificationRouter);
  app.use("/api/online",        onlineRouter);
  app.use("/api/activity",      activityRouter);
  // Public: which installed themes a reader may choose between. NOT under
  // `/api/admin` — see `themePublic.routes.ts`.
  app.use("/api/themes",        themePublicRouter);
  // Public: the badges a user holds, and the batch a page of user cards reads.
  // Unauthenticated — an award is on show, and every card drawing it is public.
  app.use("/api/user-badges",   badgesPublicRouter);
  app.use("/api/site",          siteRouter);
  app.use("/api/members",       membersRouter);
  app.use("/api/home",          homeRouter);
  app.use("/api/search", optionalAuth, searchRouter);
  app.use("/api/admin/invites",    inviteRouter);
  app.use("/api/moderation",       moderationRouter);
  app.use("/api/appearance",       appearanceRouter);
  // Published page structure (ADR-0005). Public and unauthenticated: layouts are
  // global, and every block resolves its data through endpoints that apply their
  // own permission checks.
  app.use("/api/layouts",          publicLayoutRouter);
  app.use("/api/plugins",          pluginManagementRouter);

  // Plugin runtime routes — /api/p/:pluginId/...
  pluginRouter.mount(app);

  // Public nav items — returns active items ordered by position.
  // Visibility filtering (members/groups) is handled client-side against auth state.
  app.get("/api/nav-items", async (_req, res, next) => {
    try {
      const items = await prisma.navItem.findMany({
        where: { isActive: true },
        orderBy: { position: "asc" },
        select: {
          id: true, label: true, url: true, position: true,
          isActive: true, isSystem: true, openInNewTab: true, visibility: true,
          placement: true,
        },
      });
      // Hide core section links whose feature flag is off (Home/Articles/Members).
      const config = await siteService.getConfig();
      const urlFeature: Record<string, FeatureKey> = {
        "/": "home", "/articles": "articles", "/members": "members",
      };
      const visible = items.filter((i) => {
        const feature = urlFeature[i.url];
        return !feature || config.features[feature];
      });
      res.json(visible);
    } catch (err) {
      next(err);
    }
  });

  // 5. 404 + error middleware LAST
  app.use((_req, _res, next) => next(XentiumError.notFound()));
  app.use(errorMiddleware);

  return app;
}
