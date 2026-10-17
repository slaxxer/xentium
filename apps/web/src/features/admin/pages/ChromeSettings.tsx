/**
 * The Settings panels for the site chrome's Header and Navbar.
 *
 * They follow the composed-header design control for control, which is why these
 * three blocks get their own panels instead of the generic schema form. Some
 * settings are PROPS (height, colour, alignment); others are STRUCTURE — where search
 * sits, whether the navbar has a small logo, which end the links sit at — and those
 * change the document's tree, so the arrangement stays the single truth.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { BlockNode } from "@xentium/contracts";
import { collectIds, findNode, newBlockId, placeBetween, type Regions } from "../../../layout/blockTree";
import { BlockBackgroundFields } from "./BlockBackground";
import "./ChromeSettings.scss";

interface Props {
  node: BlockNode;
  regions: Regions;
  /** Replace this block's props. */
  onProps: (props: Record<string, unknown>) => void;
  /** Change the tree (structure settings). */
  onTree: (next: Regions) => void;
}

function firstOfType(regions: Regions, type: string): BlockNode | undefined {
  const walk = (nodes: BlockNode[]): BlockNode | undefined => {
    for (const n of nodes) {
      if (n.type === type) return n;
      const hit = n.children && walk(n.children);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(Object.values(regions).flat());
}

function Seg<T extends string>({ value, options, onPick, label }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onPick: (v: T) => void; label: string;
}) {
  return (
    <div className="chrome-set__row">
      <span>{label}</span>
      <div className="lay__seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" title={o.title} aria-pressed={value === o.value}
            className={value === o.value ? "is-on" : ""} onClick={() => onPick(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Check({ on, label, hint, disabled, onToggle }: {
  on: boolean; label: string; hint?: string; disabled?: boolean; onToggle: () => void;
}) {
  return (
    <label className={`chrome-set__check${disabled ? " is-disabled" : ""}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={onToggle} />
      <span>
        <span>{label}</span>
        {hint && <span className="acp-hint">{hint}</span>}
      </span>
    </label>
  );
}

function Range({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div className="chrome-set__range">
      <div className="chrome-set__row"><span>{label}</span><code>{value}px</code></div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

/** "Search sits in: Masthead | Navbar | Both" — shared by the Header and the Navbar. */
function SearchPlacement({ regions, onTree }: Pick<Props, "regions" | "onTree">) {
  const { t } = useTranslation("acp");
  const header = firstOfType(regions, "header");
  const navbar = firstOfType(regions, "navbar");
  if (!header || !navbar) return null;
  const inH = !!header.children?.some((n) => n.type === "search");
  const inN = !!navbar.children?.some((n) => n.type === "search");
  const current = inH && inN ? "both" : inH ? "first" : inN ? "second" : "none";
  const place = (to: "first" | "second" | "both") => onTree(placeBetween(
    regions, "search", header.id, navbar.id, to,
    () => ({ id: newBlockId(collectIds(regions)), type: "search", props: { expanded: false } }),
  ));
  return (
    <div className="chrome-set__block">
      <div className="chrome-set__label">{t("chrome.searchIn")}</div>
      <div className="lay__seg" role="group" aria-label={t("chrome.searchIn")}>
        {(["first", "second", "both"] as const).map((o) => (
          <button key={o} type="button" aria-pressed={current === o}
            className={current === o ? "is-on" : ""} onClick={() => place(o)}>
            {t(`chrome.place.${o}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function HeaderSettings({ node, regions, onProps, onTree }: Props) {
  const { t } = useTranslation("acp");
  const p = node.props as {
    showMasthead?: boolean; height?: number; backgroundMode?: "image" | "gradient";
    logoAlign?: "left" | "center"; showTagline?: boolean; showButtons?: boolean;
    backgroundImage?: string; backgroundGradient?: string[]; backgroundAngle?: number;
  };
  const set = (patch: Record<string, unknown>) => onProps({ ...node.props, ...patch });
  const masthead = p.showMasthead !== false;
  const mode = p.backgroundMode ?? "gradient";

  return (
    <div className="chrome-set">
      <Check on={masthead} label={t("chrome.showMasthead")} hint={t("chrome.showMastheadHint")}
        onToggle={() => set({ showMasthead: !masthead })} />
      {masthead && (
        <>
          <Range label={t("chrome.mastheadHeight")} value={Math.min(320, Math.max(120, p.height ?? 200))}
            min={120} max={320} step={10} onChange={(v) => set({ height: v })} />
          <Seg label={t("chrome.background")} value={mode}
            options={[
              { value: "image", label: t("chrome.bgImage") },
              { value: "gradient", label: t("chrome.bgGradient") },
            ]}
            onPick={(v) => set({ backgroundMode: v })} />
          <BlockBackgroundFields bare only={mode}
            image={p.backgroundImage} gradient={p.backgroundGradient} angle={p.backgroundAngle}
            onChange={(patch) => set(patch)} />
          <Seg label={t("chrome.logo")} value={p.logoAlign ?? "left"}
            options={[
              { value: "left", label: t("chrome.left") },
              { value: "center", label: t("chrome.centre") },
            ]}
            onPick={(v) => set({ logoAlign: v })} />
          <Check on={p.showTagline !== false} label={t("chrome.showTagline")}
            onToggle={() => set({ showTagline: p.showTagline === false })} />
        </>
      )}
      <div className="chrome-set__label">{t("chrome.buttons")}</div>
      <Check on={p.showButtons !== false} label={t("chrome.loginAccount")}
        hint={p.showButtons === false ? t("chrome.buttonsOffHint") : undefined}
        onToggle={() => set({ showButtons: p.showButtons === false })} />
      <SearchPlacement regions={regions} onTree={onTree} />
    </div>
  );
}

export function NavbarSettings({ node, regions, onProps, onTree }: Props) {
  const { t } = useTranslation("acp");
  const p = node.props as {
    sticky?: boolean; height?: number; tone?: "theme" | "dark" | "brand" | "light"; accountAlign?: "right" | "left";
  };
  const set = (patch: Record<string, unknown>) => onProps({ ...node.props, ...patch });
  const header = firstOfType(regions, "header");
  const mastheadShown = !!header && (header.props as { showMasthead?: boolean }).showMasthead !== false;
  const links = node.children?.find((n) => n.type === "navLinks");
  const ownLogo = !!node.children?.some((n) => n.type === "logo");

  /** One child of this navbar, changed through the tree. */
  const editChild = (fn: (navbar: BlockNode) => void) => {
    const next = structuredClone(regions);
    const found = findNode(next, node.id);
    if (!found) return;
    fn(found.node);
    onTree(next);
  };

  const setLinksAlign = (align: "left" | "center" | "right") => editChild((nav) => {
    const l = nav.children?.find((n) => n.type === "navLinks");
    if (!l) return;
    // Absent = left: the default is never stored.
    if (align === "left") delete l.align; else l.align = align;
  });

  const toggleLogo = () => editChild((nav) => {
    nav.children ??= [];
    if (ownLogo) nav.children = nav.children.filter((n) => n.type !== "logo");
    else nav.children.unshift({ id: newBlockId(collectIds(regions)), type: "logo", props: { showWordmark: true } });
  });

  return (
    <div className="chrome-set">
      <Check on={p.sticky !== false} label={t("chrome.sticky")} hint={t("chrome.stickyHint")}
        onToggle={() => set({ sticky: p.sticky === false })} />
      <Range label={t("chrome.navHeight")} value={p.height && p.height > 0 ? p.height : 68}
        min={52} max={84} step={2} onChange={(v) => set({ height: v })} />
      <Seg label={t("chrome.colour")} value={p.tone ?? "theme"}
        options={[
          { value: "theme", label: t("chrome.toneTheme") },
          { value: "dark", label: t("chrome.toneDark") },
          { value: "brand", label: t("chrome.toneBrand") },
          { value: "light", label: t("chrome.toneLight") },
        ]}
        onPick={(v) => set({ tone: v })} />
      {links && (
        <Seg label={t("chrome.links")} value={links.align ?? "left"}
          options={[
            { value: "left", label: t("chrome.left") },
            { value: "center", label: t("chrome.centre") },
            { value: "right", label: t("chrome.right") },
          ]}
          onPick={setLinksAlign} />
      )}
      <Seg label={t("chrome.accountMenu")} value={p.accountAlign ?? "right"}
        options={[
          { value: "left", label: t("chrome.left") },
          { value: "right", label: t("chrome.right") },
        ]}
        onPick={(v) => set({ accountAlign: v === "right" ? undefined : v })} />
      <Check on={ownLogo || !mastheadShown} disabled={!mastheadShown}
        label={t("chrome.smallLogo")}
        hint={t(mastheadShown ? "chrome.smallLogoHint" : "chrome.smallLogoForced")}
        onToggle={toggleLogo} />
      <SearchPlacement regions={regions} onTree={onTree} />
    </div>
  );
}

/** Which blocks get a chrome panel instead of the generic form. */
export const CHROME_SETTINGS: Record<string, (p: Props) => ReactNode> = {
  header: HeaderSettings,
  navbar: NavbarSettings,
};
