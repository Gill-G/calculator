const { useState, useEffect, useCallback, useRef } = React;

// The keypad shows friendly symbols; the Python backend wants real operators.
const TO_PYTHON = {
  "×": "*",
  "÷": "/",
  "−": "-",
  "^": "**",
  "√": "sqrt(",
  "π": "pi",
};

const OPERATORS = ["+", "−", "×", "÷", "%", "^"];

const STORAGE_KEY = "calculator-theme";

// `preview` drives the swatch: half page-background, half accent.
const THEMES = [
  { id: "dark", label: "Dark", preview: ["#10131a", "#4c8dff"] },
  { id: "light", label: "Light", preview: ["#e9edf4", "#2f6fed"] },
  { id: "midnight", label: "Midnight", preview: ["#0d0a18", "#a78bfa"] },
  { id: "sunset", label: "Sunset", preview: ["#1a1113", "#ff8a5b"] },
];

function readStoredTheme() {
  // localStorage throws outright in some privacy modes, so never trust it.
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (THEMES.some((theme) => theme.id === saved)) return saved;
  } catch (err) {
    /* fall through to the system preference */
  }
  try {
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  } catch (err) {
    /* fall through to the default */
  }
  return "dark";
}

const KEYS = [
  { label: "(", type: "fn" },
  { label: ")", type: "fn" },
  { label: "^", type: "op" },
  { label: "√", type: "op" },

  { label: "C", type: "fn", action: "clear" },
  { label: "⌫", type: "fn", action: "backspace", aria: "Backspace" },
  { label: "%", type: "op" },
  { label: "÷", type: "op" },

  { label: "7" },
  { label: "8" },
  { label: "9" },
  { label: "×", type: "op" },

  { label: "4" },
  { label: "5" },
  { label: "6" },
  { label: "−", type: "op" },

  { label: "1" },
  { label: "2" },
  { label: "3" },
  { label: "+", type: "op" },

  { label: "π", type: "fn" },
  { label: "0" },
  { label: "." },
  { label: "=", type: "equals", action: "evaluate" },
];

// Keyboard character -> keypad label.
const KEY_MAP = {
  "*": "×",
  x: "×",
  "/": "÷",
  "-": "−",
  p: "π",
  r: "√",
};

function toPython(display) {
  return display
    .split("")
    .map((ch) => TO_PYTHON[ch] || ch)
    .join("");
}

function ThemeTrigger({ current, open, onToggle }) {
  return (
    <button
      className="theme-trigger"
      onClick={onToggle}
      aria-expanded={open}
      aria-label="Theme menu"
    >
      <span
        className="theme-trigger__dot"
        style={{
          background: `linear-gradient(135deg, ${current.preview[0]} 50%, ${current.preview[1]} 50%)`,
        }}
      />
      Theme
    </button>
  );
}

function ThemeMenu({ theme, onChange, onClose }) {
  return (
    <React.Fragment>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Theme">
        <div className="drawer__head">
          <h2 className="drawer__title">Theme</h2>
          <button
            className="drawer__close"
            onClick={onClose}
            aria-label="Close theme menu"
          >
            ×
          </button>
        </div>
        <ul className="drawer__list">
          {THEMES.map((option) => (
            <li key={option.id}>
              <button
                className="theme-option"
                onClick={() => onChange(option.id)}
                aria-pressed={theme === option.id}
              >
                <span
                  className="theme-option__swatch"
                  style={{
                    background: `linear-gradient(135deg, ${option.preview[0]} 50%, ${option.preview[1]} 50%)`,
                  }}
                />
                <span className="theme-option__name">{option.label}</span>
                {theme === option.id && (
                  <span className="theme-option__check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <p className="drawer__note">The menu stays open so you can compare.</p>
      </aside>
    </React.Fragment>
  );
}

function Display({ expression, hint, error, pending }) {
  const hintText = error || hint;
  return (
    <div className="display">
      <div className={"display__hint" + (error ? " display__hint--error" : "")}>
        {hintText}
      </div>
      <div
        className={"display__value" + (pending ? " display__value--pending" : "")}
      >
        {expression || "0"}
      </div>
    </div>
  );
}

function History({ entries, onPick, onClear }) {
  return (
    <aside className="history">
      <div className="history__head">
        <h2 className="history__title">History</h2>
        {entries.length > 0 && (
          <button className="history__clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="history__empty">Nothing calculated yet.</p>
      ) : (
        <ul className="history__list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                className="history__item"
                onClick={() => onPick(entry.result)}
                title="Use this result"
              >
                <span className="history__expr">{entry.expression}</span>
                <span className="history__result">{entry.result}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function Calculator() {
  const [expression, setExpression] = useState("");
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [settled, setSettled] = useState(false); // showing a finished result
  const [history, setHistory] = useState([]);
  const nextId = useRef(1);
  const [theme, setTheme] = useState(readStoredTheme);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (err) {
      /* the theme still applies for this session */
    }
  }, [theme]);

  const append = useCallback(
    (label) => {
      setError("");
      if (settled) {
        // After "=", typing a number starts over but an operator continues
        // from the result -- the way a pocket calculator behaves.
        setHint("");
        setSettled(false);
        setExpression((current) =>
          OPERATORS.includes(label) ? current + label : label
        );
      } else {
        setExpression((current) => current + label);
      }
    },
    [settled]
  );

  const clear = useCallback(() => {
    setExpression("");
    setHint("");
    setError("");
    setSettled(false);
  }, []);

  const backspace = useCallback(() => {
    setError("");
    setSettled(false);
    setExpression((current) => current.slice(0, -1));
  }, []);

  const evaluate = useCallback(async () => {
    const display = expression.trim();
    if (!display || pending) return;

    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/calc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expression: toPython(display) }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Could not calculate that");
        return;
      }

      setExpression(data.result);
      setHint(display + " =");
      setSettled(true);
      setHistory((entries) =>
        [
          { id: nextId.current++, expression: display, result: data.result },
          ...entries,
        ].slice(0, 25)
      );
    } catch (err) {
      setError("Cannot reach the server");
    } finally {
      setPending(false);
    }
  }, [expression, pending]);

  const pressKey = useCallback(
    (key) => {
      if (key.action === "clear") return clear();
      if (key.action === "backspace") return backspace();
      if (key.action === "evaluate") return evaluate();
      append(key.label);
    },
    [append, backspace, clear, evaluate]
  );

  const useResult = useCallback(
    (result) => {
      setError("");
      setHint("");
      setSettled(false);
      setExpression((current) => (settled ? result : current + result));
    },
    [settled]
  );

  useEffect(() => {
    function onKeyDown(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const { key } = event;

      if (key === "Enter" || key === "=") {
        event.preventDefault();
        evaluate();
      } else if (key === "Backspace") {
        event.preventDefault();
        backspace();
      } else if (key === "Escape") {
        event.preventDefault();
        if (menuOpen) {
          setMenuOpen(false);
        } else {
          clear();
        }
      } else {
        const mapped = KEY_MAP[key] || key;
        if (KEYS.some((k) => k.label === mapped)) {
          event.preventDefault();
          append(mapped);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [append, backspace, clear, evaluate, menuOpen]);

  return (
    <div className="app">
      <ThemeTrigger
        current={THEMES.find((option) => option.id === theme) || THEMES[0]}
        open={menuOpen}
        onToggle={() => setMenuOpen((open) => !open)}
      />
      {menuOpen && (
        <ThemeMenu
          theme={theme}
          onChange={setTheme}
          onClose={() => setMenuOpen(false)}
        />
      )}
      <main className="calculator">
        <Display
          expression={expression}
          hint={hint}
          error={error}
          pending={pending}
        />
        <div className="keypad">
          {KEYS.map((key) => (
            <button
              key={key.label}
              className={"key" + (key.type ? " key--" + key.type : "")}
              onClick={() => pressKey(key)}
              disabled={key.action === "evaluate" && (pending || !expression)}
              aria-label={key.aria || key.label}
            >
              {key.label}
            </button>
          ))}
        </div>
        <p className="footnote">Math runs in Python &middot; keyboard works too</p>
      </main>
      <History
        entries={history}
        onPick={useResult}
        onClear={() => setHistory([])}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Calculator />);
