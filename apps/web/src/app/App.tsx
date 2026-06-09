import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { RouterProvider, createBrowserRouter, Outlet, Navigate, useLocation } from "react-router-dom";
import Swal from "sweetalert2";
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
import { useInstallStatus } from "../features/installer/hooks/useInstallState";
import { api } from "../lib/api";
import { authStore } from "../lib/authStore";
import { applyLogout } from "../hooks/useAuth";
import { useBetaActivityLogger } from "../hooks/useBetaActivityLogger";
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
import { SettingsPage }      from "../features/admin/pages/SettingsPage";
import { AboutPage }         from "../features/admin/pages/AboutPage";
// ACP pages — moderation
import { ModCasesPage }    from "../features/admin/pages/ModCasesPage";
import { ModLogPage }      from "../features/admin/pages/ModLogPage";
import { ModSettingsPage } from "../features/admin/pages/ModSettingsPage";
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
import { ScheduledJobsPage }     from "../features/admin/pages/ScheduledJobsPage";

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
  if (isLoading) return LOADING;
  if (data?.installed || (error as any)?.status === 410) return <Navigate to="/" replace />;
  return <InstallPage />;
}

const INSTALL_PATHS = new Set(["/install", "/installer"]);

function useCustomTokens(installed: boolean) {
  useEffect(() => {
    if (!installed) return;
    fetch("/api/appearance/css")
      .then((r) => (r.ok ? r.text() : ""))
      .then((css) => {
        if (!css) return;
        let el = document.getElementById("nodevo-custom-tokens") as HTMLStyleElement | null;
        if (!el) {
          el = document.createElement("style");
          el.id = "nodevo-custom-tokens";
          document.head.appendChild(el);
        }
        el.textContent = css;
      })
      .catch(() => {});
  }, [installed]);
}

function AppGuard() {
  const { pathname } = useLocation();
  const { data, isLoading, error } = useInstallStatus();
  useBetaActivityLogger();
  useCustomTokens(!!(data?.installed || (error as any)?.status === 410));

  // Pathless layout routes in React Router render for EVERY URL.
  // When on the install wizard, let InstallRoute own the page — return null
  // so AppGuard doesn't issue a <Navigate> and cause a re-render loop.
  if (INSTALL_PATHS.has(pathname)) return null;

  if (isLoading) return LOADING;
  if ((error as any)?.status === 410 || data?.installed) return <Outlet />;
  return <Navigate to="/install" replace />;
}

function NotFound() { return <h1>404 – Page not found</h1>; }

function BetaGate({ children }: { children: React.ReactNode }) {
  const qc             = useQueryClient();
  const prevAccess     = useRef<boolean | null>(null);

  const { data, isLoading } = useQuery<{ enabled: boolean; hasAccess: boolean }>({
    queryKey:        ["beta-status"],
    queryFn:         () => api.get("/beta/status"),
    staleTime:       0,           // always fresh on refetch
    refetchInterval: 12_000,      // poll every 12 s
    retry:           false,
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
        Swal.fire({
          background:         "var(--c-card)",
          color:              "var(--c-fg)",
          icon:               "warning",
          title:              "Beta access revoked",
          text:               "Your beta access has been revoked by an administrator. You have been signed out.",
          confirmButtonColor: "var(--c-accent)",
          confirmButtonText:  "OK",
        }).then(() => qc.invalidateQueries({ queryKey: ["beta-status"] }));
      })();
    }

    prevAccess.current = current;
  }, [data?.hasAccess, data?.enabled]);

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
          { path: "/articles/new",       element: <ArticleEditorPage /> },
          { path: "/articles/:slug/edit",element: <ArticleEditorPage /> },
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
          { path: "settings",         element: <SettingsPage /> },
          { path: "about",            element: <AboutPage /> },
          // Moderation
          { path: "cases",            element: <ModCasesPage /> },
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
          { path: "scheduled-tasks",     element: <ScheduledJobsPage /> },
        ],
      },
      // ── Public ───────────────────────────────────────────────────────────
      {
        element: <AppLayout />,
        children: [
          { path: "/",                element: <HomePage /> },
          { path: "/search",          element: <SearchPage /> },
          { path: "/u/:username",     element: <ProfilePage /> },
          { path: "/members",         element: <MembersPage /> },
          { path: "/account",         element: <AccountPage /> },
          { path: "/articles",                element: <ArticlesListPage /> },
          { path: "/articles/:slug",          element: <ArticleReaderPage /> },
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

export default function App() {
  // useState initializer runs at first render — AFTER bootstrap() has
  // imported enabled plugin web entries and registered their routes.
  const [router] = useState(buildRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <BetaGate>
        <RouterProvider router={router} />
      </BetaGate>
    </QueryClientProvider>
  );
}
