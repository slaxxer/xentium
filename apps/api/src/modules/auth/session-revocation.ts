/**
 * The CMS's binding of the framework revocation denylist (`@nodevo/auth`).
 *
 * The package owns the semantics; this file supplies the Redis client and the
 * key namespace. `ACCESS_TTL_SECONDS` is re-exported from the package, which is
 * now the single definition — it used to be duplicated here on purpose, because
 * importing the token module would have dragged Prisma and BullMQ onto the
 * request hot path. The framework package has neither dependency, so the copy
 * is gone.
 */
import { createRevocationList, ACCESS_TTL_SECONDS } from "@nodevo/auth";
import { redis, rkey } from "../../infrastructure/redis.js";

const list = createRevocationList({ redis, keyPrefix: rkey });

export const { revokeUserAccessTokens, revokeSessionAccessToken, isAccessTokenRevoked } = list;
export { ACCESS_TTL_SECONDS };
