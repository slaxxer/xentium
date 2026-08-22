export interface StorageProvider {
  /** Returns the stored file's path, relative to the provider's base. */
  save(subdir: string, filename: string, data: Buffer): Promise<string>;
  delete(relPath: string): Promise<void>;
  exists(relPath: string): Promise<boolean>;
  publicUrl(relPath: string): string;
}
