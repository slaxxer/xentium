/**
 * The CMS's binding of the framework secret box (`@xentium/server-kit`).
 *
 * The key rides COOKIE_SECRET, so no new required env. The derivation (scrypt,
 * salt `nodevo.secretbox.v1`) lives in the package and is frozen — changing it
 * would make every value ever encrypted undecryptable.
 */
import { createSecretBox } from "@xentium/server-kit";
import { env } from "../../config/env.js";

const box = createSecretBox(env.COOKIE_SECRET);

export const { encryptSecret, decryptSecret, isEncrypted } = box;
