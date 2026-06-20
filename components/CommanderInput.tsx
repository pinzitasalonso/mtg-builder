"use client";

import { useEffect, useRef, useState } from "react";

/* Commander name field with Scryfall autocomplete. Suggests card names as you
   type (debounced) and lets you pick one with the mouse or arrow keys. Styled
   for the light modals it lives in. */
export default function CommanderInput({
  value,
  onChange,
  placeholder,
  style,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
  autoFocus?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Suppresses the fetch triggered by programmatically setting the value when a
  // suggestion is picked (so the menu doesn't immediately reopen).
  const skipNext = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    const ctrl = new AbortController();
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = await res.json();
        const names: string[] = Array.isArray(data?.data) ? data.data.slice(0, 8) : [];
        setSuggestions(names);
        setActive(-1);
        setOpen(names.length > 0);
      } catch {
        /* aborted or offline — leave the menu as-is */
      }
    }, 180);
    return () => {
      ctrl.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value]);

  // Close when clicking outside.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(name: string) {
    skipNext.current = true;
    onChange(name);
    setOpen(false);
    setSuggestions([]);
    setActive(-1);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(suggestions[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        style={style}
      />
      {open && suggestions.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 5,
            background: "#fff",
            border: "1px solid var(--line)",
            borderRadius: 10,
            boxShadow: "0 14px 34px -14px rgba(0,0,0,.4)",
            overflow: "hidden",
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {suggestions.map((name, i) => (
            <button
              key={name}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(name)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "9px 12px",
                border: "none",
                cursor: "pointer",
                background: i === active ? "var(--bg3)" : "transparent",
                color: "var(--t1)",
                fontFamily: "var(--font-body)",
                fontSize: 14.5,
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
