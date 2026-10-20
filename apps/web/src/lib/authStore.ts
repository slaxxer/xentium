import type { LegalDocumentKey } from "@xentium/contracts";
export interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
  avatar: string | null;
  bio: string | null;
  postCount: number;
  articleCount: number;
  followerCount: number;
  followingCount: number;
  createdAt: string;
  loginPinEnabled: boolean;
  dobDisplay: "hidden" | "age" | "birthday";
  preferredLocale: string | null;
  likeCountReceived: number;
  // FULL group membership — the source of truth for role gating (ACP/staff UI).
  groups: Array<{ id: string; name: string; key: string; icon: string | null; displayOrder: number; badgeColor: string | null; badgeLabel: string | null }>;
  // Group IDs whose badge the user has chosen to hide (Account → Preferences).
  hiddenBadges: string[];
  // `groups` minus `hiddenBadges` — use this for the user's OWN badge display so
  // hiding a badge never removes the group from identity/role checks (BUGS.md #1).
  visibleGroups: AuthUser["groups"];
  // Effective permission keys (implied expanded) — gate UI on these, never on group
  // keys: who holds what is configured in ACP → Permissions. Optional so a stale
  // cached payload without it reads as "no permissions", not a crash.
  permissions?: string[];
  /** Legal documents still to accept, in footer order (LegalConsentGate sends them there). */
  pendingLegal?: LegalDocumentKey[];
  /** `pendingLegal` is not empty. */
  needsLegalConsent?: boolean;
}

/** May this user do `key`? A UI hint — the endpoint enforces it regardless. */
export function userCan(user: AuthUser | null | undefined, key: string): boolean {
  return !!user?.permissions?.includes(key);
}

export interface AuthSnapshot {
  token: string | null;
  user: AuthUser | null;
  loaded: boolean;
}

type Listener = () => void;

let _token: string | null = null;
let _user: AuthUser | null = null;
let _loaded = false;
const _listeners = new Set<Listener>();

// Stable snapshot object — only replaced when state changes.
// useSyncExternalStore uses Object.is to detect changes; returning a new
// object literal on every call causes an infinite render loop.
let _snapshot: AuthSnapshot = { token: null, user: null, loaded: false };

function rebuildSnapshot() {
  _snapshot = { token: _token, user: _user, loaded: _loaded };
}

function notify() {
  rebuildSnapshot();
  _listeners.forEach((fn) => fn());
}

export const authStore = {
  get token(): string | null { return _token; },
  get user(): AuthUser | null { return _user; },
  get loaded(): boolean { return _loaded; },

  set(token: string, user: AuthUser) {
    _token = token;
    _user = user;
    _loaded = true;
    notify();
  },

  clear() {
    _token = null;
    _user = null;
    _loaded = true;
    notify();
  },

  markLoaded() {
    _loaded = true;
    notify();
  },

  subscribe(fn: Listener): () => void {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },

  /** Returns the same object reference until state changes — required by useSyncExternalStore. */
  getSnapshot(): AuthSnapshot {
    return _snapshot;
  },
};
