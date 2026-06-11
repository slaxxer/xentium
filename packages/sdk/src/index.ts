// @nodevo/sdk — shared runtime helpers for core AND plugin authors.
//
// Boundary:
//   @nodevo/contracts   — shared types/constants/DTOs (no runtime logic)
//   @nodevo/sdk         — shared runtime helpers (this package)
//   @nodevo/plugin-sdk  — the plugin authoring contract (PluginContext, etc.)
//
// Also ships the license verification public key (license-public-key.pem,
// §43), read by the core license-engine.

export * from './slug.js';
export * from './access.js';

// Re-export the pagination contract so plugin list endpoints can build
// PaginatedResponse<T> without reaching into @nodevo/contracts directly.
export type {
  PaginatedRequest,
  PaginationMeta,
  PaginatedResponse,
} from '@nodevo/contracts';
