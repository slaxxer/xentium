import { api } from "../../lib/api";
import type {
  InstallStatusDto,
  EnvironmentCheckDto,
  SetupConfigInput,
  SiteConfigInput,
  AdminAccountInput,
} from "@xentium/contracts";

export const installerApi = {
  status: () => api.get<InstallStatusDto>("/install/status"),
  environment: () => api.get<EnvironmentCheckDto>("/install/environment"),
  /** Setup mode only: post DB credentials; the server writes .env and hot-swaps. */
  setup: (body: SetupConfigInput) => api.post<{ ok: boolean }>("/install/setup", body),
  testDatabase: () => api.get<{ ok: boolean }>("/install/database/test"),
  database: (databaseUrl?: string) => api.post("/install/database", { databaseUrl }),
  site: (body: SiteConfigInput) => api.post("/install/site", body),
  admin: (body: AdminAccountInput) => api.post("/install/admin", body),
  finalize: () => api.post("/install/finalize", {}),
};
