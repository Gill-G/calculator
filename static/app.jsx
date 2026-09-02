const { useState, useEffect, useCallback, useRef } = React;

// The keypad shows friendly symbols; the Python backend wants real operators.
// Every entry is a single character, so the swap is a straight character map.
const TO_PYTHON = {
  "×": "*",
  "÷": "/",
  "−": "-",
  "^": "**",
  "√": "sqrt",
  "π": "pi",
};

const OPERATORS = ["+", "−", "×", "÷", "%", "^"];

const STORAGE_KEY = "calculator-theme";
const MODE_KEY = "calculator-mode";
const ANGLE_KEY = "calculator-angle";

// The Node facts service runs beside the Python server, on its own port.
// Derived from the current host so this still works over the network.
const FACTS_URL = `${window.location.protocol}//${window.location.hostname}:3001/api/fact`;

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

// Same guarded read as the theme, for the two scientific-mode preferences.
function readStored(key, allowed, fallback) {
  try {
    const saved = localStorage.getItem(key);
    if (allowed.some((option) => option.id === saved)) return saved;
  } catch (err) {
    /* fall through to the default */
  }
  return fallback;
}

// Each key inserts `insert` when present, otherwise its own label -- so the
// button can read "sin⁻¹" while the expression gets the plain `asin(`.
const BASIC_KEYS = [
  { label: "(", type: "fn" },
  { label: ")", type: "fn" },
  { label: "^", type: "op" },
  { label: "√", type: "op", insert: "√(" },

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

// The same four columns as the basic pad, with four rows of function keys
// stacked on top, so the digits stay exactly where the hand expects them.
const SCIENTIFIC_KEYS = [
  { label: "sin", type: "sci", insert: "sin(", aria: "Sine" },
  { label: "cos", type: "sci", insert: "cos(", aria: "Cosine" },
  { label: "tan", type: "sci", insert: "tan(", aria: "Tangent" },
  { label: "ln", type: "sci", insert: "ln(", aria: "Natural logarithm" },

  { label: "sin⁻¹", type: "sci", insert: "asin(", aria: "Inverse sine" },
  { label: "cos⁻¹", type: "sci", insert: "acos(", aria: "Inverse cosine" },
  { label: "tan⁻¹", type: "sci", insert: "atan(", aria: "Inverse tangent" },
  { label: "log", type: "sci", insert: "log(", aria: "Logarithm base 10" },

  { label: "x²", type: "sci", insert: "^2", aria: "Squared" },
  { label: "xʸ", type: "sci", insert: "^", aria: "To the power of" },
  { label: "√", type: "sci", insert: "√(", aria: "Square root" },
  { label: "n!", type: "sci", insert: "fact(", aria: "Factorial" },

  { label: "eˣ", type: "sci", insert: "exp(", aria: "e to the power of" },
  { label: "10ˣ", type: "sci", insert: "10^", aria: "10 to the power of" },
  { label: "1/x", type: "sci", insert: "1/(", aria: "Reciprocal" },
  { label: "|x|", type: "sci", insert: "abs(", aria: "Absolute value" },

  { label: "(", type: "fn" },
  { label: ")", type: "fn" },
  { label: "π", type: "fn" },
  { label: "e", type: "fn", aria: "Euler's number" },

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

  { label: "×10ˣ", type: "sci", insert: "×10^", aria: "Times ten to the power of" },
  { label: "0" },
  { label: "." },
  { label: "=", type: "equals", action: "evaluate" },
];

// Adding a mode means adding a row here and a keypad above it.
const MODES = [
  { id: "basic", label: "Basic", keys: BASIC_KEYS },
  { id: "scientific", label: "Scientific", keys: SCIENTIFIC_KEYS, angles: true },
];

const ANGLES = [
  { id: "deg", label: "DEG" },
  { id: "rad", label: "RAD" },
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

// Function keys open a bracket they never close -- pressing √ then 25 leaves
// "√(25". Closing the stragglers on "=" is what a pocket calculator does, and
// it saves hunting for ")" after every sin, ln or n!. Surplus ")" is left
// alone so a genuinely malformed expression still reports an error.
function balanceParens(display) {
  let open = 0;
  for (const ch of display) {
    if (ch === "(") open += 1;
    else if (ch === ")") open = Math.max(0, open - 1);
  }
  return display + ")".repeat(open);
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

function ModeSwitcher({ mode, onModeChange, angle, onAngleChange, showAngles }) {
  return (
    <div className="modes">
      <div className="modes__tabs" role="tablist" aria-label="Calculator mode">
        {MODES.map((option) => (
          <button
            key={option.id}
            className="mode-tab"
            role="tab"
            aria-selected={mode === option.id}
            aria-controls="keypad"
            onClick={() => onModeChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {showAngles && (
        <div className="angles" role="group" aria-label="Angle unit">
          {ANGLES.map((option) => (
            <button
              key={option.id}
              className="angle-tab"
              aria-pressed={angle === option.id}
              onClick={() => onAngleChange(option.id)}
              title={option.id === "deg" ? "Degrees" : "Radians"}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
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

function FactBubble() {
  const [fact, setFact] = useState("");
  const [loading, setLoading] = useState(true);

  const loadFact = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(FACTS_URL);
      const data = await response.json();
      setFact(data.fact);
    } catch (err) {
      setFact("Facts service offline — start it with `npm start`.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Runs once per page load, so refreshing gets you a new fact.
  useEffect(() => {
    loadFact();
  }, [loadFact]);

  return (
    <section className="fact">
      <div className="fact__head">
        <h2 className="fact__title">Did you know?</h2>
        <button
          className="fact__new"
          onClick={loadFact}
          disabled={loading}
          aria-label="Show another fact"
          title="Another fact"
        >
          ↻
        </button>
      </div>
      <p className={"fact__text" + (loading ? " fact__text--loading" : "")}>
        {fact || "Loading a fact…"}
      </p>
      <p className="fact__source">Served by Node · new fact each refresh</p>
    </section>
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
  const [mode, setMode] = useState(() => readStored(MODE_KEY, MODES, "basic"));
  const [angle, setAngle] = useState(() => readStored(ANGLE_KEY, ANGLES, "deg"));

  const activeMode = MODES.find((option) => option.id === mode) || MODES[0];
  const keys = activeMode.keys;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (err) {
      /* the theme still applies for this session */
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
      localStorage.setItem(ANGLE_KEY, angle);
    } catch (err) {
      /* the choice still applies for this session */
    }
  }, [mode, angle]);

  const append = useCallback(
    (text) => {
      setError("");
      if (settled) {
        // After "=", typing a number starts over but an operator continues
        // from the result -- the way a pocket calculator behaves.
        setHint("");
        setSettled(false);
        setExpression((current) =>
          OPERATORS.includes(text) ? current + text : text
        );
      } else {
        setExpression((current) => current + text);
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
    const display = balanceParens(expression.trim());
    if (!display || pending) return;

    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/calc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expression: toPython(display), angle }),
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
  }, [angle, expression, pending]);

  const pressKey = useCallback(
    (key) => {
      if (key.action === "clear") return clear();
      if (key.action === "backspace") return backspace();
      if (key.action === "evaluate") return evaluate();
      append(key.insert || key.label);
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
        const match = keys.find((k) => k.label === mapped);
        if (match) {
          event.preventDefault();
          append(match.insert || match.label);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [append, backspace, clear, evaluate, keys, menuOpen]);

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
      <FactBubble />
      <main className="calculator">
        <ModeSwitcher
          mode={mode}
          onModeChange={setMode}
          angle={angle}
          onAngleChange={setAngle}
          showAngles={Boolean(activeMode.angles)}
        />
        <Display
          expression={expression}
          hint={hint}
          error={error}
          pending={pending}
        />
        <div id="keypad" className={"keypad keypad--" + activeMode.id}>
          {keys.map((key) => (
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
