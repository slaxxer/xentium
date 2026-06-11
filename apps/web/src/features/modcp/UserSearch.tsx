import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Username } from "../../components/Username";

/** Username typeahead used by the ModCanvas warn/ban forms and the Users section.
 *  Resolves to a userId + username on selection. */
export function UserSearch({ value, onChange }: { value: string; onChange: (id: string, username: string) => void }) {
  const [query,  setQuery]  = useState("");
  const [focused, setFocused] = useState(false);
  const selectedRef = useRef<{ id: string; username: string } | null>(null);

  const results = useQuery<{ data: { id: string; username: string; badgeColor: string | null }[] }>({
    queryKey: ["mc-user-search", query],
    queryFn:  () => api.get(`/moderation/users?search=${encodeURIComponent(query)}&limit=5`),
    enabled:  query.length >= 2 && !selectedRef.current,
  });

  const select = (u: { id: string; username: string }) => {
    selectedRef.current = u;
    setQuery(u.username);
    onChange(u.id, u.username);
    setFocused(false);
  };

  const clear = () => {
    selectedRef.current = null;
    setQuery("");
    onChange("", "");
  };

  if (selectedRef.current && value) {
    return (
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--c-bg)",border:"1px solid var(--c-accent)",borderRadius:"var(--radius-md)",padding:"8px 12px",fontSize:13,color:"var(--c-fg)" }}>
        <span style={{ fontWeight:700 }}>{selectedRef.current.username}</span>
        <button type="button" onClick={clear} style={{ background:"none",border:"none",cursor:"pointer",color:"var(--c-fg-muted)",fontSize:15,padding:0,lineHeight:1 }}>×</button>
      </div>
    );
  }

  return (
    <div style={{ position:"relative" }}>
      <input
        className="mc-inp"
        placeholder="Search username…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); selectedRef.current = null; onChange("", ""); }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 160)}
        style={{ marginBottom: 0 }}
      />
      {focused && results.data && results.data.data.length > 0 && (
        <div style={{ position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"var(--c-card)",border:"1px solid var(--c-border)",borderRadius:"var(--radius-md)",zIndex:20,boxShadow:"var(--shadow-pop)" }}>
          {results.data.data.map((u) => (
            <button key={u.id} type="button"
              // Select on mouseDown + preventDefault so the input never blurs
              // (an onClick here races the input's blur and gets dropped).
              onMouseDown={(e) => { e.preventDefault(); select(u); }}
              style={{ display:"block",width:"100%",textAlign:"left",padding:"8px 12px",background:"none",border:"none",cursor:"pointer",fontSize:13,color:"var(--c-fg)",fontFamily:"inherit" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--c-accent-soft)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              <Username username={u.username} badgeColor={u.badgeColor} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
