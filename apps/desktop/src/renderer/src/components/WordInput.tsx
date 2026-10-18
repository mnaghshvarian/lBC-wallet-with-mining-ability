import { useEffect, useState } from 'react';

/** Single recovery-word input with BIP39 autocomplete. */
export function WordInput({ value, onChange, placeholder, invalid, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean; autoFocus?: boolean }) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let alive = true;
    const prefix = value.trim().toLowerCase();
    if (prefix.length < 2) {
      setSuggestions([]);
      return;
    }
    void window.lbc.wallets.suggestWords(prefix).then((w) => alive && setSuggestions(w.filter((x) => x !== prefix)));
    return () => {
      alive = false;
    };
  }, [value]);

  const show = focused && suggestions.length > 0;
  return (
    <div className="input-wrap" style={{ display: 'block' }}>
      <input
        className={`input ${invalid ? 'invalid' : ''}`}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (suggestions[active]) {
              e.preventDefault();
              onChange(suggestions[active]!);
              setSuggestions([]);
            }
          }
        }}
      />
      {show && (
        <div className="suggestions">
          {suggestions.map((w, i) => (
            <button
              key={w}
              type="button"
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(w);
                setSuggestions([]);
              }}
            >
              {w}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
