// The light runtime side of licensing (ADR 0001). Wraps the license-engine's
// domain-aware verification behind the shared `EntitlementProvider` contract.
// Called on plugin enable and by the daily refresh job — never per request.

import type { EntitlementProvider, EntitlementStatus } from "@nodevo/contracts";
import { getEntitlementStatus, refreshLicense } from "./license-engine.js";

export const entitlementProvider: EntitlementProvider = {
  check(pluginId: string): Promise<EntitlementStatus> {
    return getEntitlementStatus(pluginId);
  },

  async refresh(pluginId?: string): Promise<EntitlementStatus | null> {
    await refreshLicense();
    return pluginId ? getEntitlementStatus(pluginId) : null;
  },
};
