import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faTriangleExclamation, faServer } from "@fortawesome/free-solid-svg-icons";
import { CoreChangelog, CoreUpdateWarnings, UpdateCommand } from "./coreUpdateParts";

/**
 * "There is a newer Xentium."
 *
 * Deliberately its own card above the plugin list, not a row inside it: core is
 * the thing the plugins run ON, its severity is decided differently, and the
 * question an admin asks about it ("is this safe to do right now?") is answered
 * by things no plugin row has — how many releases are in between, whether an
 * installed plugin refuses the target version, and whether the jump has to be
 * taken in two steps.
 *
 * ⚠ It shows the severity of the WHOLE PATH, not of the newest release. An
 * install three versions behind whose newest offer is a feature release may
 * still have a security fix waiting in between, and that is the fact that
 * decides whether this can wait until next month.
 */

export interface CoreRelease {
  version: string;
  severity: "normal" | "security" | "critical";
  publishedAt: string | null;
  notes: string | null;
  upgradeNotes: string | null;
}

export interface CoreUpdate {
  current: string;
  latest: CoreRelease;
  highestSeverity: "normal" | "security" | "critical" | null;
  /** The release ON THE WAY that the severity actually comes from, when it is
   *  not the newest one. Null when the newest release is itself the urgent one. */
  urgentRelease: CoreRelease | null;
  releaseCount: number;
  via: string | null;
  blockedBy: Array<{ id: string; name: string; supports: string }>;
  checkedAt: string;
  /** The newest release on our own minor. Equal to `latest` when the only thing
   *  waiting is a patch — which is the one core update that must never
   *  interrupt anybody. */
  patch: CoreRelease | null;
  acknowledged: boolean;
  /** Every release between here and `latest`, newest first. */
  path: CoreRelease[];
  /** The site directory of a CLI install, for a command that pastes as is. Null on a clone. */
  siteDir: string | null;
}

export function CoreUpdateCard({ update }: { update: CoreUpdate }) {
  const { t } = useTranslation("acp");
  const urgent = update.highestSeverity === "security" || update.highestSeverity === "critical";
  const accent = urgent ? "var(--c-danger)" : "var(--c-update, var(--c-accent))";

  return (
    <div
      className="acp-card"
      style={{
        padding: "20px 24px", display: "flex", alignItems: "flex-start", gap: 16,
        flexWrap: "wrap", marginBottom: 12,
        border: `1px solid color-mix(in srgb, ${accent} ${urgent ? 45 : 28}%, transparent)`,
      }}
    >
      <div style={{
        width: 44, height: 44, flexShrink: 0, fontSize: 20, color: accent,
        background: `color-mix(in srgb, ${accent} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} 34%, transparent)`,
        borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <FontAwesomeIcon icon={urgent ? faTriangleExclamation : faServer} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)" }}>{t("coreUpdate.title")}</span>
          <span style={{ fontSize: 12.5, color: "var(--c-fg-muted)", fontFamily: "var(--ff-mono, monospace)" }}>
            {update.current} → {update.latest.version}
          </span>
          {update.highestSeverity && update.highestSeverity !== "normal" && (
            <span style={{
              display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100,
              fontSize: 11, fontWeight: 700, color: accent,
              background: `color-mix(in srgb, ${accent} 18%, transparent)`,
            }}>
              {t(`coreUpdate.severity.${update.highestSeverity}`)}
            </span>
          )}
          {update.releaseCount > 1 && (
            <span style={{ fontSize: 12, color: "var(--c-fg-subtle)" }}>
              {t("coreUpdate.releasesBehind", { count: update.releaseCount })}
            </span>
          )}
        </div>

        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 12 }}>
          <CoreUpdateWarnings update={update} />
          <div className="core-notes"><CoreChangelog update={update} /></div>
          {/* The web process must never replace its own code, so there is no
              button here yet: applying an update is the job of a root-owned
              updater the API can only ask, and only read the progress of. Until
              that ships, the honest answer is the command that already does it. */}
          <UpdateCommand update={update} />
        </div>
      </div>
    </div>
  );
}
