// Exposes the host's shared singletons + internals to runtime-loaded plugin
// UMD bundles via `window.__NODEVO_HOST__`. Plugin web bundles externalize these
// specifiers and read them from this object (see each plugin's vite.config.ts and
// the runtime loader in main.tsx). This guarantees a single React/Router/Query
// instance shared between host and plugins.
//
// MUST be imported before any plugin bundle is loaded.
import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactRouterDom from "react-router-dom";
import * as ReactQuery from "@tanstack/react-query";
import * as FaReact from "@fortawesome/react-fontawesome";
import * as ReactI18next from "react-i18next";

import * as webApi from "@web/lib/api";
import * as webSwal from "@web/lib/swal";
import * as webUseAuth from "@web/hooks/useAuth";
import * as webSlotRegistry from "@web/plugins/slotRegistry";
import * as webPluginI18n from "@web/plugins/pluginI18n";
import * as webLayoutWidgetOutlet from "@web/plugins/LayoutWidgetOutlet";
import * as webAuthStore from "@web/lib/authStore";
import * as webUserAvatar from "@web/components/UserAvatar";
import * as webUsername from "@web/components/Username";
import * as webMiniEditor from "@web/components/MiniEditor";
import * as webForumEditor from "@web/components/ForumEditor";
import * as webUseAutosave from "@web/hooks/useAutosave";
import * as webAutosaveStatus from "@web/components/AutosaveStatus";
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

const HOST = {
  React,
  ReactJsxRuntime,
  ReactRouterDom,
  ReactQuery,
  FaReact,
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
  webMiniEditor,
  webForumEditor,
  webUseAutosave,
  webAutosaveStatus,
  webToast,
  webDialog,
  webBlockRegistry,
  webLayoutTemplateRegistry,
  webLayoutRenderer,
  webUseLayout,
};

declare global {
  interface Window {
    __NODEVO_HOST__?: typeof HOST;
  }
}

window.__NODEVO_HOST__ = HOST;

export {};
