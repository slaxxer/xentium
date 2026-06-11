import pino from "pino";
import { env } from "../../config/env.js";

export const logger = pino({
  level: "info",
  transport: env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
});
