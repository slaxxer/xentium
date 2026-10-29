import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

/**
 * ONE connection pool for the process. Core's Prisma client runs on it, and so can a
 * plugin's own database client (`host.pg`): ten plugins with their own ORM must not
 * mean ten pools competing for Postgres's connection limit.
 */
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
export { PrismaClient };
