import { logger } from "../../infrastructure/logging/logger.js";

/**
 * Plugin gates on authentication (§43).
 *
 * Core owns identity: passwords, sessions, tokens, groups. It does NOT own the
 * question "is this person allowed in RIGHT NOW" — that is a policy, and a
 * policy belongs to whatever implements it. A private-beta plugin gates on an
 * invite code; a different plugin might gate on an allow-list or a paid seat.
 * Before this registry existed core had the beta policy hardcoded into
 * `auth.service` and `auth.controller`, which meant core shipped an opinion
 * about betas that no site without one could remove.
 *
 * A guard THROWS to refuse. It never returns a boolean: the refusal carries the
 * XEC code and the message the client shows, and those belong to the plugin that
 * knows why it said no.
 *
 * Every hook is optional — a guard implements only the moments it cares about.
 * Failures are contained per hook, EXCEPT for the two that decide access: a
 * `beforeLogin` or `beforeRegister` that throws is the whole point, so its error
 * propagates. The bookkeeping hooks (`afterRegister`, `onLogout`) are
 * fire-and-forget and are logged rather than allowed to fail an auth flow that
 * has already succeeded.
 */

/** What a guard is told about the request. Deliberately primitives — a guard
 *  must not reach into Express, or it could rewrite the response. */
export interface AuthGuardRequest {
  ip:        string;
  userAgent: string | null;
  /** Signed cookies, so a guard can read its own (e.g. an invite cookie). */
  cookies:   Record<string, string>;
}

/** What a guard may add to `GET /auth/registration-status`. */
export interface RegistrationStatusPatch {
  open?:          boolean;
  mode?:          string;
  /** Heading + body shown when registration is closed, so the plugin owns the
   *  wording rather than core carrying a string for a feature it does not have. */
  closedTitle?:   string;
  closedBody?:    string;
}

/** `"allow"` = this guard authorised the action; core's own policy is skipped. */
export type AuthGuardDecision = "allow";

export interface AuthGuard {
  id: string;
  /** Refuse a login by throwing. Staff are passed too — the guard decides
   *  whether to exempt them; core does not assume a policy exempts anyone. */
  beforeLogin?(req: AuthGuardRequest & { userId: string; isStaff: boolean }): Promise<void>;
  /**
   * Refuse a registration by throwing, before any row is written.
   *
   * Returning `"allow"` means this guard has AUTHORISED the registration and
   * core's own `auth.registration_mode` gate does not apply — a private beta
   * where the invite IS the credential must work on a site whose registration is
   * otherwise closed, which is exactly how core behaved before it was extracted.
   * Returning nothing means "no opinion": core's own policy still runs.
   */
  beforeRegister?(req: AuthGuardRequest): Promise<AuthGuardDecision | void>;
  /** The account now exists — link it to whatever let them in. */
  afterRegister?(req: AuthGuardRequest & { userId: string }): Promise<void>;
  /** After a successful login, for a plugin's own audit trail. */
  afterLogin?(req: AuthGuardRequest & { userId: string; isStaff: boolean }): Promise<void>;
  /** Contribute to the registration-status endpoint. Return null to abstain. */
  registrationStatus?(req: AuthGuardRequest): Promise<RegistrationStatusPatch | null>;
  /** Cookie names core should clear on logout, so a plugin needs no `res`. */
  cookiesToClearOnLogout?: string[];
}

class AuthGuardRegistry {
  private guards = new Map<string, AuthGuard[]>();

  register(pluginId: string, guard: AuthGuard): void {
    const list = this.guards.get(pluginId) ?? [];
    list.push(guard);
    this.guards.set(pluginId, list);
  }

  deregister(pluginId: string): void {
    this.guards.delete(pluginId);
  }

  private all(): AuthGuard[] {
    return [...this.guards.values()].flat();
  }

  /** True when nothing is registered — lets auth skip the work entirely. */
  get isEmpty(): boolean {
    return this.guards.size === 0;
  }

  /** Any guard may refuse. The FIRST throw wins and propagates untouched, so the
   *  client gets that plugin's XEC code rather than a core-flavoured wrapper. */
  async beforeLogin(req: AuthGuardRequest & { userId: string; isStaff: boolean }): Promise<void> {
    for (const g of this.all()) await g.beforeLogin?.(req);
  }

  /** Refusal propagates. Returns true when ANY guard authorised the
   *  registration outright, which tells core to skip its own mode gate. */
  async beforeRegister(req: AuthGuardRequest): Promise<boolean> {
    let authorised = false;
    for (const g of this.all()) {
      if ((await g.beforeRegister?.(req)) === "allow") authorised = true;
    }
    return authorised;
  }

  /** Bookkeeping — a failure here must never undo an account that already exists. */
  async afterRegister(req: AuthGuardRequest & { userId: string }): Promise<void> {
    for (const g of this.all()) {
      try { await g.afterRegister?.(req); }
      catch (err) { logger.warn({ err, guard: g.id }, "auth guard afterRegister failed"); }
    }
  }

  async afterLogin(req: AuthGuardRequest & { userId: string; isStaff: boolean }): Promise<void> {
    for (const g of this.all()) {
      try { await g.afterLogin?.(req); }
      catch (err) { logger.warn({ err, guard: g.id }, "auth guard afterLogin failed"); }
    }
  }

  /** Merged patch, later guards winning. A guard that throws is skipped: the
   *  status endpoint is read-only and must answer even if a plugin is broken. */
  async registrationStatus(req: AuthGuardRequest): Promise<RegistrationStatusPatch> {
    let patch: RegistrationStatusPatch = {};
    for (const g of this.all()) {
      try {
        const next = await g.registrationStatus?.(req);
        if (next) patch = { ...patch, ...next };
      } catch (err) {
        logger.warn({ err, guard: g.id }, "auth guard registrationStatus failed");
      }
    }
    return patch;
  }

  cookiesToClearOnLogout(): string[] {
    return [...new Set(this.all().flatMap((g) => g.cookiesToClearOnLogout ?? []))];
  }
}

export const authGuardRegistry = new AuthGuardRegistry();
