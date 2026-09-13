import { promises as fs } from "node:fs";
import path from "node:path";
import { NEC } from "@nodevo/contracts";
import { XentiumError } from "@nodevo/errors";
import type { StorageProvider } from "./StorageProvider.js";

export interface LocalStorageOptions {
  /** Filesystem root. Everything written is confined below it. */
  baseDir: string;
  /**
   * Subdirectories that may be written to. An application names its own — the
   * package has no idea what an avatar or a theme is. A subdir matches when it
   * equals an entry or is nested beneath one.
   */
  allowedSubdirs: readonly string[];
  /** URL prefix `publicUrl` builds on. Default "/uploads". */
  publicPrefix?: string;
}

/**
 * Filesystem-backed storage with the two guards that matter: writes are
 * confined to an allowlist of subdirectories, and any path that escapes the
 * base after resolution is refused. Callers are still expected to basename and
 * sanitise user-supplied filenames before they get here — this is the floor,
 * not the whole defence.
 */
export class LocalStorageProvider implements StorageProvider {
  private readonly base: string;
  private readonly allowed: readonly string[];
  private readonly publicPrefix: string;

  constructor(opts: LocalStorageOptions) {
    this.base = path.resolve(opts.baseDir);
    this.allowed = opts.allowedSubdirs;
    this.publicPrefix = opts.publicPrefix ?? "/uploads";
  }

  private resolveSafe(subdir: string, filename = ""): string {
    const ok = this.allowed.some((d) => subdir === d || subdir.startsWith(d + path.sep));
    if (!ok) {
      throw new XentiumError({
        code: NEC.API_FORBIDDEN,
        httpStatus: 403,
        message: `Disallowed upload dir: ${subdir}`,
      });
    }
    const target = path.resolve(this.base, subdir, filename);
    const rel = path.relative(this.base, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new XentiumError({
        code: NEC.API_FORBIDDEN,
        httpStatus: 403,
        message: "Path traversal blocked",
      });
    }
    return target;
  }

  private toRel(abs: string): string {
    return path.relative(this.base, abs).split(path.sep).join("/");
  }

  async save(subdir: string, filename: string, data: Buffer): Promise<string> {
    const target = this.resolveSafe(subdir, filename);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    return this.toRel(target);
  }

  async delete(relPath: string): Promise<void> {
    const target = this.resolveSafe(path.dirname(relPath), path.basename(relPath));
    await fs.rm(target, { force: true });
  }

  async exists(relPath: string): Promise<boolean> {
    const target = this.resolveSafe(path.dirname(relPath), path.basename(relPath));
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }

  publicUrl(relPath: string): string {
    return `${this.publicPrefix}/${relPath.split(path.sep).join("/")}`;
  }
}
