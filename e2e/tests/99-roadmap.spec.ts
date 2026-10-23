import { test } from "@playwright/test";

/**
 * Remaining §56 e2e flows, scaffolded as fixmes so the coverage roadmap lives
 * in code. Each will be implemented as its own NN-*.spec.ts file (replacing the
 * matching entry here) once its UI selectors are wired up.
 *
 * Ordering note: these depend on 01-install (installed site) and, where noted,
 * on additional setup (a second user, the forum plugin, a dev license).
 */

// Covered today (01–06):
//   01-install   · install wizard (8 steps)
//   02-auth      · sign-up (account, security, verify), sign-in, wrong password
//   03-article   · article publish through the editor + a member's comment
//   04-social    · follow/unfollow, wall post, block, private follower list
//   05-moderation· warn, ban, password reset + sign out everywhere, comment removal
//   06-plugins   · upload, install (with a migration) and enable a test plugin
//
// This file is intentionally left as a placeholder for future flows.
test.fixme("placeholder for future e2e flows", async () => {});
