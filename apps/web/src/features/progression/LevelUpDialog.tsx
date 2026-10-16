/**
 * The one-time "Level up" moment.
 *
 * When the promotion job moves a member up a rung it records the climb; the next time
 * they are on the site this dialog celebrates it ONCE, then marks it seen. It is the
 * promotion notice itself, so it follows the ACP's "notify on promote" setting (the
 * server answers null when that is off).
 *
 * ⚠ It watches the unread-notification count as well as its own minute-long poll: a
 * promotion also sends a notification, so the bell's count moving is the cheapest
 * signal that there may be something to celebrate right now, while the member is
 * still on the page where they earned it.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../components/Icon";
import { faArrowUp, faCheck, faFlagCheckered } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { isEditorPreview } from "../../layout/previewMode";
import "./LevelUpDialog.scss";
import { uiLocale } from "../../lib/i18n";

interface LevelUp {
  id: string;
  rank: { label: string; color: string | null };
  from: { label: string; color: string | null } | null;
  unlocks: { key: string; value: number }[];
  next: { rank: string | null; primary: { label: string; remaining: number } | null } | null;
}

const CONFETTI = 22;

export function LevelUpDialog() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const enabled = !!user && !isEditorPreview();

  const { data, refetch } = useQuery<{ levelUp: LevelUp | null }>({
    queryKey: ["level-up", user?.id],
    queryFn: () => api.get("/users/me/level-up"),
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // Rides the bell's cache (no request of its own): a promotion sends a notification.
  const { data: unread } = useQuery<{ count: number }>({
    queryKey: ["notif-unread-count"],
    queryFn: () => api.get("/notifications/unread-count"),
    enabled: false,
  });
  useEffect(() => { if (enabled && unread) void refetch(); }, [unread?.count, enabled, refetch]);

  const seen = useMutation({
    mutationFn: () => api.post("/users/me/level-up/seen"),
    onSettled: () => {
      qc.setQueryData(["level-up", user?.id], { levelUp: null });
      qc.invalidateQueries({ queryKey: ["progression"] });
    },
  });

  const level = data?.levelUp ?? null;
  if (!level) return null;
  return <Celebration key={level.id} level={level} onClose={() => seen.mutate()} />;
}

function Celebration({ level, onClose }: { level: LevelUp; onClose: () => void }) {
  const { t } = useTranslation("profiles");
  const button = useRef<HTMLButtonElement>(null);
  const color = level.rank.color ?? "var(--c-accent)";

  // Confetti is placed once per dialog: angle, distance, size, delay and hue vary per piece.
  const pieces = useMemo(() => Array.from({ length: CONFETTI }, (_, i) => ({
    angle: (360 / CONFETTI) * i + (i % 3) * 7,
    dist: 110 + ((i * 37) % 70),
    size: 6 + (i % 4) * 2,
    delay: (i % 5) * 0.04,
    tone: i % 4,
    round: i % 3 === 0,
  })), []);

  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div className="lvl-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="lvl-card" role="dialog" aria-modal="true" aria-labelledby="lvl-title"
        style={{ ["--lvl" as string]: color }}>
        <div className="lvl-stage" aria-hidden>
          <span className="lvl-pulse" />
          <span className="lvl-pulse lvl-pulse--2" />
          <span className="lvl-ring" />
          <div className="lvl-medal">
            <FontAwesomeIcon icon={faArrowUp} className="lvl-medal__arrow" />
          </div>
          {pieces.map((p, i) => (
            <span key={i} className={`lvl-bit lvl-bit--${p.tone}${p.round ? " is-round" : ""}`}
              style={{
                ["--a" as string]: `${p.angle}deg`, ["--d" as string]: `${p.dist}px`,
                ["--s" as string]: `${p.size}px`, animationDelay: `${0.35 + p.delay}s`,
              }} />
          ))}
          {[0, 1, 2, 3].map((i) => <span key={`s${i}`} className={`lvl-spark lvl-spark--${i}`} />)}
        </div>

        <p className="lvl-eyebrow">{t("levelUp.eyebrow")}</p>
        <h2 id="lvl-title" className="lvl-title">
          {t("levelUp.title")} <span className="lvl-chip">{level.rank.label}</span>
        </h2>
        {level.from && (
          <p className="lvl-from">
            <span>{level.from.label}</span>
            <FontAwesomeIcon icon={faArrowUp} className="lvl-from__arrow" />
            <b>{level.rank.label}</b>
          </p>
        )}

        {level.unlocks.length > 0 && (
          <div className="lvl-unlocks">
            <div className="lvl-unlocks__title">{t("levelUp.unlocked")}</div>
            <ul>
              {level.unlocks.map((u, i) => (
                <li key={u.key} style={{ animationDelay: `${0.9 + i * 0.08}s` }}>
                  <FontAwesomeIcon icon={faCheck} />
                  {t(`rank.unlock.${u.key}`, { count: u.value, value: u.value.toLocaleString(uiLocale()), defaultValue: `${u.value} ${u.key}` })}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="lvl-next">
          <FontAwesomeIcon icon={faFlagCheckered} />
          {level.next?.rank && level.next.primary
            ? t("rank.remaining", {
                count: level.next.primary.remaining,
                metric: t(`rank.metric.${level.next.primary.label}`, { defaultValue: level.next.primary.label }),
                rank: level.next.rank,
              })
            : level.next?.rank ? t("levelUp.nextRank", { rank: level.next.rank }) : t("levelUp.top")}
        </p>

        <button ref={button} type="button" className="lvl-btn" onClick={close}>{t("levelUp.cta")}</button>
      </div>
    </div>
  );
}
