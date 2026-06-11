export * from './permissions.js';
export * from './installer.js';
export * from './pagination.js';
export * from './nec.js';
export * from './entitlement.js';
export * from './marketplace.js';
export * from './appearance.js';

export type ThemeMode = 'light' | 'dark';

export interface ThemeManifest {
  id: string;
  name: string;
  mode: ThemeMode;
}
