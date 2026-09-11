/**
 * Badge shapes live in `@nodevo/contracts` — the web app draws these on every user
 * card, so the types have to be shared rather than described twice.
 *
 * ⚠ This file is a re-export, not a second definition. A parallel copy here is how
 * the two halves drift on a nullable field and nobody notices until a card renders
 * `undefined`.
 */
export type { AwardedBadge, BadgeRow } from "@nodevo/contracts";
