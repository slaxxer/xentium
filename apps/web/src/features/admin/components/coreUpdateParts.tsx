import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { faCheck, faCopy, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { ReleaseNotes } from "../../../components/ReleaseNotes";
import type { CoreRelease, CoreUpdate } from "./CoreUpdateCard";
import "./CoreUpdate.scss";

/**
 * The pieces the core-update dialog and the Updates card share, so the two can
 * never disagree about what changed or how to install it.
 */

export const UPDATING_GUIDE_URL = "https://doc.xentium.org/admin/updating/";

export const isPrerelease = (version: string) => version.includes("-");

/** What to install next: the stepping stone when the jump is refused, else the newest. */
export const updateTarget = (update: CoreUpdate) => update.via ?? update.latest.version;

/**
 * The commands that update THIS site, ready to paste.
 *
 * The version is always named. A bare `xentium update` installs whatever npm
 * calls `latest`, which is not a prerelease and may not be what this dialog is
 * offering. The CLI is installed first because the updater's own fixes ship in
 * it, and an older CLI cannot pick up a release it doesn't know how to install.
 * No `sudo`: the CLI asks for it itself when it restarts the service.
 */
export function updateCommands(update: CoreUpdate): string[] {
  const version = updateTarget(update);
  return [
    ...(update.siteDir ? [`cd ${update.siteDir}`] : []),
    `npm install xentium@${version}`,
    `npx xentium update ${version}`,
  ];
}

export function UpdateCommand({ update }: { update: CoreUpdate }) {
  const { t } = useTranslation("acp");
  const [copied, setCopied] = useState(false);
  const lines = updateCommands(update);
  const blocked = update.blockedBy.length > 0;

  const copy = () => {
    void navigator.clipboard?.writeText(lines.join("\n")).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="core-cmd">
      <div className="core-cmd__label">
        {blocked ? t("coreUpdate.howToBlocked") : t("coreUpdate.howTo")}
      </div>
      <div className="core-cmd__box">
        <pre className="core-cmd__code">{lines.join("\n")}</pre>
        <button type="button" className="core-cmd__copy" onClick={copy} aria-label={t("coreUpdate.copy")}>
          <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
          <span>{copied ? t("coreUpdate.copied") : t("coreUpdate.copy")}</span>
        </button>
      </div>
      <div className="core-cmd__hint">
        {!update.siteDir && <>{t("coreUpdate.howToWhere")} </>}
        {t("coreUpdate.howToAfter")}{" "}
        <a href={UPDATING_GUIDE_URL} target="_blank" rel="noopener noreferrer">{t("coreUpdate.guide")}</a>
      </div>
    </div>
  );
}

function releaseDate(iso: string | null, lang: string) {
  return iso ? new Date(iso).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" }) : null;
}

/**
 * Every release between here and the target, newest first. One release shows
 * its notes as they are; several get a version line each, because skipping
 * three releases means taking all three changelogs.
 */
export function CoreChangelog({ update }: { update: CoreUpdate }) {
  const { t, i18n } = useTranslation("acp");
  const releases: CoreRelease[] = update.path?.length ? update.path : [update.latest];
  const withNotes = releases.filter((r) => r.notes?.trim());
  if (withNotes.length === 0) return <p className="core-changelog__empty">{t("coreUpdate.noNotes")}</p>;

  return (
    <div className="core-changelog">
      {withNotes.map((r) => (
        <section key={r.version} className="core-changelog__release">
          {withNotes.length > 1 && (
            <div className="core-changelog__head">
              <span className="core-changelog__version">{r.version}</span>
              {r.severity !== "normal" && (
                <span className={`core-changelog__sev core-changelog__sev--${r.severity}`}>{t(`coreUpdate.severity.${r.severity}`)}</span>
              )}
              {r.publishedAt && <span className="core-changelog__date">{releaseDate(r.publishedAt, i18n.language)}</span>}
            </div>
          )}
          <ReleaseNotes source={r.notes!} />
        </section>
      ))}
    </div>
  );
}

/** Warnings that change what the admin should do: stepping stones, blocking plugins, manual steps. */
export function CoreUpdateWarnings({ update }: { update: CoreUpdate }) {
  const { t } = useTranslation("acp");
  const items: ReactNode[] = [];
  if (update.urgentRelease) {
    items.push(<><strong>{t(`coreUpdate.onTheWay.${update.urgentRelease.severity}`, { version: update.urgentRelease.version })}</strong></>);
  }
  if (update.via) items.push(t("coreUpdate.via", { version: update.via }));
  if (update.latest.upgradeNotes) items.push(<ReleaseNotes source={update.latest.upgradeNotes} />);
  if (update.blockedBy.length > 0) {
    items.push(
      <>
        <strong>{t("coreUpdate.blockedTitle")}</strong>
        {update.blockedBy.map((p) => <div key={p.id}>{t("coreUpdate.blockedRow", { name: p.name, supports: p.supports })}</div>)}
      </>,
    );
  }
  if (items.length === 0) return null;
  return (
    <div className="core-warn">
      {items.map((item, i) => (
        <div key={i} className="core-warn__item">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <div>{item}</div>
        </div>
      ))}
    </div>
  );
}

/** The dialog's body: the facts, what to watch out for, the changelog, how to install. */
export function CoreUpdateDialogBody({ update }: { update: CoreUpdate }) {
  const { t, i18n } = useTranslation("acp");
  const released = releaseDate(update.latest.publishedAt, i18n.language);
  return (
    <div className="core-dialog">
      <dl className="core-facts">
        <div><dt>{t("coreUpdate.dialogVersion")}</dt><dd className="is-mono">{update.current} → {update.latest.version}</dd></div>
        {released && <div><dt>{t("coreUpdate.released")}</dt><dd>{released}</dd></div>}
        {update.releaseCount > 1 && <div><dt>{t("coreUpdate.dialogBehind")}</dt><dd>{update.releaseCount}</dd></div>}
      </dl>
      {isPrerelease(update.latest.version) && <p className="core-dialog__pre">{t("coreUpdate.prereleaseNote")}</p>}
      <CoreUpdateWarnings update={update} />
      <div className="core-dialog__label">{t("coreUpdate.changelog")}</div>
      <div className="core-notes"><CoreChangelog update={update} /></div>
      <UpdateCommand update={update} />
    </div>
  );
}
