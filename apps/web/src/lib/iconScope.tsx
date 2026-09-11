/**
 * Whether icons here follow the SITE's style, or stay on the bundled free set.
 *
 * ⚠ The admin panel does not follow the site's design — it has its own token layer
 * and its own pinned font, for the same reason it now has its own icons: an admin
 * changing how their community looks must not change the tool they are changing it
 * with. A Pro+ family with partial coverage would otherwise punch holes in the ACP's
 * own chrome, which is exactly what happened the first time it was tried.
 *
 * ⚠ The exception is a PREVIEW. A control inside the ACP whose whole job is to show
 * what visitors will see — the icon picker's swatch, a badge's mark — opts back in
 * with `<IconScope value="site">`, or it would lie.
 */
import { createContext, useContext } from "react";

export type IconScopeValue = "site" | "acp";

const Ctx = createContext<IconScopeValue>("site");

export function IconScope({ value, children }: { value: IconScopeValue; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIconScope(): IconScopeValue {
  return useContext(Ctx);
}
