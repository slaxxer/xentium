import type { ThemeManifest } from '@nodevo/contracts'; // defined in Phase 0 contracts

class ThemeRegistryImpl {
  private themes = new Map<string, ThemeManifest>();
  register(theme: ThemeManifest) { this.themes.set(theme.id, theme); }
  get(id: string) { return this.themes.get(id); }
  list() { return [...this.themes.values()]; }
}
export const ThemeRegistry = new ThemeRegistryImpl();
