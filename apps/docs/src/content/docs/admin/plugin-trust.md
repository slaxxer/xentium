---
title: Where a plugin came from
description: How your site tells a plugin Xentium has reviewed from one nobody has, and what it refuses outright.
sidebar:
  order: 4
---

A plugin runs with the same reach as the rest of your site. Your site checks what it can
about every package it installs, and records the answer.

## Three answers, not two

**Reviewed by Xentium.** The package carries a signature from us, and it checks out. We
looked at this exact build, on a date the signature records.

**Unverified source.** The package carries no signature. This is the normal state for a
plugin you wrote, one a developer sent you directly, or anything not bought through the
marketplace. It is not an accusation and nothing blocks it — but nobody has checked the code
except whoever wrote it, so treat it the way you would treat any code you are about to run.

**Refused.** The package carries a signature that does not check out, and your site will not
install it. It has been altered since we signed it, or the signature was never ours. A
package claiming a review it cannot prove is a different thing from one that makes no claim
at all, and we would rather stop than shrug.

If you see a refusal on something you downloaded from us, the download was damaged or
interfered with. Fetch it again; if it happens twice, tell us.

## The check travels with the file

The signature lives inside the package, so it does not matter how the file reached you. A
plugin you bought, downloaded on your laptop and uploaded by hand to a server with no
internet is still reviewed. One restored from a backup is still reviewed. And a package that
came straight from our marketplace is *not* trusted merely for having come that way — if
something changed the bytes in between, the signature says so.

## What the review tiers mean

- **Audited** — we read the code.
- **Reviewed** — we checked what it does, how it asks for permissions, and what it ships.
- **Unvetted** — it is listed, but we have not looked closely.

A review is a statement about the past: we looked at this build, then. It does not expire. If
we later find a problem with something we reviewed, that arrives as a security advisory
through the same daily check that brings you updates.

## Installing unsigned packages

Manual uploads are switched off by default, in **ACP → Extensions → Installed**. The
marketplace is the ordinary way plugins arrive; turning uploads on is you saying you have
another source and you trust it.

Nothing stops you running your own code — you should be able to. The point of the label is
that you know which kind you are running.
