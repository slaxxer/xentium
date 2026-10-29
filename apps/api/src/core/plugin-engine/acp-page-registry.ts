export interface AcpPageDeclaration {
  section: string;
  label:   string;
  path:    string;
  icon?:   string;
  /** A heading in the section's panel (plain text, or the plugin's translation). */
  group?:  string;
}

class AcpPageRegistry {
  private pages = new Map<string, AcpPageDeclaration[]>();

  register(pluginId: string, page: AcpPageDeclaration): void {
    const existing = this.pages.get(pluginId) ?? [];
    existing.push(page);
    this.pages.set(pluginId, existing);
  }

  deregister(pluginId: string): void {
    this.pages.delete(pluginId);
  }

  getAll(): (AcpPageDeclaration & { pluginId: string })[] {
    return Array.from(this.pages.entries()).flatMap(([pluginId, pages]) =>
      pages.map((p) => ({ ...p, pluginId })),
    );
  }
}

export const acpPageRegistry = new AcpPageRegistry();
