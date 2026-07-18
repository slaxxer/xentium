import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { RouterProvider, createBrowserRouter, Outlet, Navigate, useLocation } from "react-router-dom";
import { openDialog } from "../lib/dialog";
import { ToastHost } from "../components/ToastHost";
import { DialogHost } from "../components/DialogHost";
import { AppLayout } from "../layouts/AppLayout";
import { EditorLayout } from "../layouts/EditorLayout";
import { ProfilePage } from "../features/profiles/ProfilePage";
import { MembersPage } from "../features/members/MembersPage";
import { AccountPage } from "../features/account/AccountPage";
import { LoginPage } from "../features/auth/LoginPage";
import { BetaGatePage } from "../features/auth/BetaGatePage";
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
import { authStore } from "../lib/authStore";
import { applyLogout, useAuth } from "../hooks/useAuth";
import { useBetaActivityLogger } from "../hooks/useBetaActivityLogger";
import { useActivityLogger } from "../hooks/useActivityLogger";
import { applyTokenCss, startStyleSync } from "../lib/liveStyle";
import { slotRegistry } from "../plugins/slotRegistry";
// ACP shell
import { AcpLayout } from "../features/admin/AcpLayout";
// ACP pages — core
import { DashboardPage }     from "../features/admin/pages/DashboardPage";
import { UserListPage }      from "../features/admin/pages/UserListPage";
import { UserDetailPage }    from "../features/admin/pages/UserDetailPage";
import { ProfileFieldsPage } from "../features/admin/pages/ProfileFieldsPage";
import { GroupsPage }        from "../features/admin/pages/GroupsPage";
import { PermissionsPage }   from "../features/admin/pages/PermissionsPage";
import { ProgressionPage }   from "../features/admin/pages/ProgressionPage";
import { ArticlesPage }      from "../features/admin/pages/ArticlesPage";
import { CategoriesPage }    from "../features/admin/pages/CategoriesPage";
import { PagesPage }         from "../features/admin/pages/PagesPage";
import { PageEditorPage }    from "../features/admin/pages/PageEditorPage";
import { SettingsPage }      from "../features/admin/pages/SettingsPage";
import { AboutPage }         from "../features/admin/pages/AboutPage";
// ACP pages — moderation
import { ModLogPage }      from "../features/admin/pages/ModLogPage";
import { ModSettingsPage } from "../features/admin/pages/ModSettingsPage";
import { ReviewCasesPage } from "../features/admin/pages/ReviewCasesPage";
// ACP pages — appearance
import { StyleEditorPage }  from "../features/admin/pages/StyleEditorPage";
import { StylesPage }       from "../features/admin/pages/StylesPage";
import { StyleHistoryPage } from "../features/admin/pages/StyleHistoryPage";
import { NavigationPage }   from "../features/admin/pages/NavigationPage";
import { GuestHomePage }   from "../features/admin/pages/GuestHomePage";
// ACP pages — extensions
import { MarketplacePage } from "../features/admin/pages/MarketplacePage";
import { InstalledPage }   from "../features/admin/pages/InstalledPage";
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

function useCustomTokens(installed: boolean) {
  useEffect(() => {
    if (!installed) return;
    fetch("/api/appearance/css")
      .then((r) => (r.ok ? r.text() : ""))
      .then((css) => { if (css) applyTokenCss(css); })
      .catch(() => {});
    // Keep every open client in sync with theme changes within a few seconds.
    startStyleSync();
  }, [installed]);
}

function AppGuard() {
  const { pathname } = useLocation();
  const { data, isLoading, error } = useInstallStatus();
  useBetaActivityLogger();
  useActivityLogger();
  useCustomTokens(!!(data?.installed || (error as any)?.status === 410));

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

function BetaGate({ children }: { children: React.ReactNode }) {
  const qc             = useQueryClient();
  const prevAccess     = useRef<boolean | null>(null);

  // The gate is inert until the app is installed: pre-install the endpoint is
  // 503-blocked by the install guard (polling it just spams the console), and
  // the gate must never hijack the install wizard mid-flow.
  const { data: install, error: installError } = useInstallStatus();
  const installed = !!install?.installed || (installError as any)?.status === 410;

  const { data, isLoading } = useQuery<{ enabled: boolean; hasAccess: boolean }>({
    queryKey:        ["beta-status"],
    queryFn:         () => api.get("/beta/status"),
    staleTime:       0,           // always fresh on refetch
    refetchInterval: 12_000,      // poll every 12 s
    retry:           false,
    enabled:         installed,
  });

  useEffect(() => {
    const current = data?.hasAccess ?? null;
    const prev    = prevAccess.current;

    // Detect revocation: was accessible, now blocked (only while beta is still enabled)
    if (prev === true && current === false && data?.enabled) {
      (async () => {
        if (authStore.token) {
          try { await api.post("/auth/logout"); } catch { /* ignore */ }
          applyLogout();
        }
        openDialog({
          kind: "alert", icon: "warning",
          title: "Beta access revoked",
          body:  "Your beta access has been revoked by an administrator. You have been signed out.",
        }).then(() => qc.invalidateQueries({ queryKey: ["beta-status"] }));
      })();
    }

    prevAccess.current = current;
  }, [data?.hasAccess, data?.enabled]);

  // Not installed yet (or on the install wizard): pass through untouched.
  if (!installed || INSTALL_PATHS.has(window.location.pathname)) return <>{children}</>;

  if (isLoading) return LOADING;
  if (data?.enabled && !data.hasAccess) {
    return (
      <BetaGatePage
        onSuccess={(isNew) => {
          if (isNew) {
            window.location.href = "/register";
          } else {
            qc.invalidateQueries({ queryKey: ["beta-status"] });
          }
        }}
      />
    );
  }
  return <>{children}</>;
}

function buildRouter() {
  return createBrowserRouter([
  { path: "/install",   element: <InstallRoute /> },
  { path: "/installer", element: <InstallRoute /> },
  // ADR-0003 Phase 2 — Style Editor specimen iframe. Top-level (no AppGuard) so it
  // renders independent of the install/maintenance/auth gates; the editor loads it
  // in an iframe as a spatial token selector.
  { path: "/__theme-preview", element: <ThemePreview /> },
  {
    element: <AppGuard />,
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
          { path: "permissions",      element: <PermissionsPage /> },
          { path: "progression",      element: <ProgressionPage /> },
          { path: "articles",         element: <ArticlesPage /> },
          { path: "categories",       element: <CategoriesPage /> },
          { path: "pages",            element: <PagesPage /> },
          { path: "settings",         element: <SettingsPage /> },
          { path: "about",            element: <AboutPage /> },
          // Moderation
          { path: "cases",            element: <ReviewCasesPage /> },
          { path: "modlog",           element: <ModLogPage /> },
          { path: "modsettings",      element: <ModSettingsPage /> },
          // Appearance
          { path: "style-editor",     element: <StyleEditorPage /> },
          { path: "styles",           element: <StylesPage /> },
          { path: "style-history",    element: <StyleHistoryPage /> },
          { path: "navigation",       element: <NavigationPage /> },
          { path: "guest-home",       element: <GuestHomePage /> },
          // Extensions
          { path: "marketplace",      element: <MarketplacePage /> },
          { path: "installed",        element: <InstalledPage /> },
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
  { path: "*", element: <NotFound /> },
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
  // install guard, and firing it just spams the console (same as BetaGate).
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
      <MaintenanceGate>
        <BetaGate>
          <RouterProvider router={router} />
        </BetaGate>
      </MaintenanceGate>
      {/* Own feedback primitives: toast stack + confirm/alert dialogs (no swal) */}
      <ToastHost />
      <DialogHost />
      {/* WoltLab-style fatal halt — overlays everything when the API returns 5xx */}
      <FatalErrorOverlay />
    </QueryClientProvider>
  );
}
