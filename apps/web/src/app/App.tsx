import i18n from "i18next";
import { LegalConsentGate } from "../features/auth/LegalConsentGate";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RouterProvider, createBrowserRouter, Outlet, Navigate, useLocation } from "react-router-dom";
import { ToastHost } from "../components/ToastHost";
import { DialogHost } from "../components/DialogHost";
import { AppLayout } from "../layouts/AppLayout";
import { RequireSignIn } from "../layouts/RequireSignIn";
import { ProfilePage } from "../features/profiles/ProfilePage";
import { MembersPage } from "../features/members/MembersPage";
import { AccountPage } from "../features/account/AccountPage";
import { SignInPanel } from "../features/auth/doorway/SignInPanel";
import { RegisterPanel } from "../features/auth/doorway/RegisterPanel";
import { ForgotPanel, MagicLinkLanding, ResetPanel, SignInComplete } from "../features/auth/doorway/RecoveryPanels";
import { ArticlesListPage } from "../features/articles/ArticlesListPage";
import { ArticleReaderPage } from "../features/articles/ArticleReaderPage";
import { HomePage }   from "../pages/HomePage";
import { SearchPage } from "../pages/SearchPage";
import { LegalPage } from "../features/legal/LegalPage";
import { NotFoundPage } from "../features/pages/NotFoundPage";
import { ThemePreview } from "../pages/ThemePreview";
import { useInstallStatus } from "../features/installer/hooks/useInstallState";
import { useSiteConfig, type FeatureKey } from "../hooks/useSiteConfig";
import { useMaintenance } from "../features/maintenance/useMaintenance";
import { MaintenancePage } from "../features/maintenance/MaintenancePage";
import { api } from "../lib/api";
import { setBadgeShadows, type GroupShadowConfig } from "../lib/badgeShadow";
import { setRankImages } from "../lib/rankImage";
import { useAuth } from "../hooks/useAuth";
import { useActivityLogger } from "../hooks/useActivityLogger";
import { loadTokenCss, startStyleSync, onStyleVersionChange } from "../lib/liveStyle";
import { syncFavicon, TOKENS_APPLIED_EVENT } from "../lib/siteFavicon";
import { LAYOUTS_QUERY_KEY, isDraftLayout, isLayoutPreview } from "../layout/useLayout";
import { installPreviewBridge } from "../layout/previewBridge";
import { slotRegistry } from "../plugins/slotRegistry";
// ACP shell
// ACP pages — core
// ACP pages — moderation
// ACP pages — appearance
// ACP pages — extensions
// ACP pages — system
import { MembersOnly } from "../components/MembersOnly";
import { FatalErrorOverlay }     from "../components/FatalErrorOverlay";
import { HeadManager }           from "../components/HeadManager";
import { RouteErrorPage }        from "../features/errors/RouteErrorPage";
import { ErrorBoundary }         from "../features/errors/ErrorBoundary";
import { useRouteEvents } from "../plugins/hostEvents";

// ── Loaded on demand ─────────────────────────────────────────────────────────
// The ACP, the article editor and the installer are most of the app's code and
// most visitors never open them, so they are separate chunks fetched on first use.
// ⚠ A page here must not be needed for its side effects at startup.
const ArticleEditorPage = lazy(() => import("../features/articles/ArticleEditorPage").then((m) => ({ default: m.ArticleEditorPage })));
const InstallPage = lazy(() => import("../pages/InstallPage").then((m) => ({ default: m.InstallPage })));
const AcpLayout = lazy(() => import("../features/admin/AcpLayout").then((m) => ({ default: m.AcpLayout })));
const DashboardPage = lazy(() => import("../features/admin/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const UserListPage = lazy(() => import("../features/admin/pages/UserListPage").then((m) => ({ default: m.UserListPage })));
const UserDetailPage = lazy(() => import("../features/admin/pages/UserDetailPage").then((m) => ({ default: m.UserDetailPage })));
const ProfileFieldsPage = lazy(() => import("../features/admin/pages/ProfileFieldsPage").then((m) => ({ default: m.ProfileFieldsPage })));
const GroupsPage = lazy(() => import("../features/admin/pages/GroupsPage").then((m) => ({ default: m.GroupsPage })));
const GroupDetailPage = lazy(() => import("../features/admin/pages/groups/GroupDetailPage").then((m) => ({ default: m.GroupDetailPage })));
const BadgesPage = lazy(() => import("../features/admin/pages/BadgesPage").then((m) => ({ default: m.BadgesPage })));
const PermissionsPage = lazy(() => import("../features/admin/pages/PermissionsPage").then((m) => ({ default: m.PermissionsPage })));
const ProgressionPage = lazy(() => import("../features/admin/pages/ProgressionPage").then((m) => ({ default: m.ProgressionPage })));
const ArticlesPage = lazy(() => import("../features/admin/pages/ArticlesPage").then((m) => ({ default: m.ArticlesPage })));
const LegalDocumentsPage = lazy(() => import("../features/admin/pages/LegalDocumentsPage").then((m) => ({ default: m.LegalDocumentsPage })));
const EmojisPage = lazy(() => import("../features/admin/pages/EmojisPage").then((m) => ({ default: m.EmojisPage })));
const SettingsPage = lazy(() => import("../features/admin/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const EmailPage = lazy(() => import("../features/admin/pages/EmailPage").then((m) => ({ default: m.EmailPage })));
const AboutPage = lazy(() => import("../features/admin/pages/AboutPage").then((m) => ({ default: m.AboutPage })));
const ModLogPage = lazy(() => import("../features/admin/pages/ModLogPage").then((m) => ({ default: m.ModLogPage })));
const ModSettingsPage = lazy(() => import("../features/admin/pages/ModSettingsPage").then((m) => ({ default: m.ModSettingsPage })));
const ModTemplatesPage = lazy(() => import("../features/admin/pages/ModTemplatesPage").then((m) => ({ default: m.ModTemplatesPage })));
const ReviewCasesPage = lazy(() => import("../features/admin/pages/ReviewCasesPage").then((m) => ({ default: m.ReviewCasesPage })));
const ComposerSettings = lazy(() => import("../features/admin/pages/ComposerSettings").then((m) => ({ default: m.ComposerSettings })));
const StudioRedirect = lazy(() => import("../features/admin/pages/ThemeStudioPage").then((m) => ({ default: m.StudioRedirect })));
const ThemeStudioPage = lazy(() => import("../features/admin/pages/ThemeStudioPage").then((m) => ({ default: m.ThemeStudioPage })));
const ThemesPage = lazy(() => import("../features/admin/pages/ThemesPage").then((m) => ({ default: m.ThemesPage })));
const NavigationPage = lazy(() => import("../features/admin/pages/NavigationPage").then((m) => ({ default: m.NavigationPage })));
const MarketplacePage = lazy(() => import("../features/admin/pages/MarketplacePage").then((m) => ({ default: m.MarketplacePage })));
const InstalledPage = lazy(() => import("../features/admin/pages/InstalledPage").then((m) => ({ default: m.InstalledPage })));
const UpdatesPage = lazy(() => import("../features/admin/pages/UpdatesPage").then((m) => ({ default: m.UpdatesPage })));
const UploadPage = lazy(() => import("../features/admin/pages/UploadPage").then((m) => ({ default: m.UploadPage })));
const LicensePage = lazy(() => import("../features/admin/pages/LicensePage").then((m) => ({ default: m.LicensePage })));
const ErrorReferencePage = lazy(() => import("../features/admin/pages/ErrorReferencePage").then((m) => ({ default: m.ErrorReferencePage })));
const ErrorLogPage = lazy(() => import("../features/admin/pages/ErrorLogPage").then((m) => ({ default: m.ErrorLogPage })));
const MigrationHistoryPage = lazy(() => import("../features/admin/pages/MigrationHistoryPage").then((m) => ({ default: m.MigrationHistoryPage })));
const ActivityLogPage = lazy(() => import("../features/admin/pages/ActivityLogPage").then((m) => ({ default: m.ActivityLogPage })));
const ScheduledJobsPage = lazy(() => import("../features/admin/pages/ScheduledJobsPage").then((m) => ({ default: m.ScheduledJobsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as any)?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 3;
      },
    },
  },
});

// A component, not a constant element: the text is read when it renders, in the
// reader's language, not once when this module loads.
function Loading() {
  return (
    <div style={{ display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", color: "var(--c-fg-muted)" }}>
      {i18n.t("common:actions.loading")}
    </div>
  );
}

function InstallRoute() {
  const { data, isLoading, error } = useInstallStatus();
  // Latch: once the wizard is shown, keep it mounted no matter what later
  // status refetches say. The install flips `installed` to true mid-session
  // (finalize step) — without the latch a background refetch would yank the
  // user off the completion screen onto "/". Leaving is the user's click.
  const lockedOpen = useRef(false);
  if (lockedOpen.current) return <Suspense fallback={null}><InstallPage /></Suspense>;
  if (isLoading) return <Loading />;
  if (data?.installed || (error as any)?.status === 410) return <Navigate to="/" replace />;
  lockedOpen.current = true;
  return <Suspense fallback={null}><InstallPage /></Suspense>;
}

const INSTALL_PATHS = new Set(["/install", "/installer"]);

/** Inside the layout editor's preview iframe, wire hover/select/drag (ADR-0005). */
function usePreviewBridge() {
  useEffect(() => {
    if (!isLayoutPreview()) return;
    return installPreviewBridge();
  }, []);
}

function useCustomTokens(installed: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!installed) return;
    /**
     * In a layout PREVIEW, the draft stylesheet — the layouts already come from the
     * draft (`usePublishedLayouts`), and serving them under published colours showed
     * an arrangement nobody had staged in a palette nobody had chosen.
     *
     * It matters most for a THEME, which stages both halves at once: previewing one
     * with live colours is previewing half of it. `?source=draft` is the effective
     * draft — the theme layer with the admin's own on top — so this is the same
     * stylesheet a publish would produce.
     */
    void loadTokenCss({ draft: isDraftLayout() });

    /**
     * Keep every open client in sync with theme changes — EXCEPT the layout editor's
     * own preview.
     *
     * ⚠ The preview re-navigates on every template switch, and each document opened
     * its own EventSource. The dev proxy does not close the upstream socket when the
     * client goes away, so the streams accumulated; at SIX — the browser's HTTP/1.1
     * limit per origin — the page could open no further connection and EVERY request
     * from it queued forever. The editor then looked frozen: the picker moved, and
     * the document it asked for never arrived.
     *
     * The preview needs no stream anyway. The editor pushes the document and the
     * pending tokens into it over the `nv:` postMessage bridge, which is more
     * immediate than a publish-driven version bump and is the whole point of a
     * preview: it shows what is STAGED, not what is live.
     */
    if (!isLayoutPreview()) startStyleSync();
    // A layout publish bumps the same style version (ADR-0005), so page
    // structure refreshes over the existing stream instead of a second one.
    return onStyleVersionChange(() => {
      void queryClient.invalidateQueries({ queryKey: LAYOUTS_QUERY_KEY });
    });
  }, [installed, queryClient]);
}

function AppGuard() {
  const { pathname } = useLocation();
  const { data, isLoading, error } = useInstallStatus();
  useActivityLogger();
  useCustomTokens(!!(data?.installed || (error as any)?.status === 410));
  usePreviewBridge();
  useRouteEvents();

  // Pathless layout routes in React Router render for EVERY URL.
  // When on the install wizard, let InstallRoute own the page — return null
  // so AppGuard doesn't issue a <Navigate> and cause a re-render loop.
  if (INSTALL_PATHS.has(pathname)) return null;

  if (isLoading) return <Loading />;
  if ((error as any)?.status === 410 || data?.installed) return <><HeadManager /><LegalConsentGate /><Outlet /></>;
  return <Navigate to="/install" replace />;
}

function NotFound() { return <NotFoundPage />; }

/** Site root: renders the Home feed or redirects to the configured landing
 *  (e.g. /forum on a forum-only install). */
function RootRoute() {
  const { data, isLoading } = useSiteConfig();
  if (isLoading) return <Loading />;
  const landing = data?.landing ?? "home";
  if (landing === "home") return <HomePage />;
  return <Navigate to={landing} replace />;
}

/** Hard-gates a section route behind a feature flag — renders the 404 when off
 *  (the backend also 404s the API). */
function FeatureGate({ feature, children }: { feature: FeatureKey; children: React.ReactNode }) {
  const { data, isLoading } = useSiteConfig();
  if (isLoading) return <Loading />;
  if (data && !data.features[feature]) return <NotFoundPage embedded />;
  return <>{children}</>;
}

/**
 * The pathname, tracked THROUGH client-side navigations.
 *
 * A root gate sits outside the router, so it has no `useLocation`. Reading
 * `window.location` once is enough for the install paths (the wizard is a full
 * page load), but not for the public-route allowance: without a subscription,
 * one allowed path would render the entire app and every `<Link>` after it
 * would sail straight past the gate.
 */
function useRouterPathname(router: ReturnType<typeof buildRouter>): string {
  return useSyncExternalStore(
    (onChange) => router.subscribe(() => onChange()),
    () => router.state.location.pathname,
    () => "/",
  );
}

/**
 * Plugin gates, composed around the whole app.
 *
 * Core no longer knows what a beta is. A gate is a POLICY — "may this visitor
 * see the site at all" — and policies belong to whatever implements them: a plugin
 * that wants one (a private beta, a waitlist) registers it here. With no plugin
 * registered this renders its children and costs nothing.
 *
 * `pathname` is threaded down because a gate wraps the router and therefore has
 * no `useLocation` of its own. Gates nest in `order`, outermost first, so the
 * first registered gate is the first to get a say.
 */
function RootGates({ router, children }: { router: ReturnType<typeof buildRouter>; children: React.ReactNode }) {
  const pathname = useRouterPathname(router);
  const gates = slotRegistry.getRootGates();
  return gates.reduceRight<React.ReactNode>(
    (inner, { id, component: Gate }) => (
      // A throwing gate must not black out the site: it loses its say and the
      // app renders. A gate that fails open is the right failure for a beta —
      // the alternative is a blank page nobody can get past, including staff.
      <ErrorBoundary key={id} variant="full">
        <Gate pathname={pathname}>{inner}</Gate>
      </ErrorBoundary>
    ),
    children,
  );
}

function buildRouter() {
  return createBrowserRouter([
  // `errorElement` on every TOP-LEVEL route: react-router walks up to the
  // nearest one, so these four cover the whole tree and nothing can fall
  // through to the framework's developer-facing default screen. Errors under a
  // layout are caught closer, by the layout's own boundary, so the chrome
  // survives (see AppLayout/AcpLayout).
  { path: "/install",   element: <InstallRoute />, errorElement: <RouteErrorPage /> },
  { path: "/installer", element: <InstallRoute />, errorElement: <RouteErrorPage /> },
  // ADR-0003 Phase 2 — Style Editor specimen iframe. Top-level (no AppGuard) so it
  // renders independent of the install/maintenance/auth gates; the editor loads it
  // in an iframe as a spatial token selector.
  { path: "/__theme-preview", element: <ThemePreview />, errorElement: <RouteErrorPage /> },
  {
    element: <AppGuard />,
    errorElement: <RouteErrorPage />,
    children: [
      // The doorway: every way in (features/auth/doorway).
      { path: "/login",           element: <SignInPanel /> },
      { path: "/login/link",      element: <MagicLinkLanding /> },
      { path: "/login/complete",  element: <SignInComplete /> },
      { path: "/register",        element: <RegisterPanel /> },
      { path: "/forgot-password", element: <ForgotPanel /> },
      { path: "/reset-password",  element: <ResetPanel /> },
      // ── ACP ──────────────────────────────────────────────────────────────
      {
        path: "/admin",
        element: <Suspense fallback={null}><AcpLayout /></Suspense>,
        children: [
          // Core
          { index: true,              element: <DashboardPage /> },
          { path: "users",            element: <UserListPage /> },
          { path: "users/:id",        element: <UserDetailPage /> },
          { path: "profile-fields",   element: <ProfileFieldsPage /> },
          { path: "groups",           element: <GroupsPage /> },
          { path: "groups/:id",       element: <GroupDetailPage /> },
          { path: "badges",           element: <BadgesPage /> },
          { path: "permissions",      element: <PermissionsPage /> },
          { path: "progression",      element: <ProgressionPage /> },
          { path: "articles",         element: <ArticlesPage /> },
          // Categories live on the Articles page since 2026-10-20 (its second view).
          { path: "categories",       element: <Navigate to="/admin/articles?view=categories" replace /> },
          { path: "legal",            element: <LegalDocumentsPage /> },
          { path: "emojis",           element: <EmojisPage /> },
          // Custom pages removed 2026-10-02; legal documents are what they were used for.
          { path: "pages",            element: <Navigate to="/admin/legal" replace /> },
          { path: "settings",         element: <SettingsPage /> },
          { path: "email",            element: <EmailPage /> },
          { path: "about",            element: <AboutPage /> },
          // Moderation
          { path: "cases",            element: <ReviewCasesPage /> },
          { path: "modlog",           element: <ModLogPage /> },
          { path: "modsettings",      element: <ModSettingsPage /> },
          { path: "mod-templates",    element: <ModTemplatesPage /> },
          // Appearance
          // Theme Studio (2026-10-02): the Layout Editor and the Style Editor, merged —
          // one theme's layouts, colours, branding, CSS and history, one Publish. The
          // old routes redirect, keeping `?theme=` (and the style `?tab=` as a mode).
          { path: "theme-studio",     element: <ThemeStudioPage /> },
          { path: "style-editor",     element: <StudioRedirect from="style" /> },
          { path: "layout-editor",    element: <StudioRedirect from="layout" /> },
          { path: "composer",         element: <ComposerSettings /> },
          // Retired 2026-08-26: the same list is the Style Editor's History tab.
          { path: "style-history",    element: <Navigate to="/admin/theme-studio?mode=history" replace /> },
          { path: "navigation",       element: <NavigationPage /> },
          // `guest-home` retired 2026-08-09: the hero copy and section toggles are
          // block props on the guest landing, edited in the Layout Editor. Redirected
          // rather than 404'd, because the old path is in admins' history and docs.
          { path: "guest-home",       element: <Navigate to="/admin/theme-studio" replace /> },
          { path: "themes",           element: <ThemesPage /> },
          // `styles` retired 2026-08-15: `.xtstyle` was merged into `.xttheme`, so the
          // pack library and its table are gone. Themes is where the format lives now,
          // so a bookmark lands on its successor rather than on a 404.
          { path: "styles",           element: <Navigate to="/admin/themes" replace /> },
          // Extensions
          { path: "marketplace",      element: <MarketplacePage /> },
          { path: "installed",        element: <InstalledPage /> },
          { path: "updates",          element: <UpdatesPage /> },
          { path: "upload",           element: <UploadPage /> },
          { path: "license",          element: <LicensePage /> },
          // Plugin ACP routes (registered by plugins via slotRegistry)
          ...slotRegistry.getRoutes("acp").map((r) => ({
            path: r.path,
            element: <r.component />,
          })),
          // System
          { path: "error-ref",           element: <ErrorReferencePage /> },
          { path: "error-log",           element: <ErrorLogPage /> },
          { path: "migration-history",   element: <MigrationHistoryPage /> },
          { path: "activity-log",        element: <ActivityLogPage /> },
          { path: "scheduled-tasks",     element: <ScheduledJobsPage /> },
        ],
      },
      // ── Public ───────────────────────────────────────────────────────────
      {
        element: <AppLayout />,
        children: [
          { path: "/",                element: <RootRoute /> },
          { path: "/search",          element: <SearchPage /> },
          { path: "/u/:username",     element: <ProfilePage /> },
          { path: "/members",         element: <FeatureGate feature="members"><MembersPage /></FeatureGate> },
          { path: "/account",         element: <AccountPage /> },
          { path: "/articles",                element: <FeatureGate feature="articles"><ArticlesListPage /></FeatureGate> },
          { path: "/articles/:slug",          element: <FeatureGate feature="articles"><ArticleReaderPage /></FeatureGate> },
          // Writing an article happens inside the site's layout (frame, header, footer)
          // like every other page; only a member may.
          {
            element: <RequireSignIn />,
            children: [
              { path: "/articles/new",        element: <FeatureGate feature="articles"><ArticleEditorPage /></FeatureGate> },
              { path: "/articles/:slug/edit", element: <FeatureGate feature="articles"><ArticleEditorPage /></FeatureGate> },
            ],
          },
          { path: "/legal/:key",              element: <LegalPage /> },
          // Plugin public routes (registered by plugins via slotRegistry)
          ...slotRegistry.getRoutes("public").map((r) => ({
            path: r.path,
            element: r.requiresAuth ? <MembersOnly><r.component /></MembersOnly> : <r.component />,
          })),
        ],
      },
    ],
  },
  // Wildcard is top-level so it never forces AppGuard to render on /install
  { path: "*", element: <NotFound />, errorElement: <RouteErrorPage /> },
]);
}

/** Blocks the whole site behind the maintenance screen unless the viewer is in
 *  the allowed group (or an admin). Staff sign in via the page's login panel. */
function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data: install, error: installError } = useInstallStatus();
  const installed = !!install?.installed || (installError as any)?.status === 410;
  const { data: m } = useMaintenance(installed);
  const { user, isLoading } = useAuth();

  if (INSTALL_PATHS.has(window.location.pathname)) return <>{children}</>;
  if (!m?.enabled) return <>{children}</>;

  const allowed = !!user && user.groups.some((g) => m.allowedGroups.includes(g.key) || g.key === "admin");
  if (allowed) return <>{children}</>;
  if (isLoading) return <Loading />;

  return (
    <MaintenancePage
      status={m}
      blocked={!!user}
      onSignedIn={() => qc.invalidateQueries({ queryKey: ["maintenance"] })}
    />
  );
}

/** Populates the app-wide badge-glow colour set (ACP → Progression badge shadow),
 *  so Username renders the glow consistently everywhere. Shares the footer's
 *  legend-groups query (deduped by key). */
function BadgeShadowSync() {
  // Inert until installed: pre-install /members/groups is 503-blocked by the
  // install guard, and firing it just spams the console (same as a root gate).
  const { data: install, error: installError } = useInstallStatus();
  const installed = !!install?.installed || (installError as any)?.status === 410;
  const { data } = useQuery<Array<GroupShadowConfig & { key: string; rankImage?: string | null }>>({
    queryKey: ["legend-groups"],
    queryFn:  () => api.get("/members/groups"),
    staleTime: 300_000,
    enabled:   installed,
  });
  useEffect(() => {
    if (data) { setBadgeShadows(data); setRankImages(data); }
  }, [data]);
  return null;
}

/**
 * Keeps the favicon in sync with the site on EVERY screen (the maintenance page and
 * the ACP render outside AppLayout): the uploaded icon, else the Xentium mark in the
 * site's Logo icon colours (lib/siteFavicon). Re-drawn whenever the token stylesheet
 * changes, so a published recolour reaches open tabs too.
 */
function FaviconSync() {
  const { data: install, error: installError } = useInstallStatus();
  const installed = !!install?.installed || (installError as any)?.status === 410;
  const { data } = useQuery<{ iconUrl: string | null }>({
    queryKey: ["pub-branding"],
    queryFn:  () => api.get("/appearance/branding"),
    staleTime: 300_000,
    enabled:   installed,
  });
  const iconUrl = data?.iconUrl;
  useEffect(() => {
    if (!installed) return;
    const sync = () => syncFavicon(iconUrl);
    sync();
    window.addEventListener(TOKENS_APPLIED_EVENT, sync);
    return () => window.removeEventListener(TOKENS_APPLIED_EVENT, sync);
  }, [installed, iconUrl]);
  return null;
}

export default function App() {
  // useState initializer runs at first render — AFTER bootstrap() has
  // imported enabled plugin web entries and registered their routes.
  const [router] = useState(buildRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <BadgeShadowSync />
      <FaviconSync />
      {/* Outermost net. The gates below live OUTSIDE the router, so their
          crashes have no errorElement to reach — without this they'd blank the
          document. Inside the provider so the screen can still read auth. */}
      <ErrorBoundary variant="full">
        <MaintenanceGate>
          <RootGates router={router}>
            <RouterProvider router={router} />
          </RootGates>
        </MaintenanceGate>
      </ErrorBoundary>
      {/* Own feedback primitives: toast stack + confirm/alert dialogs (no swal) */}
      <ToastHost />
      <DialogHost />
      {/* WoltLab-style fatal halt — overlays everything when the API returns 5xx */}
      <FatalErrorOverlay />
    </QueryClientProvider>
  );
}
