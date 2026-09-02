# Calculator

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![Node](https://img.shields.io/badge/Node-24_LTS-5FA04E?logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=black)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)

A small calculator app: a **React** frontend that hands every expression to a
**Python** backend, which does the arithmetic and hands back the answer. A
small **Node** service alongside it serves the fun facts.

Two modes so far — **Standard** and **Scientific** — picked from the switcher
above the display.

The frontend has no build step — React arrives from a CDN — and the Python
side is standard library only. The only third-party packages anywhere are
Express and cors, used by the facts service.

## Run it

Two processes: Python serves the app and does the arithmetic, Node serves the
fun facts. `start.sh` runs both and stops both on Ctrl+C.

```bash
./start.sh                   # then open http://127.0.0.1:8000
```

Or run them yourself in two terminals:

```bash
npm install && node facts-server.js   # facts, port 3001
python3 server.py                     # app + maths, port 8000
```

The calculator works on its own if the Node service is down — only the facts
bubble notices, and it says so.

## Layout

| File | What it does |
| --- | --- |
| `server.py` | HTTP server, static file serving, and the expression evaluator |
| `facts-server.js` | Express service serving random facts on port 3001 |
| `start.sh` | Runs both servers together |
| `static/index.html` | Page shell; pulls in React and Babel |
| `static/app.jsx` | The React UI — modes, display, keypads, history |
| `static/styles.css` | Styling |

## How the math works

The frontend `POST`s to `/api/calc`:

```bash
curl -X POST http://127.0.0.1:8000/api/calc \
  -H 'Content-Type: application/json' \
  -d '{"expression": "2 + 3 * 4"}'
# {"expression": "2 + 3 * 4", "angle": "rad", "result": "14"}
```

An optional `"angle"` field picks the unit the trig functions speak, `"rad"`
(the default) or `"deg"`:

```bash
curl -X POST http://127.0.0.1:8000/api/calc \
  -H 'Content-Type: application/json' \
  -d '{"expression": "sin(90)", "angle": "deg"}'
# {"expression": "sin(90)", "angle": "deg", "result": "1"}
```

Errors come back as `{"error": "Cannot divide by zero"}` with a 400.

`eval()` is never used. The expression is parsed with `ast` and the tree is
walked by hand, so only whitelisted nodes run: numbers, `+ - * / // % **`,
unary `+/-`, the constants `pi`/`e`/`tau`, and these functions:

| Group | Functions |
| --- | --- |
| Powers and roots | `sqrt`, `exp` |
| Logarithms | `log` (base 10), `ln`, `log2` |
| Trigonometry | `sin`, `cos`, `tan`, `asin`, `acos`, `atan` |
| Hyperbolic | `sinh`, `cosh`, `tanh` |
| Rounding | `round`, `floor`, `ceil` |
| Other | `abs`, `fact`, `degrees`, `radians` |

Anything else — a name, an import, a list, a call to something unlisted — is
rejected. Exponents are capped at ±1000, factorials at 500, and expressions at
200 characters so one request can't wedge the server.

## Fun facts

The panel on the right of the page shows a random maths or science fact,
served by the Node service (Express + cors) on port 3001:

```bash
curl http://127.0.0.1:3001/api/fact
# {"fact": "A day on Venus lasts longer...", "index": 10, "total": 20}

curl http://127.0.0.1:3001/api/facts   # all 20
curl http://127.0.0.1:3001/health
```

It fetches once per page load, so a refresh gets you a new one — or click the
↻ button to pull another without reloading. The facts live in the `FACTS`
array in `facts-server.js`; add to it and restart the service.

Because the page is served from port 8000 and the facts from 3001, the Node
side enables CORS.

## Using it

Click the keys or type. The keyboard accepts digits, `+ - * /` (and `x` for
×), `%`, `^`, `(`, `)`, `.`, `Enter`/`=` to calculate, `Backspace` to delete,
and `Esc` to clear. `r` inserts `√` and `p` inserts `π`.

Results land in the history panel — click any entry to reuse its value.

## Modes

The switcher above the display picks the keypad. Your choice is saved in
`localStorage`, and the expression on screen survives a switch.

**Standard** is the original four-function pad, plus `%`, `^`, `√` and brackets.

**Scientific** keeps those digits and operators exactly where they were and
stacks four rows of function keys on top: `sin` `cos` `tan` and their
inverses, `ln` and `log`, `x²` `xʸ` `√` `n!`, `eˣ` `10ˣ` `1/x` `|x|`, plus
`π`, `e` and `×10ˣ`. The **DEG**/**RAD** toggle beside the switcher sets the
unit for the trig keys — it is sent with the request, so the conversion
happens in Python rather than in the expression.

Buttons label themselves the way a calculator does and insert what Python
reads: `sin⁻¹` enters `asin(`, `n!` enters `fact(`, `x²` enters `^2`. A
function key opens its bracket and you can leave it open — unclosed brackets
are closed for you when you press `=`, so `√25` and `sin(90` both work.

Adding a third mode means adding a key array and one entry to `MODES` in
`static/app.jsx`.

## Themes

Four themes ship with the app — **Dark**, **Light**, **Midnight**, and
**Sunset**. The **Theme** button in the top-left corner opens a sidebar menu
listing them by name; close it with the ×, the backdrop, or `Esc`. Your choice
is saved in `localStorage`, and on a first visit the app follows your system's
light/dark preference.

Every colour is a CSS custom property in `static/styles.css`, so adding a
theme means adding one `[data-theme="..."]` block of tokens and one entry to
the `THEMES` array in `static/app.jsx`.

One note on symbols: `%` is **modulo** (`7 % 3` is `1`), not "percent of".

## Node

Node is not required to do arithmetic — only to serve facts. This project was
developed against Node 24 LTS installed to `~/.local/node` (WSL's `npm` on
`PATH` may be the Windows one from `/mnt/c`, which cannot run Linux builds).
