import { test } from "@playwright/test";

/**
 * Remaining §56 e2e flows, scaffolded as fixmes so the coverage roadmap lives
 * in code. Each will be implemented as its own NN-*.spec.ts file (replacing the
 * matching entry here) once its UI selectors are wired up.
 *
 * Ordering note: these depend on 01-install (installed site) and, where noted,
 * on additional setup (a second user, the forum plugin, a dev license).
 */

// All §56 e2e flows are now implemented across 01–07:
//   01-install   · install wizard
//   02-auth      · register, login, invalid-credentials
//   03-article   · article publish + comment
//   04-social    · follow/unfollow, block, profile wall, private follower list
//   05-moderation· warn, ban, force-logout, password-reset, comment tombstone
//   06-plugins   · plugin upload/install/enable (license activation = fixme,
//                  blocked by a dev-env key bug — see 06-plugins.spec.ts)
//   07-forum     · forum node + thread + reply
//
// This file is intentionally left as a placeholder for future flows.
test.fixme("placeholder for future e2e flows", async () => {});
