import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { faDiscord, faGithub, faGoogle } from "@fortawesome/free-brands-svg-icons";
import { faFingerprint } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";

/** N single-digit boxes that behave like one field: type, backspace, paste. */
export function DigitsInput({ length, value, onChange, secret, label }: {
  length: number; value: string; onChange: (v: string) => void; secret?: boolean; label: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  const set = (i: number, ch: string) => {
    const next = digits.slice();
    next[i] = ch;
    onChange(next.join("").slice(0, length));
  };

  return (
    <div className="dw-digits" role="group" aria-label={label} data-length={length}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type={secret ? "password" : "text"}
          inputMode="numeric"
          autoComplete={i === 0 && !secret ? "one-time-code" : "off"}
          maxLength={1}
          value={d}
          aria-label={`${label} ${i + 1}`}
          autoFocus={i === 0}
          onChange={(e) => {
            const ch = e.target.value.replace(/\D/g, "").slice(-1);
            set(i, ch);
            if (ch) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) { refs.current[i - 1]?.focus(); set(i - 1, ""); e.preventDefault(); }
            if (e.key === "ArrowLeft") refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight") refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
            if (!text) return;
            e.preventDefault();
            onChange(text);
            refs.current[Math.min(text.length, length - 1)]?.focus();
          }}
        />
      ))}
    </div>
  );
}

export function PasswordInput({ value, onChange, autoComplete, id, autoFocus, invalid }: {
  value: string; onChange: (v: string) => void; autoComplete: string; id: string; autoFocus?: boolean; invalid?: boolean;
}) {
  const { t } = useTranslation("auth");
  const [show, setShow] = useState(false);
  return (
    <div className="dw-input-wrap">
      <input id={id} className={`dw-input${invalid ? " is-invalid" : ""}`} type={show ? "text" : "password"} value={value} autoComplete={autoComplete}
        autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} required />
      <button type="button" className="dw-input-toggle" onClick={() => setShow(!show)} aria-pressed={show}>
        {show ? t("door.hide") : t("door.show")}
      </button>
    </div>
  );
}

const PROVIDER_ICON = { google: faGoogle, github: faGithub, discord: faDiscord } as const;
const PROVIDER_NAME = { google: "Google", github: "GitHub", discord: "Discord" } as const;

/** `iconOnly`: square buttons named by their label, for the masthead dropdown. */
export function ProviderButtons({ providers, onPick, busy, iconOnly = false }: {
  providers: Array<keyof typeof PROVIDER_ICON>; onPick: (p: string) => void; busy: string | null; iconOnly?: boolean;
}) {
  if (providers.length === 0) return null;
  if (iconOnly) {
    return (
      <>
        {providers.map((p) => (
          <button key={p} type="button" className="dw-btn dw-btn--ghost dw-btn--square" disabled={!!busy} onClick={() => onPick(p)}
            aria-label={PROVIDER_NAME[p]} title={PROVIDER_NAME[p]}>
            <FontAwesomeIcon icon={PROVIDER_ICON[p]} />
          </button>
        ))}
      </>
    );
  }
  return (
    <div className="dw-providers" data-count={providers.length}>
      {providers.map((p) => (
        <button key={p} type="button" className="dw-btn dw-btn--ghost" disabled={!!busy} onClick={() => onPick(p)}>
          <FontAwesomeIcon icon={PROVIDER_ICON[p]} /> {PROVIDER_NAME[p]}
        </button>
      ))}
    </div>
  );
}

/** `short`: just "Passkey", beside icon-only provider buttons. */
export function PasskeyButton({ onClick, busy, short = false }: { onClick: () => void; busy: boolean; short?: boolean }) {
  const { t } = useTranslation("auth");
  return (
    <button type="button" className={`dw-btn dw-btn--ghost${short ? " dw-grow" : " dw-btn--wide"}`} onClick={onClick} disabled={busy}>
      <FontAwesomeIcon icon={faFingerprint} className="dw-accent" />
      {busy ? t("door.passkey.waiting") : short ? t("door.passkey.short") : t("door.passkey.signIn")}
    </button>
  );
}

export function OrDivider({ children }: { children: ReactNode }) {
  return <div className="dw-or"><span>{children}</span></div>;
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="dw-alert" role="alert">{children}</p>;
}
