/**
 * The guest landing, decomposed (ADR-0005).
 *
 * This one replaces a whole ACP page. `Appearance → Guest Home` existed to edit the
 * hero's badge, title, subtitle and calls to action, plus which sections showed —
 * a second appearance editor for exactly one page, written before the layout editor
 * could do the job. Those strings are **block props** now, so the same form is
 * generated from the Zod schema, in the place an admin already goes to arrange the
 * page. A section toggle becomes "is the block placed".
 *
 * ## Why there are container blocks here
 *
 * Every guest style is nested inside `.guest-home` in the stylesheet, and `.ghero`
 * and `.gbody` are styled grids whose children are their tracks. Sibling blocks would
 * lose the scope and the grids both. So the surface and the two grids are containers —
 * the same shape `profileCard` uses — and the movable pieces sit inside them. That
 * also means the 400-line stylesheet needed no rewrite.
 *
 * ## Why the surface owns the gate
 *
 * Clicking a locked item as a guest raises a prompt to sign up. The feed triggers it
 * and the toast displays it, so with the two split apart the state has to live above
 * both: `guestSurface` holds it and hands `gate` down through context. It is not the
 * app-wide toast system deliberately — this one carries a "Sign up free" action and
 * belongs to the landing page's own conversion flow.
 */
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { blockPropSchemas, type LocalizedText } from "@xentium/contracts";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { articleCategoriesApi, articlesApi } from "../../lib/articlesApi";
import { Avatar } from "../../components/Avatar";
import { registerBlock, type BlockProps } from "../blockRegistry";
import { resolveImageSource } from "./coreBlocks";
import { Username } from "../../components/Username";
import {
  ArticleFeed,
  DEFAULT_CONFIG,
  GATE_COPY,
  Icon,
  MergedFeed,
  Rail,
  type GuestConfig,
  type OnlineData,
  type PopularTag,
  type Stats,
} from "../../pages/GuestHome";

/** Blocks that only make sense on the landing, which the home template renders. */
const ON_HOME: { allowedTemplates: string[] } = { allowedTemplates: ["home"] };

// ── Shared data ─────────────────────────────────────────────────────────────
// Each block asks for what it needs. React Query dedupes by key, so the stats the
// hero and the presence panel both want is one request — the same reason the member
// home cards keep their own queries instead of threading a context.

const useStats = () =>
  useQuery<Stats>({ queryKey: ["guest-stats"], queryFn: () => api.get("/home/stats") }).data;

const useOnline = () =>
  useQuery<OnlineData>({
    queryKey: ["online-count"], queryFn: () => api.get("/online"), refetchInterval: 60_000,
  }).data;

/**
 * Feed sources stay a SETTING, not a block prop.
 *
 * Which sources the merged feed pulls from is a content decision — it names plugin
 * feed sources that may not exist on another install — and a prop would put it in the
 * layout document, where a theme could carry it to a site that has no such source.
 */
const useFeedSources = (): string[] =>
  useQuery<GuestConfig>({
    queryKey: ["guest-config"], queryFn: () => api.get("/home/guest-config"),
  }).data?.sources ?? DEFAULT_CONFIG.sources;

// ── Gate ────────────────────────────────────────────────────────────────────

const GateContext = createContext<(kind: string) => void>(() => {});

/** Resolve a `LocalizedText`: an admin's literal, or a core default's i18n key. */
function useText(value: LocalizedText | undefined): string {
  const { t } = useTranslation();
  if (value == null) return "";
  if (typeof value === "string") return value;
  return t(value.key, { ns: value.ns }) as string;
}

// ── Surface ─────────────────────────────────────────────────────────────────

function GuestSurface({ children }: { children?: React.ReactNode }) {
  const [toast, setToast] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  const gate = useCallback((kind: string) => {
    setToast(GATE_COPY[kind] ?? GATE_COPY.default!);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4200);
  }, []);

  return (
    <GateContext.Provider value={gate}>
      {/* The class is load-bearing: every guest style is scoped under it. */}
      <div className="guest-home">
        {children}
        <div className={`gtoast${toast ? " is-show" : ""}`}>
          <Icon name="sparkles" size={18} />
          <b>{toast || ""}</b>
          <button onClick={() => { setToast(""); navigate("/register"); }}>Sign up free</button>
        </div>
      </div>
    </GateContext.Provider>
  );
}

registerBlock({
  type:      "guestSurface",
  schema:    blockPropSchemas.guestSurface,
  container: true,
  editorMeta: { surface: true, label: "Guest landing", category: "structure", ...ON_HOME },
  component: ({ children }) => <GuestSurface>{children}</GuestSurface>,
});

// ── Hero ────────────────────────────────────────────────────────────────────

registerBlock({
  type:      "guestHero",
  schema:    blockPropSchemas.guestHero,
  container: true,
  editorMeta: { surface: true, label: "Hero panel", category: "structure", ...ON_HOME },
  // A two-track grid; its children ARE the tracks.
  component: ({ props, children }: BlockProps<{ backgroundImage: string; overlay: string }>) => {
    const bg = props.backgroundImage.trim();
    return (
      <section
        className={`ghero${bg ? " ghero--image" : ""} ghero--overlay-${props.overlay}`}
        // Inline because the value is an admin's own image, not a design decision —
        // a token would be wrong here, and there is nothing to theme.
        style={bg ? { backgroundImage: `url("${encodeURI(resolveImageSource(bg))}")` } : undefined}
      >
        {children}
      </section>
    );
  },
});

function GuestHeroText({ props }: BlockProps<{
  badge: LocalizedText; title: LocalizedText; subtitle: LocalizedText;
  ctaPrimary: LocalizedText; ctaSecondary: LocalizedText; showStats: boolean;
}>) {
  const navigate = useNavigate();
  const stats = useStats();
  const online = useOnline();

  const badge = useText(props.badge);
  const title = useText(props.title);
  const ctaPrimary = useText(props.ctaPrimary);
  const ctaSecondary = useText(props.ctaSecondary);
  // `{members}` is substituted rather than concatenated so word order stays the
  // translator's choice.
  const subtitle = useText(props.subtitle).replace("{members}", String(stats?.members ?? 0));

  return (
    <div className="ghero__lead">
      <span className="ghero__badge"><i />{online?.total ?? 0} {badge}</span>
      <h1 className="ghero__title">{title}</h1>
      <p className="ghero__sub">{subtitle}</p>
      <div className="ghero__cta">
        <button className="btn btn--primary btn--lg" onClick={() => navigate("/register")}>
          {ctaPrimary} <Icon name="arrowRight" size={17} />
        </button>
        <button className="btn btn--outline btn--lg"
          onClick={() => document.querySelector(".gbody")?.scrollIntoView({ block: "start", behavior: "smooth" })}>
          {ctaSecondary}
        </button>
      </div>
      {props.showStats && (
        <div className="ghero__stats">
          <div className="gstat"><div className="gstat__n">{stats?.members ?? 0}</div><div className="gstat__l">Members</div></div>
          <div className="gstat"><div className="gstat__n">{stats?.articles ?? 0}</div><div className="gstat__l">Posts</div></div>
          <div className="gstat"><div className="gstat__n">{stats?.today ?? 0}</div><div className="gstat__l">New today</div></div>
        </div>
      )}
    </div>
  );
}

registerBlock({
  type:   "guestHeroText",
  schema: blockPropSchemas.guestHeroText,
  editorMeta: { label: "Hero text & buttons", category: "content", ...ON_HOME },
  component: GuestHeroText,
});

registerBlock({
  type:   "guestPresence",
  schema: blockPropSchemas.guestPresence,
  editorMeta: { label: "Happening right now", category: "data", ...ON_HOME },
  component: ({ props }: BlockProps<{ rows: number }>) => {
    const recent = useQuery({
      queryKey: ["guest-recent"],
      queryFn: () => articlesApi.list({ page: 1, limit: 3, feed: "latest" }),
    }).data?.data ?? [];
    // Nothing to show is nothing rendered — an empty "live" panel reads as broken.
    if (recent.length === 0) return null;
    return (
      <div className="ghero__side">
        <div className="gpresence">
          <div className="gpresence__head"><b>Happening right now</b><span className="gpresence__live"><i />Live</span></div>
          {recent.slice(0, props.rows).map((a) => (
            <div className="gpresence__row" key={a.id}>
              <Avatar user={{ username: a.author.username, avatar: a.author.avatar }} size={38} />
              <div className="gpresence__txt">
                <b><Username username={a.author.username} badgeColor={a.author.badgeColor} /></b><span>posted in {a.category?.name ?? "the community"}</span>
              </div>
              <span className="gpresence__dot" />
            </div>
          ))}
        </div>
      </div>
    );
  },
});

// ── Body ────────────────────────────────────────────────────────────────────

registerBlock({
  type:      "guestBody",
  schema:    blockPropSchemas.guestBody,
  container: true,
  editorMeta: { label: "Guest body", category: "structure", ...ON_HOME },
  component: ({ children }) => <div className="gbody">{children}</div>,
});

registerBlock({
  type:   "guestFeed",
  schema: blockPropSchemas.guestFeed,
  editorMeta: { label: "Guest feed", category: "data", ...ON_HOME, wide: true },
  component: ({ props }: BlockProps<{ showCategories: boolean }>) => {
    const gate = useContext(GateContext);
    const sources = useFeedSources();
    const stats = useStats();
    const categories = useQuery({
      queryKey: ["article-categories"], queryFn: () => articleCategoriesApi.tree(),
    }).data ?? [];

    // One source and it is articles → the richer article feed; anything else is a
    // merge across plugin-contributed sources.
    return sources.length === 1 && sources[0] === "articles"
      ? <ArticleFeed onGate={gate} categories={categories}
          totalArticles={stats?.articles} showCategories={props.showCategories} />
      : <MergedFeed sources={sources} onGate={gate} />;
  },
});

registerBlock({
  type:   "guestRail",
  schema: blockPropSchemas.guestRail,
  editorMeta: { surface: true, label: "Guest rail", category: "data", ...ON_HOME },
  component: ({ props }: BlockProps<{
    showCategories: boolean; showOnline: boolean; showTags: boolean;
  }>) => {
    const navigate = useNavigate();
    const online = useOnline();
    const categories = useQuery({
      queryKey: ["article-categories"], queryFn: () => articleCategoriesApi.tree(),
    }).data ?? [];
    const tags = useQuery<PopularTag[]>({
      queryKey: ["popular-tags"], queryFn: () => articlesApi.popularTags(),
    }).data ?? [];

    return (
      <Rail
        onRegister={() => navigate("/register")}
        onLogin={() => navigate("/login")}
        categories={categories}
        online={online}
        tags={tags}
        // `Rail` still takes the old `sections` shape; the toggles that used to be
        // one setting are per-block props now. `stats`/`presence` are not its
        // business — those are their own blocks.
        sections={{
          stats: false, presence: false,
          categories: props.showCategories, online: props.showOnline, tags: props.showTags,
        }}
      />
    );
  },
});
