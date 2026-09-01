# Calculator

A small calculator app: a **React** frontend that hands every expression to a
**Python** backend, which does the arithmetic and hands back the answer.

No build step and no dependencies — the whole thing runs on the Python standard
library, and React arrives from a CDN.

## Run it

```bash
python3 server.py            # then open http://127.0.0.1:8000
python3 server.py --port 3000
```

## Layout

| File | What it does |
| --- | --- |
| `server.py` | HTTP server, static file serving, and the expression evaluator |
| `static/index.html` | Page shell; pulls in React and Babel |
| `static/app.jsx` | The React UI — display, keypad, history |
| `static/styles.css` | Styling |

## How the math works

The frontend `POST`s to `/api/calc`:

```bash
curl -X POST http://127.0.0.1:8000/api/calc \
  -H 'Content-Type: application/json' \
  -d '{"expression": "2 + 3 * 4"}'
# {"expression": "2 + 3 * 4", "result": "14"}
```

Errors come back as `{"error": "Cannot divide by zero"}` with a 400.

`eval()` is never used. The expression is parsed with `ast` and the tree is
walked by hand, so only whitelisted nodes run: numbers, `+ - * / // % **`,
unary `+/-`, the constants `pi`/`e`/`tau`, and the functions `sqrt`, `abs`,
`round`, `log`, `ln`, `sin`, `cos`, `tan`. Anything else — a name, an import, a
list, a call to something unlisted — is rejected. Exponents are capped at
±1000 and expressions at 200 characters so one request can't wedge the server.

## Using it

Click the keys or type. The keyboard accepts digits, `+ - * /` (and `x` for
×), `%`, `^`, `(`, `)`, `.`, `Enter`/`=` to calculate, `Backspace` to delete,
and `Esc` to clear. `r` inserts `√` and `p` inserts `π`.

Results land in the history panel — click any entry to reuse its value.

## Themes

Four themes ship with the app — **Dark**, **Light**, **Midnight**, and
**Sunset** — picked from the swatches above the display. Your choice is saved
in `localStorage`, and on a first visit the app follows your system's
light/dark preference.

Every colour is a CSS custom property in `static/styles.css`, so adding a
theme means adding one `[data-theme="..."]` block of tokens and one entry to
the `THEMES` array in `static/app.jsx`.

Two notes on symbols: `%` is **modulo** (`7 % 3` is `1`), not "percent of",
and `√` opens `sqrt(` so you close the parenthesis yourself.
