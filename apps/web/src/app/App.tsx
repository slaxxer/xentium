import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RouterProvider, createBrowserRouter, Outlet, Navigate, useLocation } from "react-router-dom";
import { ToastHost } from "../components/ToastHost";
import { DialogHost } from "../components/DialogHost";
import { AppLayout } from "../layouts/AppLayout";
import { EditorLayout } from "../layouts/EditorLayout";
import { ProfilePage } from "../features/profiles/ProfilePage";
import { MembersPage } from "../features/members/MembersPage";
import { AccountPage } from "../features/account/AccountPage";
import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { ArticlesListPage } from "../features/articles/ArticlesListPage";
import { ArticleReaderPage } from "../features/articles/ArticleReaderPage";
import { ArticleEditorPage } from "../features/articles/ArticleEditorPage";
import { InstallPage } from "../pages/InstallPage";
import { HomePage }   from "../pages/HomePage";
import { SearchPage } from "../pages/SearchPage";
import { PageReaderPage } from "../features/pages/PageReaderPage";
import { NotFoundPage } from "../features/pages/NotFoundPage";
import { ThemePreview } from "../pages/ThemePreview";
import { useInstallStatus } from "../features/installer/hooks/useInstallState";
import { useSiteConfig, type FeatureKey } from "../hooks/useSiteConfig";
import { useMaintenance } from "../features/maintenance/useMaintenance";
import { MaintenancePage } from "../features/maintenance/MaintenancePage";
import { api } from "../lib/api";
import { setBadgeShadows, type GroupShadowConfig } from "../lib/badgeShadow";
import { useAuth } from "../hooks/useAuth";
import { useActivityLogger } from "../hooks/useActivityLogger";
import { loadTokenCss, startStyleSync, onStyleVersionChange } from "../lib/liveStyle";
import { LAYOUTS_QUERY_KEY, isDraftLayout, isLayoutPreview } from "../layout/useLayout";
import { installPreviewBridge } from "../layout/previewBridge";
import { slotRegistry } from "../plugins/slotRegistry";
// ACP shell
import { AcpLayout } from "../features/admin/AcpLayout";
// ACP pages — core
import { DashboardPage }     from "../features/admin/pages/DashboardPage";
import { UserListPage }      from "../features/admin/pages/UserListPage";
import { UserDetailPage }    from "../features/admin/pages/UserDetailPage";
import { ProfileFieldsPage } from "../features/admin/pages/ProfileFieldsPage";
import { GroupsPage }        from "../features/admin/pages/GroupsPage";
import { BadgesPage }        from "../features/admin/pages/BadgesPage";
import { PermissionsPage }   from "../features/admin/pages/PermissionsPage";
import { ProgressionPage }   from "../features/admin/pages/ProgressionPage";
import { ArticlesPage }      from "../features/admin/pages/ArticlesPage";
import { CategoriesPage }    from "../features/admin/pages/CategoriesPage";
import { PagesPage }         from "../features/admin/pages/PagesPage";
import { PageEditorPage }    from "../features/admin/pages/PageEditorPage";
import { SettingsPage }      from "../features/admin/pages/SettingsPage";
import { EmailPage } from "../features/admin/pages/EmailPage";
import { AboutPage }         from "../features/admin/pages/AboutPage";
// ACP pages — moderation
import { ModLogPage }      from "../features/admin/pages/ModLogPage";
import { ModSettingsPage } from "../features/admin/pages/ModSettingsPage";
import { ReviewCasesPage } from "../features/admin/pages/ReviewCasesPage";
// ACP pages — appearance
import { StyleEditorPage }  from "../features/admin/pages/StyleEditorPage";
import { ComposerSettings } from "../features/admin/pages/ComposerSettings";
import { LayoutEditorPage } from "../features/admin/pages/LayoutEditorPage";
import { ThemesPage }       from "../features/admin/pages/ThemesPage";
import { NavigationPage }   from "../features/admin/pages/NavigationPage";
// ACP pages — extensions
import { MarketplacePage } from "../features/admin/pages/MarketplacePage";
import { InstalledPage }   from "../features/admin/pages/InstalledPage";
import { UpdatesPage }     from "../features/admin/pages/UpdatesPage";
import { AnnouncementsPage } from "../features/admin/pages/AnnouncementsPage";
import { UploadPage }      from "../features/admin/pages/UploadPage";
import { LicensePage }     from "../features/admin/pages/LicensePage";
// ACP pages — system
import { ErrorReferencePage }    from "../features/admin/pages/ErrorReferencePage";
import { ErrorLogPage }          from "../features/admin/pages/ErrorLogPage";
import { MigrationHistoryPage }  from "../features/admin/pages/MigrationHistoryPage";
import { ActivityLogPage }       from "../features/admin/pages/ActivityLogPage";
import { ScheduledJobsPage }     from "../features/admin/pages/ScheduledJobsPage";
import { FatalErrorOverlay }     from "../components/FatalErrorOverlay";
import { CanonicalManager }      from "../components/CanonicalManager";
import { RouteErrorPage }        from "../features/errors/RouteErrorPage";
import { ErrorBoundary }         from "../features/errors/ErrorBoundary";

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

const LOADING = (
  <div style={{ display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", color: "var(--c-fg-muted)" }}>
    Loading…
  </div>
);

function InstallRoute() {
  const { data, isLoading, error } = useInstallStatus();
  // Latch: once the wizard is shown, keep it mounted no matter what later
  // status refetches say. The install flips `installed` to true mid-session
  // (finalize step) — without the latch a background refetch would yank the
  // user off the completion screen onto "/". Leaving is the user's click.
  const lockedOpen = useRef(false);
  if (lockedOpen.current) return <InstallPage />;
  if (isLoading) return LOADING;
  if (data?.installed || (error as any)?.status === 410) return <Navigate to="/" replace />;
  lockedOpen.current = true;
  return <InstallPage />;
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

  // Pathless layout routes in React Router render for EVERY URL.
  // When on the install wizard, let InstallRoute own the page — return null
  // so AppGuard doesn't issue a <Navigate> and cause a re-render loop.
  if (INSTALL_PATHS.has(pathname)) return null;

  if (isLoading) return LOADING;
  if ((error as any)?.status === 410 || data?.installed) return <><CanonicalManager /><Outlet /></>;
  return <Navigate to="/install" replace />;
}

function NotFound() { return <NotFoundPage />; }

/** Site root: renders the Home feed or redirects to the configured landing
 *  (e.g. /forum on a forum-only install). */
function RootRoute() {
  const { data, isLoading } = useSiteConfig();
  if (isLoading) return LOADING;
  const landing = data?.landing ?? "home";
  if (landing === "home") return <HomePage />;
  return <Navigate to={landing} replace />;
}

/** Hard-gates a section route behind a feature flag — renders the 404 when off
 *  (the backend also 404s the API). */
function FeatureGate({ feature, children }: { feature: FeatureKey; children: React.ReactNode }) {
  const { data, isLoading } = useSiteConfig();
  if (isLoading) return LOADING;
  if (data && !data.features[feature]) return <NotFoundPage />;
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
 * see the site at all" — and policies belong to whatever implements them; the
 * private-beta one now lives in the launch plugin, which registers here. With no
 * plugin registered this renders its children and costs nothing.
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
  // survives (see AppLayout/AcpLayout/EditorLayout).
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
      { path: "/login",           element: <LoginPage /> },
      { path: "/register",        element: <RegisterPage /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
      { path: "/reset-password",  element: <ResetPasswordPage /> },
      {
        element: <EditorLayout />,
        children: [
          { path: "/articles/new",       element: <FeatureGate feature="articles"><ArticleEditorPage /></FeatureGate> },
          { path: "/articles/:slug/edit",element: <FeatureGate feature="articles"><ArticleEditorPage /></FeatureGate> },
          { path: "/pages/new",          element: <PageEditorPage /> },
          { path: "/pages/:id/edit",     element: <PageEditorPage /> },
        ],
      },
      // ── ACP ──────────────────────────────────────────────────────────────
      {
        path: "/admin",
        element: <AcpLayout />,
        children: [
          // Core
          { index: true,              element: <DashboardPage /> },
          { path: "users",            element: <UserListPage /> },
          { path: "users/:id",        element: <UserDetailPage /> },
          { path: "profile-fields",   element: <ProfileFieldsPage /> },
          { path: "groups",           element: <GroupsPage /> },
          { path: "badges",           element: <BadgesPage /> },
          { path: "permissions",      element: <PermissionsPage /> },
          { path: "progression",      element: <ProgressionPage /> },
          { path: "articles",         element: <ArticlesPage /> },
          { path: "categories",       element: <CategoriesPage /> },
          { path: "pages",            element: <PagesPage /> },
          { path: "settings",         element: <SettingsPage /> },
          { path: "email",            element: <EmailPage /> },
          { path: "about",            element: <AboutPage /> },
          // Moderation
          { path: "cases",            element: <ReviewCasesPage /> },
          { path: "modlog",           element: <ModLogPage /> },
          { path: "modsettings",      element: <ModSettingsPage /> },
          // Appearance
          { path: "style-editor",     element: <StyleEditorPage /> },
          { path: "layout-editor",    element: <LayoutEditorPage /> },
          { path: "composer",         element: <ComposerSettings /> },
          // Retired 2026-08-26: the same list is the Style Editor's History tab.
          { path: "style-history",    element: <Navigate to="/admin/style-editor?tab=history" replace /> },
          { path: "navigation",       element: <NavigationPage /> },
          // `guest-home` retired 2026-08-09: the hero copy and section toggles are
          // block props on the guest landing, edited in the Layout Editor. Redirected
          // rather than 404'd, because the old path is in admins' history and docs.
          { path: "guest-home",       element: <Navigate to="/admin/layout-editor" replace /> },
          { path: "themes",           element: <ThemesPage /> },
          // `styles` retired 2026-08-15: `.xtstyle` was merged into `.xttheme`, so the
          // pack library and its table are gone. Themes is where the format lives now,
          // so a bookmark lands on its successor rather than on a 404.
          { path: "styles",           element: <Navigate to="/admin/themes" replace /> },
          // Extensions
          { path: "marketplace",      element: <MarketplacePage /> },
          { path: "installed",        element: <InstalledPage /> },
          { path: "updates",          element: <UpdatesPage /> },
          { path: "announcements",    element: <AnnouncementsPage /> },
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
          { path: "/p/:slug",                 element: <PageReaderPage /> },
          // Plugin public routes (registered by plugins via slotRegistry)
          ...slotRegistry.getRoutes("public").map((r) => ({
            path: r.path,
            element: <r.component />,
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
  if (isLoading) return LOADING;

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
  const { data } = useQuery<GroupShadowConfig[]>({
    queryKey: ["legend-groups"],
    queryFn:  () => api.get("/members/groups"),
    staleTime: 300_000,
    enabled:   installed,
  });
  useEffect(() => {
    if (data) setBadgeShadows(data);
  }, [data]);
  return null;
}

export default function App() {
  // useState initializer runs at first render — AFTER bootstrap() has
  // imported enabled plugin web entries and registered their routes.
  const [router] = useState(buildRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <BadgeShadowSync />
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
