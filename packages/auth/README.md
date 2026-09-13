# @nodevo/auth

**Authentication primitives for the Xentium framework.**

Token minting and verification, argon2 password hashing (plus verification of
migrated bcrypt and phpass hashes), the access-token revocation denylist, and
the two Express request guards.

Primitives only. The login FLOW — sessions, bans, lockout, email verification —
belongs to the application that owns those concepts, so nothing here ever sees a
user record. A user is an opaque id.

```ts
const tokens = createTokenService({ accessSecret, refreshHmacSecret });
const { requireAuth, optionalAuth } = createAuthMiddleware({
  verifyAccess: tokens.verifyAccess,
  isAccessTokenRevoked,      // optional, but omit it deliberately
});
```

---

Part of the [Xentium framework](https://github.com/slaxxer/nodevo). Xentium is a framework with the Xentium CMS as its first application.

MIT © Slaxxer
