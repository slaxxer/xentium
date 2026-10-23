// Exposes the host's shared singletons + internals to runtime-loaded plugin
// UMD bundles via `window.__XENTIUM_HOST__`. Plugin web bundles externalize these
// specifiers and read them from this object (see each plugin's vite.config.ts and
// the runtime loader in main.tsx). This guarantees a single React/Router/Query
// instance shared between host and plugins.
//
// MUST be imported before any plugin bundle is loaded.
import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactRouterDom from "react-router-dom";
import * as ReactQuery from "@tanstack/react-query";
import * as FaReactNs from "@fortawesome/react-fontawesome";
import { FontAwesomeIcon as StyledFaIcon } from "../components/Icon";
import * as ReactI18next from "react-i18next";
import * as Zod from "zod";

import * as webApi from "@web/lib/api";
import * as webSwal from "@web/lib/swal";
import * as webUseAuth from "@web/hooks/useAuth";
import * as webSlotRegistry from "@web/plugins/slotRegistry";
import * as webPluginI18n from "@web/plugins/pluginI18n";
import * as webLayoutWidgetOutlet from "@web/plugins/LayoutWidgetOutlet";
import * as webAuthStore from "@web/lib/authStore";
import * as webUserAvatar from "@web/components/UserAvatar";
import * as webUsername from "@web/components/Username";
// A group's rank: its uploaded rank image when the site shows images, else the badge
// the plugin passes in. Wrap the pill: `<RankBadge groupKey label>{pill}</RankBadge>`.
import * as webRankBadge from "@web/components/RankBadge";
// Badges (ADR-0009). Exposed so a PLUGIN's user card adopts awards with one line
// and no payload change of its own — the component fetches (batched) and draws
// them itself. The alternative is every card selecting badge rows in its own
// query, which for the forum means editing raw SQL in a paid plugin.
import * as webUserBadges from "@web/components/UserBadges";
// An icon stored as DATA — a block prop an admin picked, a badge glyph. Exposed
// because a plugin block that declares `format: "icon"` gets the editor's picker
// for free but has nothing to DRAW the token with: resolving pinned style →
// site style → bundled fallback is this component's job, not the plugin's.
import * as webTokenIcon from "@web/components/TokenIcon";
import * as webIconPicker from "@web/components/IconPicker";
import * as webEditorDialog from "@web/components/EditorDialog";
import * as webMiniEditor from "@web/components/MiniEditor";
import * as webForumEditor from "@web/components/ForumEditor";
// The composer itself, for a plugin page that wants a variant or the tools on top
// (the forum's thread composer does). `webMiniEditor` / `webForumEditor` stay as the
// adapters shipped bundles already import.
import * as webComposer from "@web/components/composer/Composer";
import * as webRichHtml from "@web/components/RichHtml";
import * as webWarnTemplateSelect from "@web/components/WarnTemplateSelect";
import * as webConsent from "@web/lib/consent";
import * as webConsentGate from "@web/components/ConsentGate";
import * as webUseAutosave from "@web/hooks/useAutosave";
// ACP drafts and the save bar. `webUseAutosave.useAutosave` is the same hook under its
// old name, so shipped plugin panels joined the save bar without a rebuild.
import * as webUseDraft from "@web/hooks/useDraft";
import * as webAutosaveStatus from "@web/components/AutosaveStatus";
// The canonical autosave indicator. `webAutosaveStatus` is an alias for it and
// stays exposed because existing plugin bundles import that name.
import * as webSaveChip from "@web/components/SaveChip";
// The ACP's own form controls. Exposed so a plugin's admin surface is built from
// the SAME components as core's, rather than re-implementing them in inline
// styles and drifting on weight, size and spacing.
//
// `AcpIcon` is deliberately NOT here: it lives under `features/`, which the
// `@web/*` alias does not cover, and inventing a namespace for one icon set is
// not worth it — plugins already have FontAwesome through `FaReact`.
import * as webAcpControls from "@web/components/AcpControls";
import * as webDateTime from "@web/lib/datetime";
import * as webToast from "@web/lib/toast";
import * as webDialog from "@web/lib/dialog";
// Exposed from day one (ADR-0005) even though no plugin registers a block yet:
// retrofitting a registry into a public API later is far more expensive than
// shipping it as one now.
import * as webBlockRegistry from "@web/layout/blockRegistry";
// Layout templates (Amendment 3). Both halves are required and neither is optional:
// a plugin registers its template through the registry and renders it through the
// renderer, and both must be the HOST's copies — a plugin that bundled its own would
// register into a Map nothing reads and render from a registry nothing wrote to.
import * as webLayoutTemplateRegistry from "@web/layout/templateRegistry";
import * as webLayoutRenderer from "@web/layout/LayoutRenderer";
// `useLayoutDocument` — a plugin's page component is a HOST container like core's:
// it resolves the document, resolves its own data, and hands both to the renderer.
import * as webUseLayout from "@web/layout/useLayout";
// Edge art. The registry is where a plugin adds shapes and draws edges itself; the
// drawing module is what it builds from (`edgeMask`, `edgePlacement`…), so a plugin's
// edge sits exactly where core's would. Both MUST be the host's copies — a bundled
// registry is a Map nothing reads.
import * as webEdgeRegistry from "@web/layout/edgeRegistry";
import * as webEdgeArt from "@web/layout/edgeArt";
import { hostEvents } from "./hostEvents";
import { usePublicPluginSettings } from "./pluginSettings";
import { Uploader } from "../components/Uploader";

const HOST = {
  React,
  ReactJsxRuntime,
  ReactRouterDom,
  ReactQuery,
  /**
   * ⚠ `FontAwesomeIcon` is SWAPPED for core's wrapper, so every plugin follows the
   * site's icon style with no plugin change and no rebuild. Plugins externalise
   * this module (see any plugin's vite.config), which makes this one line the
   * difference between "core is Pro and the forum is not" and a consistent app.
   */
  FaReact: { ...FaReactNs, FontAwesomeIcon: StyledFaIcon },
  ReactI18next,
  webApi,
  webSwal,
  webUseAuth,
  webSlotRegistry,
  webPluginI18n,
  webLayoutWidgetOutlet,
  webAuthStore,
  webUserAvatar,
  webUsername,
  webRankBadge,
  webUserBadges,
  webTokenIcon,
  webIconPicker,
  webEditorDialog,
  webMiniEditor,
  webForumEditor,
  webComposer,
  webRichHtml,
  webWarnTemplateSelect,
  webConsent,
  webConsentGate,
  webUseAutosave,
  webUseDraft,
  webAutosaveStatus,
  webSaveChip,
  webAcpControls,
  // Dates and times in the site's zone and format (ACP → System Settings). A plugin
  // reads it off the host at runtime and falls back to the browser's own format when
  // an older host lacks it.
  webDateTime,
  webToast,
  webDialog,
  webBlockRegistry,
  webLayoutTemplateRegistry,
  webLayoutRenderer,
  webUseLayout,
  webEdgeRegistry,
  webEdgeArt,
  // Drag-and-drop uploads with progress, to an add-on's own route (core 1.0.0).
  webUploader: { Uploader },
  // An add-on's public settings in its own pages (core 1.0.0): `webPluginSettings.usePublic(id)`.
  webPluginSettings: { usePublic: usePublicPluginSettings, usePublicPluginSettings },
  // Browser events (core 1.0.0): `events.on("route.changed" | "auth.changed", fn)` → unsubscribe.
  events: { on: hostEvents.on },
  // The schema library block props are written in (core 1.0.0-alpha.19+). A plugin that
  // only needs it for a block schema can use this copy instead of bundling its own,
  // which keeps its bundle small; check for it, since older hosts lack it.
  Zod,
};

declare global {
  interface Window {
    __XENTIUM_HOST__?: typeof HOST;
  }
}

window.__XENTIUM_HOST__ = HOST;

export {};
