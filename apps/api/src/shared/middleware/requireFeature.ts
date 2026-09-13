import type { RequestHandler } from "express";
import { XentiumError } from "../errors/XentiumError.js";
import { NEC } from "@nodevo/contracts";
import { isFeatureEnabled, type FeatureKey } from "../../modules/site/site.service.js";

/** Hard-gates a route group behind a core feature flag. When the feature is
 *  disabled the route 404s (the data is preserved — re-enabling restores it). */
export function requireFeature(feature: FeatureKey): RequestHandler {
  return (_req, _res, next) => {
    isFeatureEnabled(feature)
      .then((on) =>
        on
          ? next()
          : next(new XentiumError({ code: NEC.API_NOT_FOUND, httpStatus: 404, message: "Not found" })),
      )
      .catch(next);
  };
}
