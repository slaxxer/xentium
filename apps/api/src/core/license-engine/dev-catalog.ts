import type { MarketplaceListing } from "@nodevo/contracts";

// Dev catalogue mirror — used in local dev (LICENSE_DEV_PRIVATE_KEY set), where
// no marketplace server is called. Single source of truth for dev licensing:
// listPlugins serves it, and signDevJwt derives its entitlement grants from it,
// so a plugin added here is automatically dev-entitled.
export const DEV_CATALOG: MarketplaceListing[] = [
  { id: "nodevo-forum",        name: "Forum",               description: "Full-featured forum with categories, threads, and moderation.", vendor: "Nodevo", latestVersion: "1.0.0", priceCents: 2900, currency: "USD", licenseRequired: true  },
  { id: "nodevo-messaging",    name: "Private Messaging",   description: "Direct messaging with conversations and read receipts.",        vendor: "Nodevo", latestVersion: "1.0.0", priceCents: 1900, currency: "USD", licenseRequired: true  },
  { id: "nodevo-shoutbox",     name: "Shoutbox",            description: "Live shoutbox with rooms, level-gated capabilities, and inline moderation.", vendor: "Nodevo", latestVersion: "1.0.0", priceCents: 1400, currency: "USD", licenseRequired: true  },
  { id: "nodevo-seo-tools",    name: "SEO Tools",           description: "Meta tags, sitemaps, structured data, and search optimization.", vendor: "Nodevo", latestVersion: "1.0.0", priceCents: 2400, currency: "USD", licenseRequired: true  },
  { id: "nodevo-analytics",    name: "Analytics",           description: "Built-in analytics dashboard with no third-party scripts.",     vendor: "Nodevo", latestVersion: "1.0.0", priceCents: 3400, currency: "USD", licenseRequired: true  },
  { id: "nodevo-advanced-moderation", name: "Advanced Moderation", description: "Multi-account detection, scoring, and automation tools.", vendor: "Nodevo", latestVersion: "1.0.0", priceCents: 4900, currency: "USD", licenseRequired: true  },
  { id: "nodevo-2fa",          name: "Two-Factor Auth",     description: "TOTP 2FA for all users. Admins can require it for staff.",      vendor: "Nodevo", latestVersion: "1.0.0", priceCents: 0,    currency: "USD", licenseRequired: false },
];

/** Entitlement keys a dev-signed JWT grants: every catalogue plugin. */
export function devEntitlements(): string[] {
  return DEV_CATALOG.map((p) => `plugin.${p.id}`);
}
