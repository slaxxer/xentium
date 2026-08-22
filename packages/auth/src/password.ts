import argon2 from "argon2";

/** Hash a password for storage. argon2id — the scheme every native account uses. */
export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });

/** Verify a password against an argon2 hash. */
export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw);
