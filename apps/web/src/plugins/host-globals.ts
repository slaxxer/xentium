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

import * as webApi from "@web/lib/api";
import * as webSwal from "@web/lib/swal";
import * as webUseAuth from "@web/hooks/useAuth";
import * as webSlotRegistry from "@web/plugins/slotRegistry";
import * as webAuthStore from "@web/lib/authStore";
import * as webUserAvatar from "@web/components/UserAvatar";
import * as webMiniEditor from "@web/components/MiniEditor";
import * as webForumEditor from "@web/components/ForumEditor";
import * as webUseAutosave from "@web/hooks/useAutosave";
import * as webAutosaveStatus from "@web/components/AutosaveStatus";

const HOST = {
  React,
  ReactJsxRuntime,
  ReactRouterDom,
  ReactQuery,
  FaReact,
  webApi,
  webSwal,
  webUseAuth,
  webSlotRegistry,
  webAuthStore,
  webUserAvatar,
  webMiniEditor,
  webForumEditor,
  webUseAutosave,
  webAutosaveStatus,
};

declare global {
  interface Window {
    __NODEVO_HOST__?: typeof HOST;
  }
}

window.__NODEVO_HOST__ = HOST;

export {};
