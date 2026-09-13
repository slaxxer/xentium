/**
 * @ mentions — the suggestion engine, lifted out of `MiniEditor`.
 *
 * ⚠ It lived inside the comment editor, so a forum thread, a reply and a private
 * message could not mention anybody: the same feature existed on exactly one of four
 * surfaces. Moving it here is the whole point of one composer — threads, replies and
 * PMs get mentions for free, and an admin can still switch them off site-wide
 * (`ComposerConfig.mentions`).
 */
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { ReactRenderer } from "@tiptap/react";
import { authStore } from "../../lib/authStore";

interface SuggestionKeyDownProps { event: KeyboardEvent }

export interface MentionUser {
  /** The username — it is also the mention's stored id. */
  id:     string;
  label:  string;
  avatar: string | null;
  /** Primary group, shown on the right of the row. */
  role:   string | null;
}

interface MentionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface MentionListProps {
  items:   MentionUser[];
  command: (item: MentionUser) => void;
}

const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  ({ items, command }, ref) => {
    const [active, setActive] = useState(0);

    useEffect(() => setActive(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown({ event }) {
        if (event.key === "ArrowUp")   { setActive((i) => Math.max(0, i - 1)); return true; }
        if (event.key === "ArrowDown") { setActive((i) => Math.min(items.length - 1, i + 1)); return true; }
        // ⚠ Tab commits too: it is what every other @-field in the world does, and
        // without it Tab moves focus out of the editor mid-mention.
        if (event.key === "Enter" || event.key === "Tab") {
          const item = items[active];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (!items.length) return null;

    return (
      <ul className="nvc-mentions" role="listbox">
        {items.map((item, i) => (
          <li
            key={item.id}
            role="option"
            aria-selected={i === active}
            className={`nvc-mentions__row${i === active ? " is-on" : ""}`}
            // ⚠ `onMouseDown` + preventDefault, not onClick: a click would blur the
            // editor first, and the suggestion closes on blur.
            onMouseDown={(e) => { e.preventDefault(); command(item); }}
          >
            <span className="nvc-mentions__av">
              {item.avatar ? <img src={item.avatar} alt="" /> : item.label.slice(0, 2).toUpperCase()}
            </span>
            <span className="nvc-mentions__name">@{item.label}</span>
            {item.role && <span className="nvc-mentions__role">{item.role}</span>}
          </li>
        ))}
      </ul>
    );
  },
);
MentionList.displayName = "MentionList";

interface SearchRow {
  id: string;
  username: string;
  /** ⚠ ALREADY a URL — the endpoint resolves it. See the note in `searchUsers`. */
  avatar: string | null;
  /** The primary group's name, for the row's right-hand label. */
  role: string | null;
}

async function searchUsers(query: string): Promise<MentionUser[]> {
  if (!query) return [];
  try {
    const token = authStore.token;
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}&limit=6`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    });
    if (!res.ok) return [];
    const data: SearchRow[] = await res.json();
    /**
     * ⚠ `u.avatar` is used AS IS. The old mention list rendered
     * `/uploads/${item.avatar}` on a value the endpoint had already resolved to a
     * full URL, so every mention suggestion drew a broken image.
     */
    return data.map((u) => ({
      id: u.username, label: u.username, avatar: u.avatar, role: u.role ?? null,
    }));
  } catch {
    return [];
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** TipTap's suggestion plugin config, with the list rendered into a body portal. */
export function buildMentionSuggestion() {
  return {
    items: ({ query }: { query: string }) => searchUsers(query),

    render: (): any => {
      let renderer: ReactRenderer<MentionListHandle, MentionListProps>;
      let popup: HTMLDivElement;

      /**
       * ⚠ Flipped above the caret when there is no room below. The composer's action
       * bar is at the BOTTOM of the surface now, so a list that always dropped
       * downwards would open straight through it.
       */
      function place(clientRect: (() => DOMRect | null) | null | undefined) {
        if (!popup || !clientRect) return;
        const rect = clientRect();
        if (!rect) return;
        const height = popup.offsetHeight || 220;
        const below = window.innerHeight - rect.bottom;
        popup.style.left = `${rect.left + window.scrollX}px`;
        popup.style.top = below < height + 16
          ? `${rect.top + window.scrollY - height - 6}px`
          : `${rect.bottom + window.scrollY + 6}px`;
      }

      return {
        onStart(props: any) {
          popup = document.createElement("div");
          popup.className = "nvc-mentions-portal";
          document.body.appendChild(popup);
          renderer = new ReactRenderer<MentionListHandle, MentionListProps>(MentionList, {
            props: { items: props.items, command: props.command },
            editor: props.editor,
          });
          popup.appendChild(renderer.element);
          place(props.clientRect);
        },

        onUpdate(props: any) {
          renderer.updateProps({ items: props.items, command: props.command });
          place(props.clientRect);
        },

        onKeyDown(props: SuggestionKeyDownProps) {
          if (props.event.key === "Escape") {
            popup.remove();
            renderer.destroy();
            return true;
          }
          return renderer.ref?.onKeyDown(props) ?? false;
        },

        onExit() {
          popup.remove();
          renderer.destroy();
        },
      };
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
