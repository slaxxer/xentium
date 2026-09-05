/**
 * The members page, decomposed (ADR-0005).
 *
 * Same recipe as `profileBlocks.tsx`: the host resolves data and interaction state,
 * each piece styles only itself, and arrangement is the generic `columns`/`column`
 * containers. The old `.mp-pagehead` and `.mp-dir` wrappers were flex/grid rows whose
 * halves are now separate blocks, so the rows moved into the layout document — which
 * is why the default places them in weighted columns and reproduces the same picture.
 *
 * ## The view blocks gate themselves
 *
 * `membersFilters`/`membersList`, `membersTeam` and the hall-of-fame trio belong to
 * what used to be three tabs. Each renders only when the host says its view is
 * active — `context.show` — because the admin arranges WHERE a block sits and the
 * block owns WHETHER it appears. The host derives `show` from the layout plus the
 * current tab, so removing the tab switcher shows everything placed instead of
 * stranding it.
 */
import { useTranslation } from "react-i18next";
import { blockPropSchemas } from "@nodevo/contracts";
import { registerBlock, type BlockProps } from "../blockRegistry";
import {
  DirRow,
  PodiumSpot,
  fmt,
  type Member,
  type MembersContext,
} from "../../features/members/MembersPage";

type Ctx<P = unknown> = BlockProps<P, MembersContext>;

/** Every member block needs the directory's data, so none is placeable elsewhere. */
const ON_MEMBERS: { allowedTemplates: string[] } = { allowedTemplates: ["members"] };

// ── Head ────────────────────────────────────────────────────────────────────

// The page head is now the generic `eyebrow` + `heading` blocks, so its text is
// editable and the two halves move independently. `membersHeading` is gone.

registerBlock({
  type:   "membersTabs",
  schema: blockPropSchemas.membersTabs,
  editorMeta: { label: "Members tabs", category: "data", ...ON_MEMBERS, wide: true },
  component: ({ context }: Ctx) => (
    <div className="mp-segtabs">
      {context.tabs.map((tb) => (
        <button key={tb.id} type="button"
          className={context.tab === tb.id ? "is-on" : ""}
          onClick={() => context.setTab(tb.id)}>
          {tb.label}
        </button>
      ))}
    </div>
  ),
});

// ── Directory ───────────────────────────────────────────────────────────────

registerBlock({
  type:   "membersFilters",
  schema: blockPropSchemas.membersFilters,
  editorMeta: { label: "Search & filters", category: "data", ...ON_MEMBERS },
  component: ({ props, context }: Ctx<{ showSearch: boolean; showSort: boolean }>) => {
    const { t } = useTranslation("members");
    if (!context.show.directory) return null;
    return (
      <aside className="mp-rail">
        {props.showSearch && (
          <div className="mp-rail__search">
            <span>⌕</span>
            <input value={context.q} placeholder={t("search")}
              onChange={(e) => context.setQ(e.target.value)} />
          </div>
        )}
        <div className="mp-rail__h">{t("filterHeading")}</div>
        <nav className="mp-filters">
          {context.filters.map((f) => (
            <button key={f.id} type="button"
              className={context.filter === f.id ? "is-on" : ""}
              onClick={() => context.setFilter(f.id)}>
              {f.dot && <i className="mp-fdot" />}{f.label}<em>{f.n}</em>
            </button>
          ))}
        </nav>
        {props.showSort && (
          <>
            <div className="mp-rail__h">{t("sortHeading")}</div>
            <div className="mp-sortbox">
              {context.sorts.map((s) => (
                <button key={s.id} type="button"
                  className={context.sort === s.id ? "is-on" : ""}
                  onClick={() => context.setSort(s.id)}>{s.label}</button>
              ))}
            </div>
          </>
        )}
      </aside>
    );
  },
});

registerBlock({
  type:   "membersList",
  schema: blockPropSchemas.membersList,
  editorMeta: { label: "Member list", category: "data", ...ON_MEMBERS, wide: true },
  component: ({ props, context }: Ctx<{ showCount: boolean }>) => {
    const { t } = useTranslation("members");
    const { members, meta, facets, listLoading, q } = context;
    if (!context.show.directory) return null;
    return (
      <main className="mp-main">
        {props.showCount && (
          <div className="mp-listhead">
            <span>{t("memberCount", { count: meta?.total ?? 0 })}</span>
            <span className="mp-online">● {t("onlineCount", { n: facets?.online ?? 0 })}</span>
          </div>
        )}
        {listLoading ? (
          <div className="mp-empty">{t("loading")}</div>
        ) : members.length === 0 ? (
          <div className="mp-empty">{q ? t("emptyQuery", { query: q }) : t("emptyFilter")}</div>
        ) : (
          <div className="mp-list">{members.map((m: Member) => <DirRow key={m.id} m={m} />)}</div>
        )}
        {meta && meta.totalPages > 1 && (
          <nav className="mp-pagination">
            <button type="button" disabled={!meta.hasPrev}
              onClick={() => context.setPage((p) => p - 1)}>{t("pagination.prev")}</button>
            <span>{t("pagination.page", { page: meta.page, total: meta.totalPages })}</span>
            <button type="button" disabled={!meta.hasNext}
              onClick={() => context.setPage((p) => p + 1)}>{t("pagination.next")}</button>
          </nav>
        )}
      </main>
    );
  },
});

// ── Team ────────────────────────────────────────────────────────────────────

registerBlock({
  type:   "membersTeam",
  schema: blockPropSchemas.membersTeam,
  editorMeta: { label: "Team", category: "data", ...ON_MEMBERS },
  component: ({ props, context }: Ctx<{ showNote: boolean }>) => {
    const { t } = useTranslation("members");
    if (!context.show.team) return null;
    return (
      <>
        {props.showNote && <p className="mp-note">{t("team.note")}</p>}
        {context.teamLoading ? (
          <div className="mp-empty">{t("loading")}</div>
        ) : context.team.length === 0 ? (
          <div className="mp-empty">{t("team.empty")}</div>
        ) : (
          context.team.map((section) => (
            <section key={section.key} className="mp-teamsec">
              <div className="mp-teamsec__head">
                <h2>{t(`groups.${section.key}`, { defaultValue: section.label })}</h2>
                <span>{section.members.length}</span>
              </div>
              <main className="mp-main mp-main--full">
                <div className="mp-list">
                  {section.members.map((m) => <DirRow key={m.id} m={m} />)}
                </div>
              </main>
            </section>
          ))
        )}
      </>
    );
  },
});

// ── Hall of fame ────────────────────────────────────────────────────────────
// Three blocks rather than one, so an admin can keep the podium and drop the
// tutorial, or move the stat tiles to the page header.

registerBlock({
  type:   "membersHofStats",
  schema: blockPropSchemas.membersHofStats,
  editorMeta: { label: "Community stats", category: "data", ...ON_MEMBERS },
  component: ({ context }: Ctx) => {
    const { t } = useTranslation("members");
    if (!context.show.hof) return null;
    const stats = context.hof?.stats;
    const total = stats?.total ?? context.hof?.members.length ?? 0;
    return (
      <div className="mp-stats">
        <div className="mp-stat"><b>{fmt(total)}</b><span>{t("stats.members")}</span></div>
        <div className="mp-stat"><b className="mp-online">{fmt(stats?.online ?? 0)}</b><span>{t("stats.onlineNow")}</span></div>
        <div className="mp-stat"><b>{fmt(stats?.newThisWeek ?? 0)}</b><span>{t("stats.newThisWeek")}</span></div>
        <div className="mp-stat"><b>{fmt(stats?.totalPosts ?? 0)}</b><span>{t("stats.totalPosts")}</span></div>
      </div>
    );
  },
});

registerBlock({
  type:   "membersPodium",
  schema: blockPropSchemas.membersPodium,
  editorMeta: { label: "Podium", category: "data", ...ON_MEMBERS, wide: true },
  component: ({ context }: Ctx) => {
    const { t } = useTranslation("members");
    if (!context.show.hof) return null;
    if (context.hofLoading) return <div className="mp-empty">{t("loading")}</div>;

    const members = context.hof?.members ?? [];
    if (members.length === 0) return <div className="mp-empty">{t("hof.empty")}</div>;
    const metric = context.hof?.metric ?? "likes";

    // Ordered visually 2 · 1 · 3 so #1 sits centre and highest.
    const podium = [members[1], members[0], members[2]].filter(Boolean) as Member[];
    const places: (1 | 2 | 3)[] = [2, 1, 3];

    return (
      <div className="mp-podium-wrap">
        <div className="mp-podium-head">
          <h2>{t("hof.title")}</h2>
          <span>{t("hof.subtitle", { metric: t(`metrics.${metric}`) })}</span>
        </div>
        <div className="mp-podium">
          {podium.map((m, i) => <PodiumSpot key={m.id} m={m} place={places[i]!} metric={metric} />)}
        </div>
      </div>
    );
  },
});

registerBlock({
  type:   "membersHowTo",
  schema: blockPropSchemas.membersHowTo,
  editorMeta: { label: "How to climb", category: "data", ...ON_MEMBERS },
  component: ({ context }: Ctx) => {
    const { t } = useTranslation("members");
    if (!context.show.hof) return null;
    const metric = context.hof?.metric ?? "likes";
    return (
      <section className="mp-howto">
        <h3 className="mp-howto__title">{t("howTo.title")}</h3>
        <p className="mp-howto__intro">{t("howTo.intro", { metric: t(`metrics.${metric}`) })}</p>
        <ul className="mp-howto__list">
          <li><span>✍️</span>{t("howTo.tips.post")}</li>
          <li><span>💬</span>{t("howTo.tips.threads")}</li>
          <li><span>♥</span>{t("howTo.tips.likes")}</li>
          <li><span>⚡</span>{t("howTo.tips.active")}</li>
        </ul>
        <p className="mp-howto__foot">{t("howTo.levelUp")}</p>
      </section>
    );
  },
});
