/**
 * Who sees a block — WoltLab's box ACL, in the layout editor's settings rail.
 *
 * ## Why not `GroupAccessPicker`
 *
 * `@xentium/ui`'s picker is the shared way to express §39 visibility and it was the
 * obvious candidate, but its `GroupAccessValue` does not fit a layout block:
 *
 *  - its `level` mode needs the viewer's progression level, and `AuthUser` does not
 *    carry one — offering a mode that silently never matches is worse than not
 *    offering it;
 *  - `hideIfNoAccess` is meaningless here, because hiding is the ONLY behaviour a
 *    block has. There is no "you do not have access" state for a layout block;
 *  - it has no "guests only" mode, which is the one an admin reaches for first (a
 *    join-us call to action).
 *
 * So this is a smaller, block-specific control that deliberately reuses the same
 * vocabulary — public/members/groups — so an admin is not learning two systems.
 *
 * ## The two rules it exists to communicate
 *
 * An audience only ever NARROWS: the block's own gate still runs when the audience
 * admits the viewer. And it is presentation, not access control — which the hint
 * says out loud, because an admin will otherwise assume the opposite.
 */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  BLOCK_AUDIENCES,
  type BlockAudience,
  type BlockVisibility,
} from "@xentium/contracts";
import { api } from "../../../lib/api";

interface GroupOption { id: string; name: string; key: string }

const DEFAULT: BlockVisibility = { audience: "everyone", groups: [] };

export function BlockVisibilityFields({
  value,
  onChange,
}: {
  value: BlockVisibility | undefined;
  /** `undefined` means "everyone" — the caller stores nothing in that case. */
  onChange: (next: BlockVisibility | undefined) => void;
}) {
  const { t } = useTranslation("acp");
  const current = value ?? DEFAULT;

  const { data: groups = [] } = useQuery<GroupOption[]>({
    queryKey: ["acp-groups-list"],
    queryFn:  () => api.get<GroupOption[]>("/admin/groups"),
    // Shared with the other ACP surfaces that list groups, so switching blocks
    // re-uses the cached list rather than refetching per selection.
    staleTime: 60_000,
  });

  const setAudience = (audience: BlockAudience) =>
    onChange(audience === "everyone" ? undefined : { ...current, audience });

  const toggleGroup = (id: string) => {
    const groupIds = current.groups.includes(id)
      ? current.groups.filter((g) => g !== id)
      : [...current.groups, id];
    onChange({ audience: "groups", groups: groupIds });
  };

  return (
    <div className="lay__vis">
      <div className="lay__vis-title">{t("layoutEditor.visibility")}</div>

      {BLOCK_AUDIENCES.map((audience) => (
        <label className="lay__vis-row" key={audience}>
          <input
            type="radio"
            name="nv-block-audience"
            value={audience}
            checked={current.audience === audience}
            onChange={() => setAudience(audience)}
          />
          <span>{t(`layoutEditor.audience.${audience}`)}</span>
        </label>
      ))}

      {current.audience === "groups" && (
        <div className="lay__vis-groups">
          {groups.map((group) => (
            <label className="lay__vis-row" key={group.id}>
              <input
                type="checkbox"
                checked={current.groups.includes(group.id)}
                onChange={() => toggleGroup(group.id)}
              />
              <span>{group.name}</span>
            </label>
          ))}
          {/* Allowed rather than refused — an admin may be mid-edit — but silent
              invisibility deserves saying out loud. */}
          {current.groups.length === 0 && (
            <div className="acp-hint lay__vis-warn">{t("layoutEditor.audienceNobody")}</div>
          )}
        </div>
      )}

      <p className="acp-hint lay__vis-note">{t("layoutEditor.audienceNote")}</p>
    </div>
  );
}
