// Shared slug helpers (§32). Pure and DB-agnostic so both core and plugins
// can use them. `uniqueSlug` takes an injected `exists` check so it never
// depends on a particular ORM or table.

export function slugify(input: string): string {
  return input.toLowerCase().trim()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';
}

// exists() is injected so this stays DB-agnostic.
export async function uniqueSlug(base: string, exists: (s: string) => Promise<boolean>) {
  const root = slugify(base);
  if (!(await exists(root))) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
}
