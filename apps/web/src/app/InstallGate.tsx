import type { ReactNode } from "react";
import { useInstallStatus } from "../features/installer/hooks/useInstallState";
import { InstallPage } from "../pages/InstallPage";

export function InstallGate({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useInstallStatus();
  if (isLoading) return <div style={{ display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", color: "var(--c-fg-muted)" }}>Loading…</div>;
  // 410 means the installer is locked = the app is already installed
  if ((error as any)?.status === 410) return <>{children}</>;
  if (!data?.installed) return <InstallPage />;
  return <>{children}</>;
}
