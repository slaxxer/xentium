/**
 * The sticky save bar: what is unsaved, and the two things you can do about it.
 *
 * ⚠ It counts CHANGED FIELDS, not edits. The count comes from diffing the form
 * against what was loaded, so typing and then typing it back says "no unsaved
 * changes" — a counter that incremented per keystroke would claim 40 changes for
 * one sentence, and an admin cannot act on that number.
 *
 * ⚠ Only the tabs that hold typed values use this (Profile, Privacy). A switch or a
 * theme picker takes effect the moment it is clicked, and a bar asking you to
 * confirm a switch you already flipped is worse than no bar: it makes the live
 * state of the site look unsaved. Those tabs show `<SavedChip>` instead.
 */
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faCheck, faCircleCheck } from "@fortawesome/free-solid-svg-icons";

export function SaveBar({
  dirty, saving, onSave, onDiscard,
}: {
  dirty: number; saving?: boolean; onSave: () => void; onDiscard: () => void;
}) {
  const { t } = useTranslation("account");
  if (dirty === 0) return null;

  return (
    <div className="acct-savebar" role="status">
      <span className="acct-savebar__state">
        <i />
        {t("save.unsaved", { count: dirty })}
      </span>
      <span className="acct-savebar__acts">
        <button type="button" className="acct-btn" onClick={onDiscard} disabled={saving}>
          {t("save.discard")}
        </button>
        <button type="button" className="acct-btn acct-btn--primary" onClick={onSave} disabled={saving}>
          <FontAwesomeIcon className="acct-ic" icon={faCheck} />
          {saving ? t("save.saving") : t("save.save")}
        </button>
      </span>
    </div>
  );
}

/** For a tab whose controls apply the moment they are used. */
export function SavedChip({ label }: { label?: string }) {
  const { t } = useTranslation("account");
  return (
    <p className="acct-savedchip">
      <FontAwesomeIcon className="acct-ic" icon={faCircleCheck} />
      {label ?? t("save.auto")}
    </p>
  );
}
