/**
 * Phase 9 stub — plugin-extensible search content type registry.
 * Phase 16 (Forum plugin) will register additional content types here.
 */

export interface SearchableContentType {
  type:        string;   // e.g. "forum_thread"
  table:       string;
  vectorCol:   string;
  labelCol:    string;
  linkPattern: string;   // e.g. "/forum/thread/{id}"
  permission:  string | null; // null = public
}

class SearchRegistry {
  private types = new Map<string, SearchableContentType>();

  register(def: SearchableContentType): void {
    this.types.set(def.type, def);
  }

  deregister(type: string): void {
    this.types.delete(type);
  }

  getAll(): SearchableContentType[] {
    return [...this.types.values()];
  }
}

export const searchRegistry = new SearchRegistry();
