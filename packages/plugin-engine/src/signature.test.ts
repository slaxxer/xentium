/**
 * The frozen vector.
 *
 * `computeContentDigest` is a wire format: the marketplace computes it when it
 * signs a package and every instance computes it when it verifies one, from two
 * codebases that share no code today. A change on one side that nobody notices
 * is a change that silently stops every signature verifying in the field.
 *
 * ⚠ The twin of this file lives in the marketplace repo
 * (`src/shared/plugin-signature.test.ts`) and asserts the SAME constant. If you
 * ever have to change the algorithm, both move together and every published
 * artifact has to be re-signed.
 */
import { describe, expect, it } from "vitest";
import { SIGNATURE_ENTRY, computeContentDigest } from "./signature.js";

const entry = (path: string, text: string) => ({ path, data: Buffer.from(text, "utf8") });

/** A fixed three-file package. Do not edit these without regenerating below. */
const FIXTURE = [
  entry("manifest.json", '{"id":"demo-plugin","version":"1.0.0"}\n'),
  entry("server/dist/index.js", "export function onEnable() {}\n"),
  entry("web/dist/index.js", "export default {};\n"),
];

const FROZEN = "c1ca9fc5de867c2cae501fcb6e0222cd76fc778f79146a182a3f5c0000890504";

describe("computeContentDigest", () => {
  it("is stable for a known package", () => {
    // This assertion is the contract. If it fails after a refactor, the refactor
    // broke every signature in the field — do not update the constant to make it
    // pass.
    expect(computeContentDigest(FIXTURE)).toBe(FROZEN);
  });

  it("does not depend on the order entries arrive in", () => {
    const shuffled = [FIXTURE[2]!, FIXTURE[0]!, FIXTURE[1]!];
    expect(computeContentDigest(shuffled)).toBe(computeContentDigest(FIXTURE));
  });

  it("ignores the signature entry, so a package can carry its own signature", () => {
    const signed = [...FIXTURE, entry(SIGNATURE_ENTRY, "eyJhbGciOiJSUzI1NiJ9.x.y")];
    expect(computeContentDigest(signed)).toBe(computeContentDigest(FIXTURE));
  });

  it("ignores directory entries", () => {
    const withDirs = [...FIXTURE, entry("server/", ""), entry("web/dist/", "")];
    expect(computeContentDigest(withDirs)).toBe(computeContentDigest(FIXTURE));
  });

  it("changes when a file's contents change", () => {
    const tampered = [FIXTURE[0]!, entry("server/dist/index.js", "export function onEnable() { steal(); }\n"), FIXTURE[2]!];
    expect(computeContentDigest(tampered)).not.toBe(computeContentDigest(FIXTURE));
  });

  it("changes when a file is added or removed", () => {
    expect(computeContentDigest([...FIXTURE, entry("extra.js", "")])).not.toBe(computeContentDigest(FIXTURE));
    expect(computeContentDigest(FIXTURE.slice(0, 2))).not.toBe(computeContentDigest(FIXTURE));
  });

  it("changes when a file is renamed, contents untouched", () => {
    const renamed = [FIXTURE[0]!, entry("server/dist/main.js", "export function onEnable() {}\n"), FIXTURE[2]!];
    expect(computeContentDigest(renamed)).not.toBe(computeContentDigest(FIXTURE));
  });

  it("cannot be confused by a path that looks like the separator", () => {
    // The listing joins path and hash with NUL precisely so that no arrangement
    // of names can produce another arrangement's listing.
    const a = [entry("a", "one"), entry("b", "two")];
    const b = [entry("a\nb", "one"), entry("b", "two")];
    expect(computeContentDigest(a)).not.toBe(computeContentDigest(b));
  });
});
