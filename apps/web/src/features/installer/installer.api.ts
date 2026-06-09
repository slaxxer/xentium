import { api } from "../../lib/api";
import type { InstallStatusDto, EnvironmentCheckDto, SiteConfigInput, AdminAccountInput } from "@nodevo/contracts";

export const installerApi = {
  status: () => api.get<InstallStatusDto>("/install/status"),
  environment: () => api.get<EnvironmentCheckDto>("/install/environment"),
  testDatabase: () => api.get<{ ok: boolean }>("/install/database/test"),
  database: (databaseUrl?: string) => api.post("/install/database", { databaseUrl }),
  site: (body: SiteConfigInput) => api.post("/install/site", body),
  admin: (body: AdminAccountInput) => api.post("/install/admin", body),
  finalize: () => api.post("/install/finalize", {}),
};
