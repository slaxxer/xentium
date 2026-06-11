import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage } from "../../../lib/swal";
import { useAutosave } from "../../../hooks/useAutosave";
import { AutosaveStatus } from "../../../components/AutosaveStatus";

interface Setting { key: string; value: unknown }

const DEFAULTS: Record<string, unknown> = {
  "guesthome.hero_badge":      "builders online now",
  "guesthome.hero_title":      "Where people who build with nodevo hang out.",
  "guesthome.hero_subtitle":   "Ask questions, show what you made, shape the roadmap, and learn from {members} makers. Reading is open to everyone.",
  "guesthome.cta_primary":     "Join the conversation",
  "guesthome.cta_secondary":   "Browse as guest",
  "guesthome.feed_sources":    ["articles"],
  "guesthome.show_stats":      true,
  "guesthome.show_presence":   true,
  "guesthome.show_categories": true,
  "guesthome.show_online":     true,
  "guesthome.show_tags":       true,
};

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div onClick={onToggle} style={{ width: 40, height: 22, flexShrink: 0, background: on ? "var(--c-accent)" : "var(--c-border)", borderRadius: 100, cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
      <div style={{ width: 16, height: 16, background: "#fff", borderRadius: "50%", position: "absolute", top: 3, left: on ? 21 : 3, transition: "left 0.2s" }} />
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, padding: "12px 0", borderTop: "1px solid var(--c-border)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, color: "var(--c-fg)", fontWeight: 500 }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: "var(--c-fg-muted)", marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

export function GuestHomePage() {
  const qc = useQueryClient();

  const { data: settings = [] } = useQuery<Setting[]>({
    queryKey: ["acp-settings"],
    queryFn: () => api.get("/admin/settings"),
  });

  const { data: config } = useQuery<{ availableSources: { id: string; label: string }[] }>({
    queryKey: ["guest-config"],
    queryFn: () => api.get("/home/guest-config"),
  });
  const availableSources = config?.availableSources ?? [{ id: "articles", label: "Articles" }];

  const [draft, setDraft] = useState<Record<string, unknown>>(DEFAULTS);

  useEffect(() => {
    if (!settings.length) return;
    const raw: Record<string, unknown> = {};
    for (const s of settings) raw[s.key] = s.value;
    setDraft((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(DEFAULTS)) if (key in raw) next[key] = raw[key];
      return next;
    });
  }, [settings.length]);

  const saveMutation = useMutation({
    mutationFn: (entries: Array<[string, unknown]>) =>
      Promise.all(entries.map(([key, value]) => api.put(`/admin/settings/${encodeURIComponent(key)}`, { value }))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-settings"] });
      qc.invalidateQueries({ queryKey: ["guest-config"] });
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const KEYS = Object.keys(DEFAULTS);
  const rawAll: Record<string, unknown> = {};
  for (const s of settings) rawAll[s.key] = s.value;
  const saved = settings.length
    ? Object.fromEntries(KEYS.map((k) => [k, k in rawAll ? rawAll[k] : DEFAULTS[k]]))
    : undefined;

  useAutosave({
    value: Object.fromEntries(KEYS.map((k) => [k, draft[k]])),
    savedValue: saved,
    onSave: (d) => saveMutation.mutate(Object.entries(d)),
  });

  const set = (key: string, value: unknown) => setDraft((p) => ({ ...p, [key]: value }));
  const str = (key: string) => String(draft[key] ?? "");
  const on  = (key: string) => Boolean(draft[key]);

  const selectedSources = (): string[] => Array.isArray(draft["guesthome.feed_sources"]) ? draft["guesthome.feed_sources"] as string[] : ["articles"];
  const toggleSource = (id: string) => {
    const cur = selectedSources();
    set("guesthome.feed_sources", cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  const textInput = (key: string) => (
    <input className="acp-input" value={str(key)} onChange={(e) => set(key, e.target.value)} style={{ width: 360 }} />
  );

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">Appearance</div>
          <h1 className="acp-page-title">Guest Home</h1>
        </div>
        <AutosaveStatus saving={saveMutation.isPending} />
      </div>

      <p style={{ fontSize: 13, color: "var(--c-fg-muted)", margin: "0 0 20px", maxWidth: 620 }}>
        The landing page logged-out visitors see. Edit the hero copy and choose which sections and
        data appear. Changes apply immediately.
      </p>

      {/* Hero */}
      <div className="acp-card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)", marginBottom: 6 }}>Hero</div>
        <div className="acp-form-field" style={{ marginTop: 8 }}>
          <label className="acp-label">Title</label>
          <input className="acp-input" value={str("guesthome.hero_title")} onChange={(e) => set("guesthome.hero_title", e.target.value)} />
        </div>
        <div className="acp-form-field">
          <label className="acp-label">Subtitle</label>
          <textarea className="acp-input" rows={3} style={{ resize: "vertical", fontFamily: "inherit" }}
            value={str("guesthome.hero_subtitle")} onChange={(e) => set("guesthome.hero_subtitle", e.target.value)} />
          <div style={{ fontSize: 11.5, color: "var(--c-fg-muted)", marginTop: 4 }}>
            Use <code>{"{members}"}</code> to insert the live member count.
          </div>
        </div>
        <Row label="Online badge text" desc="Shown after the live online count, e.g. “318 builders online now”.">
          {textInput("guesthome.hero_badge")}
        </Row>
        <Row label="Primary button">{textInput("guesthome.cta_primary")}</Row>
        <Row label="Secondary button">{textInput("guesthome.cta_secondary")}</Row>
      </div>

      {/* Content */}
      <div className="acp-card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)", marginBottom: 6 }}>Feed sources</div>
        <p style={{ fontSize: 13, color: "var(--c-fg-muted)", margin: "0 0 8px" }}>
          What the guest feed shows. Pick one or several — multiple sources are merged newest-first.
          {availableSources.length <= 1 && " Install & enable a content plugin (e.g. Forum) to add more sources."}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
          {availableSources.map((s) => (
            <label key={s.id} className="acp-checkbox-row">
              <input type="checkbox" checked={selectedSources().includes(s.id)} onChange={() => toggleSource(s.id)} />
              <span>{s.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Sections */}
      <div className="acp-card" style={{ padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)", marginBottom: 6 }}>Sections</div>
        <Row label="Hero stat strip" desc="Members · Posts · New today.">
          <Toggle on={on("guesthome.show_stats")} onToggle={() => set("guesthome.show_stats", !on("guesthome.show_stats"))} />
        </Row>
        <Row label="“Happening right now”" desc="Recent activity card in the hero.">
          <Toggle on={on("guesthome.show_presence")} onToggle={() => set("guesthome.show_presence", !on("guesthome.show_presence"))} />
        </Row>
        <Row label="Categories" desc="Category filter chips and the rail category list.">
          <Toggle on={on("guesthome.show_categories")} onToggle={() => set("guesthome.show_categories", !on("guesthome.show_categories"))} />
        </Row>
        <Row label="Online now" desc="Avatars of currently online members.">
          <Toggle on={on("guesthome.show_online")} onToggle={() => set("guesthome.show_online", !on("guesthome.show_online"))} />
        </Row>
        <Row label="Trending tags" desc="Most-used article tags.">
          <Toggle on={on("guesthome.show_tags")} onToggle={() => set("guesthome.show_tags", !on("guesthome.show_tags"))} />
        </Row>
      </div>
    </div>
  );
}
