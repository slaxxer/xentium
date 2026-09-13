import type { XecCodeDeclaration } from "@xentium/plugin-sdk";

class XecRegistry {
  private codes       = new Map<string, XecCodeDeclaration>();
  private pluginCodes = new Map<string, string[]>(); // pluginId → registered code keys

  register(pluginId: string, declarations: XecCodeDeclaration[]): void {
    const keys: string[] = [];
    for (const d of declarations) {
      this.codes.set(d.code, d);
      keys.push(d.code);
    }
    this.pluginCodes.set(pluginId, keys);
  }

  deregister(pluginId: string): void {
    const keys = this.pluginCodes.get(pluginId) ?? [];
    for (const key of keys) {
      this.codes.delete(key);
    }
    this.pluginCodes.delete(pluginId);
  }

  getAll(): XecCodeDeclaration[] {
    return [...this.codes.values()];
  }
}

export const necRegistry = new XecRegistry();
