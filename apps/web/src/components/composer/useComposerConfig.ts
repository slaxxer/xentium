/**
 * The admin's composer tool set, for the editor.
 *
 * ⚠ It answers the DEFAULT immediately and the site's config when it lands. An
 * editor that waited for a request would render a toolbar-shaped hole on every
 * comment box on the page, and the default is what most sites run anyway.
 *
 * ⚠ One query key for the whole app, so ten comment boxes on an article cost one
 * request — and the ACP page writing the config invalidates the same key, which is
 * why every open editor restyles the moment an admin saves.
 */
import { useQuery } from "@tanstack/react-query";
import {
  COMPOSER_DEFAULT_CONFIG, resolveComposerConfig,
  type ComposerConfig, type ResolvedComposerTool,
} from "@nodevo/contracts";
import { api } from "../../lib/api";

export const COMPOSER_CONFIG_KEY = ["composer-config"] as const;

export function useComposerConfig(): {
  config: ComposerConfig;
  tools:  ResolvedComposerTool[];
} {
  const { data } = useQuery<ComposerConfig>({
    queryKey: [...COMPOSER_CONFIG_KEY],
    queryFn:  () => api.get("/appearance/composer"),
    // The tool set changes when an admin changes it, not while someone types.
    staleTime: 5 * 60 * 1000,
  });

  // Resolved on the client too: the endpoint already canonicalises, but this hook
  // also runs against the fallback and against a cache written by the ACP page.
  return resolveComposerConfig(data ?? COMPOSER_DEFAULT_CONFIG);
}
