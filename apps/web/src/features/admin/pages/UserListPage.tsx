import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { BadgeRow } from "@xentium/contracts";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faBan, faUnlock, faChevronRight, faMagnifyingGlass, faUserGroup, faAward,
  faRightFromBracket, faXmark, faCheck, faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { apiErrorMessage } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { Pager } from "../../../components/Pager";
import { Avatar } from "../../../components/Avatar";
import { useAuth } from "../../../hooks/useAuth";
import {
  type Group, type ListUser, type UserCounts, BanDialog, type BanOutcome,
  RolePill, StatusPill, FlagChip, topGroup, lastSeenText,
} from "./users/usersShared";
import "./users/Users.scss";
import { Username } from "../../../components/Username";

interface PaginatedUsers {
  data: ListUser[];
  meta: { page: number; limit: number; total: number; totalPages: number };
  counts: UserCounts;
}

type StatusFilter = "all" | "active" | "banned" | "flagged";
type Sort = "recent" | "joined" | "posts" | "name";
const LIMIT = 25;

/** One request per member, and a sentence about how it went. */
async function forEachUser(
  users: { id: string; username: string }[],
  run: (u: { id: string; username: string }) => Promise<unknown>,
): Promise<BanOutcome> {
  const results = await Promise.allSettled(users.map(run));
  const out: BanOutcome = { done: [], refused: [] };
  results.forEach((r, i) => {
    const u = users[i]!;
    if (r.status === "fulfilled") out.done.push(u.username);
    else out.refused.push({ username: u.username, reason: apiErrorMessage(r.reason) });
  });
  return out;
}

/**
 * A pick-one dialog. The value is captured on change: the host unmounts the field on close.
 *
 * ⚠ It starts on an empty choice, never the first option. The first group is
 * Administrator, and a default there turned one careless click into promoting the
 * whole selection. Confirming with nothing picked does nothing.
 */
async function pickDialog(title: string, body: string, placeholder: string, options: { value: string; label: string }[], confirm: string, cancel: string) {
  let value = "";
  const ok = await openDialog({
    kind: "confirm", icon: "question", title, confirmText: confirm, cancelText: cancel,
    bodyNode: (
      <>
        <p style={{ margin: 0 }}>{body}</p>
        <select className="inp usr-pick" defaultValue="" onChange={(e) => { value = e.target.value; }}>
          <option value="" disabled>{placeholder}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </>
    ),
  });
  return ok && value ? value : null;
}

export function UserListPage() {
  const { t } = useTranslation("acp");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user: me } = useAuth();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [groupId, setGroupId] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [checked, setChecked] = useState<Map<string, ListUser>>(new Map());
  const [banTargets, setBanTargets] = useState<{ id: string; username: string }[] | null>(null);
  const debounce = useRef<number>(0);

  const { data, isLoading, isFetching } = useQuery<PaginatedUsers>({
    queryKey: ["acp-users", page, query, status, groupId, sort],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: String(LIMIT), sort });
      if (query) p.set("search", query);
      if (groupId) p.set("groupId", groupId);
      if (status !== "all") p.set("status", status);
      return api.get(`/admin/users?${p}`);
    },
    placeholderData: (prev) => prev,
  });
  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["acp-groups-list"],
    queryFn:  () => api.get<Group[]>("/admin/groups"),
  });

  // A filter change starts a new list: page 1, nothing selected.
  const refilter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); setChecked(new Map()); };
  useEffect(() => () => clearTimeout(debounce.current), []);
  function onSearch(v: string) {
    setSearch(v);
    clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => refilter(setQuery)(v.trim()), 300);
  }
  const clearFilters = () => { setSearch(""); setQuery(""); setGroupId(""); refilter(setStatus)("all"); };

  const rows = data?.data ?? [];
  const counts = data?.counts;
  const allOn = rows.length > 0 && rows.every((u) => checked.has(u.id));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["acp-users"] });
    void qc.invalidateQueries({ queryKey: ["acp-user"] });
  };

  function toggle(u: ListUser) {
    setChecked((prev) => {
      const next = new Map(prev);
      if (next.has(u.id)) next.delete(u.id); else next.set(u.id, u);
      return next;
    });
  }
  function toggleAll() {
    setChecked((prev) => {
      const next = new Map(prev);
      if (allOn) rows.forEach((u) => next.delete(u.id)); else rows.forEach((u) => next.set(u.id, u));
      return next;
    });
  }

  /** Report a batch: how many went through, and every refusal with its reason. */
  function report(out: BanOutcome, doneKey: string) {
    if (out.done.length) toast.success(t(doneKey, { count: out.done.length }));
    for (const r of out.refused) toast.error(t("users.bulk.refused", { name: r.username, reason: r.reason }));
    refresh();
  }

  const selection = [...checked.values()].map((u) => ({ id: u.id, username: u.username }));

  async function bulkGroup() {
    const g = await pickDialog(t("users.bulk.groupTitle", { count: selection.length }), t("users.bulk.groupBody"), t("users.bulk.pickGroup"),
      groups.map((x) => ({ value: x.id, label: x.name })), t("users.bulk.add"), t("common:actions.cancel"));
    if (!g) return;
    report(await forEachUser(selection, (u) => api.patch(`/admin/users/${u.id}/groups`, { add: [g] })), "users.bulk.groupDone");
  }
  async function bulkBadge() {
    let catalogue: BadgeRow[];
    try { catalogue = await qc.fetchQuery({ queryKey: ["admin-badges"], queryFn: () => api.get<BadgeRow[]>("/admin/badges") }); }
    catch (e) { toast.error(apiErrorMessage(e)); return; }
    if (!catalogue.length) { toast.info(t("users.bulk.noBadges")); return; }
    const b = await pickDialog(t("users.bulk.badgeTitle", { count: selection.length }), t("users.bulk.badgeBody"), t("users.bulk.pickBadge"),
      catalogue.map((x) => ({ value: x.id, label: x.name })), t("users.bulk.grant"), t("common:actions.cancel"));
    if (!b) return;
    report(await forEachUser(selection, (u) => api.post(`/admin/badges/${b}/award`, { userId: u.id })), "users.bulk.badgeDone");
    void qc.invalidateQueries({ queryKey: ["user-badges"] });
  }
  async function bulkLogout() {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", title: t("users.bulk.logoutTitle", { count: selection.length }),
      body: t("users.bulk.logoutBody"), confirmText: t("users.logout"), cancelText: t("common:actions.cancel"),
    });
    if (!ok) return;
    report(await forEachUser(selection, (u) => api.post(`/admin/users/${u.id}/force-logout`, {})), "users.bulk.logoutDone");
  }
  async function liftBan(u: ListUser) {
    const ok = await openDialog({
      kind: "confirm", icon: "question", title: t("users.liftTitle"),
      body: t("users.liftBody", { name: u.username }), confirmText: t("users.liftBan"), cancelText: t("common:actions.cancel"),
    });
    if (!ok) return;
    try { await api.delete(`/admin/users/${u.id}/ban`); toast.success(t("users.liftDone", { name: u.username })); refresh(); }
    catch (e) { toast.error(apiErrorMessage(e)); }
  }

  const segs: StatusFilter[] = ["all", "active", "banned", "flagged"];
  const isAdmin = (u: ListUser) => u.groups.some((g) => g.key === "admin");

  return (
    <div className="usr">
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("userList.eyebrow")}</p>
          <h1 className="pg-title">{t("nav.users")}</h1>
        </div>
        {counts && (
          <div className="usr-counts">
            <span className="usr-count"><i className="usr-dot usr-dot--ok" />{t("users.countActive", { count: counts.active })}</span>
            <span className="usr-count"><i className="usr-dot usr-dot--bad" />{t("users.countBanned", { count: counts.banned })}</span>
            {counts.flagged > 0 && (
              <button type="button" className="usr-count usr-count--flag" onClick={() => refilter(setStatus)("flagged")}>
                <FontAwesomeIcon className="usr-count__ic" icon={faTriangleExclamation} />{t("users.countFlagged", { count: counts.flagged })}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Command bar */}
      <div className="usr-bar">
        <label className="usr-search">
          <FontAwesomeIcon className="usr-search__ic" icon={faMagnifyingGlass} />
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={t("users.searchPlaceholder")} />
        </label>
        <div className="acp-seg acp-seg--auto">
          {segs.map((s) => (
            <button key={s} type="button" className={status === s ? "is-on" : ""} onClick={() => refilter(setStatus)(s)}>
              {t(`users.seg.${s}`)}
            </button>
          ))}
        </div>
        <select className="inp inp--sm usr-select" value={groupId} onChange={(e) => refilter(setGroupId)(e.target.value)}>
          <option value="">{t("userList.allRoles")}</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select className="inp inp--sm usr-select" value={sort} onChange={(e) => { setSort(e.target.value as Sort); setPage(1); }}>
          {(["recent", "joined", "posts", "name"] as Sort[]).map((s) => <option key={s} value={s}>{t(`users.sort.${s}`)}</option>)}
        </select>
        {data && counts && (
          <span className="usr-shown">{t("users.shown", { shown: data.meta.total, total: counts.total })}</span>
        )}
      </div>

      <section className="usr-table">
        <div className="usr-row usr-row--head">
          <div><button type="button" className={`usr-check${allOn ? " is-on" : ""}`} onClick={toggleAll}
            aria-label={t("users.selectAll")} disabled={!rows.length}>{allOn && <FontAwesomeIcon icon={faCheck} />}</button></div>
          <div>{t("users.col.member")}</div>
          <div className="usr-col--role">{t("users.col.role")}</div>
          <div className="usr-col--activity">{t("users.col.activity")}</div>
          <div>{t("users.col.status")}</div>
          <div className="usr-col--seen">{t("users.col.seen")}</div>
          <div className="usr-col--end">{data ? t("users.shownCount", { count: rows.length }) : ""}</div>
        </div>

        {isLoading ? (
          <div className="usr-skel">
            {[62, 48, 70, 54, 66, 44].map((w, i) => (
              <div key={i} className="usr-skel__row">
                <span className="usr-skel__ava" />
                <span className="usr-skel__lines"><i style={{ width: `${w}%` }} /><i style={{ width: `${w + 12}%` }} /></span>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="usr-empty">
            <div className="usr-empty__ic"><FontAwesomeIcon icon={faMagnifyingGlass} /></div>
            <p>{t("users.emptyTitle")}</p>
            <span>{t("users.emptyBody")}</span>
            <button type="button" className="usr-empty__btn" onClick={clearFilters}>{t("users.clearFilters")}</button>
          </div>
        ) : (
          <div className={isFetching ? "usr-rows is-fetching" : "usr-rows"}>
            {rows.map((u) => {
              const on = checked.has(u.id);
              const g = topGroup(u.groups);
              const banned = u.status === "banned";
              const protectedTarget = isAdmin(u) || u.id === me?.id;
              const activity = u.postCount + u.articleCount + u.commentCount;
              return (
                <div key={u.id} className={`usr-row${on ? " is-checked" : ""}`} onClick={() => navigate(`/admin/users/${u.id}`)}>
                  <div>
                    <button type="button" className={`usr-check${on ? " is-on" : ""}`} aria-label={t("users.select", { name: u.username })}
                      onClick={(e) => { e.stopPropagation(); toggle(u); }}>{on && <FontAwesomeIcon icon={faCheck} />}</button>
                  </div>
                  <div className="usr-member">
                    <Avatar user={{ username: u.username, avatar: u.avatar }} size={36} online={u.online} />
                    <span className="usr-member__id">
                      <span className="usr-member__line">
                        <b className="usr-member__name"><Username username={u.username} badgeColor={g?.progression?.badgeColor} /></b>
                        <FlagChip flags={u.flags} failed={u.failedSignins24h} />
                      </span>
                      <span className="usr-member__email">{u.email}</span>
                    </span>
                  </div>
                  <div className="usr-col--role"><RolePill group={g} fallback={t("userDetail.roleMember")} /></div>
                  <div className="usr-col--activity usr-activity">
                    <b>{activity > 0 ? t("users.posts", { count: activity }) : t("users.noPosts")}</b>
                    <span>{t("users.articles", { count: u.articleCount })}</span>
                  </div>
                  <div><StatusPill status={u.status} /></div>
                  <div className="usr-col--seen usr-seen">{lastSeenText(u, t)}</div>
                  <div className="usr-col--end usr-actions">
                    <button type="button" className="usr-open" onClick={(e) => { e.stopPropagation(); navigate(`/admin/users/${u.id}`); }}>
                      {t("users.open")} <FontAwesomeIcon className="usr-open__ic" icon={faChevronRight} />
                    </button>
                    {banned ? (
                      <button type="button" className="usr-ban-btn usr-ban-btn--lift" title={t("users.liftBan")}
                        onClick={(e) => { e.stopPropagation(); void liftBan(u); }}>
                        <FontAwesomeIcon icon={faUnlock} />
                      </button>
                    ) : (
                      <button type="button" className="usr-ban-btn" disabled={protectedTarget}
                        title={protectedTarget ? t("userList.adminCannotBan") : t("users.banName", { name: u.username })}
                        onClick={(e) => { e.stopPropagation(); setBanTargets([{ id: u.id, username: u.username }]); }}>
                        <FontAwesomeIcon icon={faBan} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {data && data.meta.totalPages > 1 && (
          <div className="usr-pager">
            <Pager page={page} totalPages={data.meta.totalPages} onPage={setPage}
              label={t("userList.paginationSummary", { page: data.meta.page, pages: data.meta.totalPages, count: data.meta.total })} />
          </div>
        )}
      </section>

      {/* Bulk bar — acts on the selection, which survives paging. */}
      {checked.size > 0 && (
        <div className="usr-bulk">
          <div className="usr-bulk__in">
            <span className="usr-bulk__count"><b>{checked.size}</b>{t("users.bulk.selected")}</span>
            <span className="usr-bulk__sep" />
            <button type="button" onClick={bulkGroup}><FontAwesomeIcon icon={faUserGroup} />{t("users.bulk.addToGroup")}</button>
            <button type="button" onClick={bulkBadge}><FontAwesomeIcon icon={faAward} />{t("users.bulk.grantBadge")}</button>
            <button type="button" onClick={bulkLogout}><FontAwesomeIcon icon={faRightFromBracket} />{t("users.logout")}</button>
            <button type="button" className="usr-bulk__danger" onClick={() => setBanTargets(selection)}>
              <FontAwesomeIcon icon={faBan} />{t("users.bulk.ban")}
            </button>
            <span className="usr-bulk__sep" />
            <button type="button" className="usr-bulk__x" onClick={() => setChecked(new Map())} aria-label={t("users.bulk.clear")}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </div>
      )}

      {banTargets && (
        <BanDialog
          targets={banTargets}
          onClose={() => setBanTargets(null)}
          onDone={(out) => {
            setBanTargets(null);
            report(out, "users.bulk.banDone");
            if (out.done.length) setChecked(new Map());
          }}
        />
      )}
    </div>
  );
}
