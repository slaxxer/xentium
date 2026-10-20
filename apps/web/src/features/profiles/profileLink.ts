/**
 * Where a profile field with a link prefix points, and what it shows.
 *
 * A member types their name on that site ("octocat", "@octocat", "org/repo"); some
 * paste the whole address. An address that already starts with the prefix is used
 * as typed and shown as the name. An address on any other site is not linked: the
 * prefix says which site this field is for.
 */
export function prefixedLink(prefix: string, answer: string): { href: string; text: string } | null {
  if (!/^https?:\/\//i.test(prefix)) return null;
  const value = answer.trim();
  let name = value.replace(/^@/, "");
  if (/^https?:\/\//i.test(value)) {
    if (!value.toLowerCase().startsWith(prefix.toLowerCase())) return null;
    name = value.slice(prefix.length);
  }
  name = name.replace(/^\/+|\/+$/g, "");
  if (!name) return null;
  // Each path segment encoded on its own, so "org/repo" keeps its slash.
  return { href: prefix + name.split("/").map(encodeURIComponent).join("/"), text: name };
}
