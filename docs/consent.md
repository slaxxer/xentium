# Cookies and consent

Xentium does not show a cookie dialog on its own. Core only uses cookies a site needs to work (signing in, security, language, theme), and those need no consent. When a site uses anything optional, the admin installs a consent plugin, and that plugin shows the dialog.

What core gives you is the contract between the two:

- a list of **declarations**: every cookie, browser storage key and external service, with its purpose, lifetime and category
- one **check**, `hasConsent(category)`, that anything optional asks before it runs

A consent plugin reads the declarations to build its dialog and cookie policy, and answers the check from the visitor's choice. With no consent plugin installed, the check says yes to `necessary` and no to everything else. That is the safe answer under the GDPR and the ePrivacy rules.

## Categories

| Category | Use it for |
| --- | --- |
| `necessary` | Signing in, security, things the visitor asked for. Always allowed. |
| `preferences` | Remembering comfort settings that are not strictly needed. |
| `statistics` | Analytics and usage measurement. |
| `marketing` | Advertising and tracking across sites. |
| `media` | Content loaded from another site: videos, maps, fonts, icon kits. |

## Declaring what your plugin uses

Declare everything your plugin stores or loads, even when it is necessary. The cookie policy is built from these declarations, so a missing one is a missing line in the site's policy.

```ts
import { declareConsent } from "@web/lib/consent";

declareConsent([
  {
    id: "my-plugin.view-mode",
    name: "my-plugin.viewMode",
    kind: "localStorage",
    category: "preferences",
    provider: "this",                       // "this" = the site itself
    purpose: { key: "consent.viewMode", ns: "my-plugin" },
    lifetime: "Until you clear it",
  },
  {
    id: "my-plugin.youtube",
    name: "YouTube",
    kind: "service",
    category: "media",
    provider: "Google Ireland Ltd.",
    purpose: "Plays embedded videos.",
    privacyUrl: "https://policies.google.com/privacy",
  },
], "my-plugin");
```

`purpose` and `lifetime` take plain text or an i18n key with its namespace. Pass your plugin id as the second argument: when your plugin is disabled, its declarations go away with it.

## Checking before you run

Ask before you set the cookie, write the storage key or load the script. Not after.

```ts
import { hasConsent, onConsentChange } from "@web/lib/consent";

if (hasConsent("statistics")) startAnalytics();
onConsentChange(() => { if (hasConsent("statistics")) startAnalytics(); });
```

In a component, `useConsent(category)` gives you the same answer and re-renders when it changes.

## Placeholders for embeds

For an embed the visitor can see (a video, a map), wrap it in `ConsentGate`. Until the visitor agrees, it shows a placeholder that names the service, with a button to load it once. When a consent plugin is active, a second button allows the whole category from then on.

```tsx
import { ConsentGate } from "@web/components/ConsentGate";

<ConsentGate category="media" service="YouTube" privacyUrl="https://policies.google.com/privacy">
  <iframe src="https://www.youtube-nocookie.com/embed/…" />
</ConsentGate>
```

## Writing a consent plugin

A consent plugin registers itself as the provider with `setConsentProvider({ has, subscribe, open, grant })`. From then on `hasConsent` asks it, the footer shows a "Cookie settings" link that calls `open`, and placeholders call `grant`. Render the dialog with `registerSiteOverlay`, and read the list with `useConsentDeclarations()`. Only one provider is active at a time.
