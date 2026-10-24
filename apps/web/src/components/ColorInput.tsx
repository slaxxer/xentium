import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

/** How often a drag in the picker reaches `onChange`, at most. */
const EVERY_MS = 100;

/**
 * The browser's colour picker, without the lag.
 *
 * Dragging in the picker fires an input event for every pixel. Where a colour feeds a
 * whole editor (Theme Studio re-renders the page, records an undo step and posts the
 * document to the preview), handing each one on made the picker stutter. Here the swatch
 * follows the drag at once, `onChange` gets the colour at most every 100 ms, and the
 * last colour always arrives when the drag stops or the picker closes.
 */
export function ColorInput({ value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const [shown, setShown] = useState(value);
  const pending = useRef<string | null>(null);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Follow the value from outside (undo, a reset, another field) unless a drag is mid-way.
  useEffect(() => { if (pending.current === null) setShown(value); }, [value]);

  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const v = pending.current;
    pending.current = null;
    if (v !== null) { last.current = Date.now(); onChangeRef.current(v); }
  };

  useEffect(() => () => flush(), []);

  const input = (v: string) => {
    setShown(v);
    pending.current = v;
    const wait = EVERY_MS - (Date.now() - last.current);
    if (wait <= 0) flush();
    else if (!timer.current) timer.current = setTimeout(flush, wait);
  };

  return (
    <input
      {...rest}
      type="color"
      value={shown}
      onChange={(e) => input(e.target.value)}
      onBlur={(e) => { flush(); rest.onBlur?.(e); }}
      // The native `change` event fires when the picker closes: the colour is final.
      ref={(el) => { if (el) el.onchange = flush; }}
    />
  );
}
