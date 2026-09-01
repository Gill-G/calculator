#!/usr/bin/env python3
"""A tiny calculator backend built on the Python standard library.

Serves the React frontend in static/ and evaluates arithmetic expressions
posted to /api/calc. Expressions are parsed with `ast` and walked by hand --
`eval` is never used, so only the whitelisted operators below can run.

Usage:
    python3 server.py [--port 8000]
"""

import argparse
import ast
import json
import math
import operator
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg}

CONSTANTS = {"pi": math.pi, "e": math.e, "tau": math.tau}

FUNCTIONS = {
    "sqrt": math.sqrt,
    "abs": abs,
    "round": round,
    "log": math.log10,
    "ln": math.log,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
}

# Keeps `9 ** 9 ** 9` from hanging the server on a single request.
MAX_EXPONENT = 1000
MAX_EXPRESSION_LENGTH = 200


class CalculationError(Exception):
    """Raised for anything the user can fix by editing their expression."""


def evaluate(expression):
    """Evaluate an arithmetic expression string and return a number."""
    if len(expression) > MAX_EXPRESSION_LENGTH:
        raise CalculationError("Expression too long")
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        raise CalculationError("Invalid expression")

    value = _eval_node(tree.body)

    if isinstance(value, complex):
        raise CalculationError("Result is not a real number")
    if isinstance(value, float) and not math.isfinite(value):
        raise CalculationError("Result is undefined")
    return value


def _eval_node(node):
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise CalculationError("Only numbers are allowed")
        return node.value

    if isinstance(node, ast.BinOp):
        op = BIN_OPS.get(type(node.op))
        if op is None:
            raise CalculationError("Unsupported operator")
        left = _eval_node(node.left)
        right = _eval_node(node.right)
        if op is operator.pow and abs(right) > MAX_EXPONENT:
            raise CalculationError(f"Exponent must be within +/-{MAX_EXPONENT}")
        try:
            return op(left, right)
        except ZeroDivisionError:
            raise CalculationError("Cannot divide by zero")
        except OverflowError:
            raise CalculationError("Number too large")

    if isinstance(node, ast.UnaryOp):
        op = UNARY_OPS.get(type(node.op))
        if op is None:
            raise CalculationError("Unsupported operator")
        return op(_eval_node(node.operand))

    if isinstance(node, ast.Name):
        if node.id not in CONSTANTS:
            raise CalculationError(f"Unknown name '{node.id}'")
        return CONSTANTS[node.id]

    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS:
            raise CalculationError("Unknown function")
        if node.keywords:
            raise CalculationError("Functions take positional arguments only")
        args = [_eval_node(arg) for arg in node.args]
        try:
            return FUNCTIONS[node.func.id](*args)
        except (ValueError, TypeError):
            raise CalculationError(f"Bad input for {node.func.id}()")
        except ZeroDivisionError:
            raise CalculationError("Cannot divide by zero")

    raise CalculationError("Invalid expression")


def format_number(value):
    """Render a result the way a calculator display would."""
    if isinstance(value, int):
        return str(value)
    if value == int(value) and abs(value) < 1e16:
        return str(int(value))
    text = f"{value:.12g}"
    return text


class CalculatorHandler(SimpleHTTPRequestHandler):
    # Browsers get a sensible type for the JSX that Babel loads at runtime.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".jsx": "text/jsx"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def do_POST(self):
        if self.path.split("?")[0] != "/api/calc":
            self.send_error(404, "Not found")
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > 4096:
            self._send_json(400, {"error": "Missing or oversized request body"})
            return

        try:
            payload = json.loads(self.rfile.read(length))
            expression = str(payload["expression"]).strip()
        except (json.JSONDecodeError, KeyError, TypeError, UnicodeDecodeError):
            self._send_json(400, {"error": "Expected JSON with an 'expression' field"})
            return

        if not expression:
            self._send_json(400, {"error": "Expression is empty"})
            return

        try:
            result = evaluate(expression)
        except CalculationError as exc:
            self._send_json(400, {"error": str(exc)})
            return
        except RecursionError:
            self._send_json(400, {"error": "Expression is too deeply nested"})
            return

        self._send_json(200, {"expression": expression, "result": format_number(result)})

    def _send_json(self, status, body):
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def end_headers(self):
        # The frontend is served from this same origin, so nothing is cached
        # aggressively -- handy while editing app.jsx.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f"[calculator] {fmt % args}")


def main():
    parser = argparse.ArgumentParser(description="Run the calculator app.")
    parser.add_argument("--port", type=int, default=8000, help="port to listen on")
    parser.add_argument("--host", default="127.0.0.1", help="host to bind")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), CalculatorHandler)
    print(f"Calculator running at http://{args.host}:{args.port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
