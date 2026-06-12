import express, {type Express} from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import path from 'node:path';
import { env, isProd } from '../config/env.js';
import { errorMiddleware } from '../shared/errors/errorMiddleware.js';
import { NodevoError } from '../shared/errors/NodevoError.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { installGuard } from "../shared/middleware/installGuard.js";
import { usersRouter } from '../modules/users/users.routes.js';
import { accountRouter } from '../modules/account/account.routes.js';
import { installerRouter } from "../modules/installer/installer.routes.js";
import { articlesRouter, articleCommentsRouter } from "../modules/articles/article.routes.js";
import { articleCategoriesRouter } from "../modules/article-categories/article-category.routes.js";
import { adminRouter } from "../modules/admin/admin.routes.js";
import { notificationRouter } from "../modules/notifications/notification.routes.js";
import { onlineRouter }       from "../modules/online/online.routes.js";
import { membersRouter }      from "../modules/members/members.routes.js";
import { homeRouter }         from "../modules/home/home.routes.js";
import { searchRouter }       from "../modules/search/search.routes.js";
import { optionalAuth }       from "../shared/middleware/optionalAuth.js";
import { inviteRouter }            from "../modules/invite/invite.routes.js";
import { betaPublicRouter, betaAdminRouter } from "../modules/beta/beta.routes.js";
import { moderationRouter }       from "../modules/moderation/moderation.routes.js";
import { appearanceRouter }        from "../modules/appearance/appearance.routes.js";
import { pluginManagementRouter }  from "../modules/plugins/plugin.routes.js";
import { pluginRouter }            from "../core/plugin-engine/plugin-router.js";
import { extractedDir } from "../core/plugin-engine/plugin-engine.js";
import { prisma } from "../infrastructure/db.js";
import { globalApiLimiter } from "../shared/middleware/rateLimit.js";

const ALLOWED_UPLOAD_DIRS = ['avatars', 'articles', 'groups', 'forum-attachments', path.join('themes', 'logo')];

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
    if (rel.includes('..')) return next(NodevoError.notFound());
    const ok = ALLOWED_UPLOAD_DIRS.some(
      (d) => rel === d || rel.startsWith(d + '/') || rel.startsWith(d + path.sep),
    );
    if (!ok) return next(NodevoError.notFound());
    next();
  });

  app.use('/uploads', express.static(path.resolve(env.UPLOAD_DIR), {
    setHeaders: (res, filePath) => {
      // Forum attachments are uploadable by any authenticated member and the
      // stored MIME/extension is not magic-byte-verified, so they must never be
      // rendered inline as active content. Force download + block sniffing so a
      // .html/.svg attachment can't execute as same-origin HTML (stored XSS).
      if (filePath.split(path.sep).join('/').includes('/forum-attachments/')) {
        res.setHeader('Content-Disposition', 'attachment');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      }
    },
  }));

  // 4. Install guard + routes
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), env: env.NODE_ENV });
  });

  // Public — frontend uses this to decide which plugin JS bundles to activate
  app.get('/api/meta/enabled-plugins', async (_req, res) => {
    try {
      const plugins = await prisma.installedPlugin.findMany({
        where:  { status: 'enabled' },
        select: { id: true },
      });
      res.json(plugins.map((p) => p.id));
    } catch {
      res.json([]);
    }
  });

  // Public — serves an enabled plugin's compiled web bundle (runtime UI loading).
  // The host loads this via <script> after setting window.__NODEVO_HOST__.
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
      res.sendFile(resolved, (err) => { if (err && !res.headersSent) res.status(404).end(); });
    } catch {
      if (!res.headersSent) res.status(404).end();
    }
  });

  app.use(installGuard);

  app.use("/api/install", installerRouter);

  app.use("/api/auth", authRouter);

  app.use("/api/users/", usersRouter);
  app.use("/api/account", accountRouter);
  app.use("/api/articles", articlesRouter);
  app.use("/api/article-comments", articleCommentsRouter);
  app.use("/api/article-categories", articleCategoriesRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/notifications", notificationRouter);
  app.use("/api/online",        onlineRouter);
  app.use("/api/members",       membersRouter);
  app.use("/api/home",          homeRouter);
  app.use("/api/search", optionalAuth, searchRouter);
  app.use("/api/admin/invites",    inviteRouter);
  app.use("/api/beta",             betaPublicRouter);
  app.use("/api/moderation",       moderationRouter);
  app.use("/api/appearance",       appearanceRouter);
  app.use("/api/plugins",          pluginManagementRouter);

  // Plugin runtime routes — /api/p/:pluginId/...
  pluginRouter.mount(app);
  app.use("/api/admin/beta-codes", betaAdminRouter);
  // beta-log is also served under the same admin router (/log sub-route)

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
        },
      });
      res.json(items);
    } catch (err) {
      next(err);
    }
  });

  // 5. 404 + error middleware LAST
  app.use((_req, _res, next) => next(NodevoError.notFound()));
  app.use(errorMiddleware);

  return app;
}
