import { useTranslation } from "react-i18next";
import { withTheme } from "../../../lib/editingTheme";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import type { ScopedTokenSet, ScopedTokens } from "@xentium/contracts";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { refreshTokenCss } from "../../../lib/liveStyle";
import { Username } from "../../../components/Username";
import { tokenLabel, type Translate } from "../pages/styleTokens";
import "../pages/StyleEditorPage.scss";

interface StyleHistoryEntry {
  id: string;
  label: string;
  createdAt: string;
  tokens?: ScopedTokenSet;
  savedBy: { id: string; username: string; badgeColor: string | null };
}

function timeLabel(d: string) {
  return new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Every `scope|var` pair a snapshot holds, flattened so two can be compared.
 *
 * ⚠ A snapshot taken before a site had ONE look is a `{light, dark}` pair. `light` and
 * `dark` are not scope names, so their presence at the top level identifies that shape
 * — and the light half is what a one-look site would restore, so it is the half compared.
 */
function flatten(set: ScopedTokenSet | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = (set ?? {}) as Record<string, unknown>;
  const buckets: ScopedTokens = ("light" in raw || "dark" in raw)
    ? ((raw.light as ScopedTokens | undefined) ?? {})
    : (raw as ScopedTokens);
  for (const [scope, map] of Object.entries(buckets)) {
    for (const [cssVar, value] of Object.entries(map ?? {})) out[`${scope}|${cssVar}`] = value;
  }
  return out;
}

/**
 * What changed between a snapshot and the one before it.
 *
 * The stored `label` is a timestamp, which tells an admin nothing about whether the
 * entry is the one they want to restore. The snapshots themselves know — every entry
 * carries its full token set — so the summary is derived rather than stored, and the
 * oldest entry (which has no predecessor) reports its size instead.
 */
function summarise(
  entry: StyleHistoryEntry,
  older: StyleHistoryEntry | undefined,
  t: Translate,
): string {
  const now = flatten(entry.tokens);
  if (!older) return t("styleHistory.sumInitial", { count: Object.keys(now).length }) as string;
  const before = flatten(older.tokens);
  const keys = new Set([...Object.keys(now), ...Object.keys(before)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (now[k] === before[k]) continue;
    changed.push(tokenLabel(k.split("|")[1]!, t));
  }
  if (changed.length === 0) return t("styleHistory.sumNone") as string;
  const unique = [...new Set(changed)];
  const shown = unique.slice(0, 3).join(", ");
  return unique.length > 3
    ? (t("styleHistory.sumMore", { list: shown, count: unique.length - 3 }) as string)
    : shown;
}

/**
 * The style-history list — the Style Editor's History tab.
 *
 * It lived on its own ACP page (Appearance → Style history) until 2026-08-26, which
 * put the snapshots one nav level away from the editor that made them. That route
 * now redirects here. Kept as its own component because a snapshot list is a
 * self-contained thing, not because a second surface renders it.
 */
export function StyleHistoryList({ themeKey = null }: { themeKey?: string | null }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const { data: history = [], isLoading } = useQuery<StyleHistoryEntry[]>({
    queryKey: ["acp-style-history", themeKey],
    queryFn: () => api.get(withTheme("/admin/style-history", themeKey)),
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => api.post(`/appearance/history/${id}/restore`, {}),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["acp-style-history"] });
      qc.invalidateQueries({ queryKey: ["acp-tokens"] });
      qc.invalidateQueries({ queryKey: ["acp-draft-status"] });
      await refreshTokenCss();
      swalToast(t("styleHistory.toastRestored"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const handleRestore = async (h: StyleHistoryEntry) => {
    const ok = await swalConfirm(
      t("styleHistory.restoreConfirmTitle", { label: h.label }),
      t("styleHistory.restoreConfirmBody"),
      t("styleHistory.restoreConfirmBtn"),
    );
    if (ok) restoreMut.mutate(h.id);
  };

  if (isLoading)          return <div className="acp-card acp-empty">{t("styleHistory.loading")}</div>;
  if (history.length === 0) return <div className="acp-card acp-empty">{t("styleHistory.empty")}</div>;

  return (
    <div className="se-hist">
      {history.map((h, i) => {
        const current = i === 0;
        return (
          <div key={h.id} className="se-hist__row">
            <span className={`se-hist__dot${current ? " is-live" : ""}`} />
            <div className="se-hist__id">
              <div className="se-hist__t">{h.label}</div>
              <div className="se-hist__when">
                {timeLabel(h.createdAt)} · {t("styleHistory.by")}{" "}
                <Username username={h.savedBy.username} badgeColor={h.savedBy.badgeColor} />
              </div>
            </div>
            <div className="se-hist__sum">{summarise(h, history[i + 1], t)}</div>
            <span className={`se-hist__tag${current ? " is-live" : ""}`}>
              {current ? t("styleHistory.tagCurrent") : t("styleHistory.tagSnapshot")}
            </span>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={restoreMut.isPending || current}
              title={current ? t("styleHistory.currentHint") : undefined}
              onClick={() => handleRestore(h)}
            >
              <FontAwesomeIcon icon={faRotateLeft} style={{ marginRight: 4 }} />
              {t("styleHistory.restore")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
