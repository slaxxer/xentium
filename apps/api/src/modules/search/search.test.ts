/**
 * Core search runs its raw SQL against the real (throwaway) database.
 *
 * Both queries once joined `group_progression`, a table renamed to
 * `xcf_group_progression` long before: every site-wide search failed with a 500 and
 * nothing noticed, because nothing ran the SQL. These tests do.
 */
import { describe, it, expect } from "vitest";
import { searchService } from "./search.service.js";

describe("core search", () => {
  it("runs the article and member queries without a database error", async () => {
    const res = await searchService.search({ query: "anything", type: "all", isLoggedIn: false, page: 1, limit: 5 });
    expect(res).toHaveProperty("articles");
    expect(res).toHaveProperty("users");
  });

  it("runs for a signed-in member too", async () => {
    await expect(searchService.search({ query: "x", type: "all", isLoggedIn: true, page: 1, limit: 5 })).resolves.toBeTruthy();
  });
});
