/**
 * Layout template registry — the WEB half (ADR-0005 Amendment 3).
 *
 * The registry itself lives in `@nodevo/contracts`, next to the document schema and
 * the core template set, because the API and the browser need exactly the same
 * answers to "what regions does this template have" and "what does it render before
 * anybody arranges it". This module is the surface a PLUGIN uses, and it exists for
 * one reason worth stating plainly:
 *
 * ⚠ A plugin bundle must register through here, not by importing `@nodevo/contracts`
 * itself. Plugin bundles externalize `@web/*` onto `window.__NODEVO_HOST__` and bundle
 * everything else. Importing contracts directly gives the plugin its OWN copy of the
 * module — its own Map — and the renderer, which reads the host's copy, would never
 * see the template. It would fail silently and look like a rendering bug.
 *
 * Same rule and same reason as `blockRegistry`, which plugins already use this way.
 */
export {
  registerTemplate,
  deregisterTemplatesFor,
  getTemplate,
  listTemplates,
  templateKeys,
  isKnownTemplate,
  regionsFor,
  requiredBlocksFor,
  defaultLayoutFor,
  type TemplateDefinition,
} from "@nodevo/contracts";
