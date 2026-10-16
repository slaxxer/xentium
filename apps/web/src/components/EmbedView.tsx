/**
 * Draws one plugin embed (a poll) from its placeholder: the renderer the owning
 * plugin registered (`slotRegistry.registerEmbed`), or a quiet note when that
 * plugin is not enabled. A renderer that crashes takes only itself down, never
 * the post or article around it.
 */
import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { slotRegistry } from "../plugins/slotRegistry";

class EmbedBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function EmbedView({ type, id }: { type: string; id: string }) {
  const { t } = useTranslation("common");
  const slot = slotRegistry.getEmbed(type);
  const fallback = <p className="xt-embed__missing">{t("embed.unavailable")}</p>;
  if (!slot) return fallback;
  const Render = slot.component;
  return <EmbedBoundary fallback={fallback}><Render id={id} /></EmbedBoundary>;
}
