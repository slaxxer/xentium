import { useTranslation } from "react-i18next";
import { faPuzzlePiece, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../../components/Icon";
import { SaveChipHost } from "../../../../components/AutosaveStatus";
import { slotRegistry, type GroupConfigPanelSlot } from "../../../../plugins/slotRegistry";
import { RouteErrorBoundary } from "../../../errors/ErrorBoundary";
import type { Group } from "./groupModel";

// A plugin's groupConfigPanel, as a tab of the group page. Core draws the frame
// and says where the panel came from; the plugin draws everything inside it
// and saves on its own (docs/plugin-acp-autosave.md), reporting into the
// page's indicator through useReportSaving.

export function PluginPanelTab({ panel, group, onLadder, onOpenProgression }: {
  panel: GroupConfigPanelSlot; group: Group; onLadder: boolean; onOpenProgression: () => void;
}) {
  const { t } = useTranslation("acp");
  const owner = slotRegistry.ownerOf(panel.id) ?? panel.id;
  const Panel = panel.component;

  return (
    <div className="gp-grid">
      <section className="gp-card gp-pad">
        <div className="gp-plugin-title">
          <FontAwesomeIcon icon={faPuzzlePiece} />
          <h2 className="gp-section">{panel.label}</h2>
          <span className="gp-plugin-chip">{owner}</span>
        </div>
        {!onLadder && (
          <div className="gp-warn">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            <span>
              {t("groups.plugin.offLadder")}{" "}
              <button type="button" className="gp-link" onClick={onOpenProgression}>{t("groups.tabs.progression")}</button>
            </span>
          </div>
        )}
        {/* A plugin that throws must not take the group page with it. */}
        <RouteErrorBoundary variant="inline">
          <SaveChipHost>
            <Panel groupId={group.id} groupName={group.name} />
          </SaveChipHost>
        </RouteErrorBoundary>
      </section>

      <aside className="gp-card gp-pad gp-aside">
        <h2 className="gp-section">{t("groups.plugin.sourceTitle")}</h2>
        <p className="gp-hint">{t("groups.plugin.source", { plugin: owner })}</p>
        <p className="gp-hint">{t("groups.plugin.disable", { plugin: owner })}</p>
      </aside>
    </div>
  );
}
