import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env';
import { NodevoError } from '../../shared/errors/NodevoError';
import { NEC } from '../../shared/errors/nec';
import type { StorageProvider } from './StorageProvider';

const ALLOWED = ['avatars', 'articles', 'pages', 'groups', path.join('themes', 'logo')];
const BASE = path.resolve(env.UPLOAD_DIR);

function resolveSafe(subdir: string, filename = ''): string {
  const ok = ALLOWED.some((d) => subdir === d || subdir.startsWith(d + path.sep));
  if (!ok) {
    throw new NodevoError({ code: NEC.API_FORBIDDEN, httpStatus: 403, message: `Disallowed upload dir: ${subdir}` });
  }
  const target = path.resolve(BASE, subdir, filename);
  const rel = path.relative(BASE, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new NodevoError({ code: NEC.API_FORBIDDEN, httpStatus: 403, message: 'Path traversal blocked' });
  }
  return target;
}

const toRel = (abs: string) => path.relative(BASE, abs).split(path.sep).join('/');

export class LocalStorageProvider implements StorageProvider {
  async save(subdir: string, filename: string, data: Buffer): Promise<string> {
    const target = resolveSafe(subdir, filename);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    return toRel(target);
  }

  async delete(relPath: string): Promise<void> {
    const target = resolveSafe(path.dirname(relPath), path.basename(relPath));
    await fs.rm(target, { force: true });
  }

  async exists(relPath: string): Promise<boolean> {
    const target = resolveSafe(path.dirname(relPath), path.basename(relPath));
    try { await fs.access(target); return true; } catch { return false; }
  }

  publicUrl(relPath: string): string {
    return `/uploads/${relPath.split(path.sep).join('/')}`;
  }
}

export const storage: StorageProvider = new LocalStorageProvider();
