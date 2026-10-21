import type { PageSource, SeoProvider } from "@xentium/contracts";

/**
 * Who describes pages, and who turns descriptions into tags.
 *
 * Page sources: core registers its own at boot (`seo.core-sources.ts`), a plugin
 * through `ctx.registerPageSource` (removed again when it is disabled). The SEO
 * provider is one slot: the SEO plugin. Without it, core writes its defaults.
 */
const sources = new Map<string, { source: PageSource; owner: string }>();
let provider: { provider: SeoProvider; owner: string } | null = null;

export const seoRegistry = {
  registerSource(source: PageSource, owner = "core"): void {
    sources.set(source.id, { source, owner });
  },
  /** Every source, core's first, in registration order. */
  sources(): PageSource[] {
    return [...sources.values()].map((s) => s.source);
  },
  setProvider(p: SeoProvider, owner: string): void {
    provider = { provider: p, owner };
  },
  provider(): SeoProvider | null {
    return provider?.provider ?? null;
  },
  /** A plugin was disabled: forget everything it registered. */
  dropOwner(owner: string): void {
    for (const [id, s] of sources) if (s.owner === owner) sources.delete(id);
    if (provider?.owner === owner) provider = null;
  },
};
