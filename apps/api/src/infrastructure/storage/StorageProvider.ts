export interface StorageProvider {
  save(subdir: string, filename: string, data: Buffer): Promise<string>; // returns relative path
  delete(relPath: string): Promise<void>;
  exists(relPath: string): Promise<boolean>;
  publicUrl(relPath: string): string;
}
