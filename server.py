#!/usr/bin/env python3
"""A tiny calculator backend built on the Python standard library.

Serves the React frontend in static/ and evaluates arithmetic expressions
posted to /api/calc, in standard, scientific or programmer form. Random facts
come from the separate Node service in
facts-server.js. Expressions are parsed with `ast` and walked by hand --
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
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

class CalculationError(Exception):
    """Raised for anything the user can fix by editing their expression."""


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

# Everything that is not angle-related. The trig family is layered on top of
# this per request, because it depends on the caller's degree/radian choice.
FUNCTIONS = {
    "sqrt": math.sqrt,
    "abs": abs,
    "round": round,
    "log": math.log10,
    "log2": math.log2,
    "ln": math.log,
    "exp": math.exp,
    "floor": math.floor,
    "ceil": math.ceil,
    "fact": lambda n: _factorial(n),
    "sinh": math.sinh,
    "cosh": math.cosh,
    "tanh": math.tanh,
    "degrees": math.degrees,
    "radians": math.radians,
}

# sin/cos/tan take an angle; asin/acos/atan return one. In degree mode each
# side is converted, so the frontend never has to rewrite the expression.
TRIG = ("sin", "cos", "tan")
INVERSE_TRIG = ("asin", "acos", "atan")

RADIAN_FUNCTIONS = {
    **FUNCTIONS,
    **{name: getattr(math, name) for name in TRIG + INVERSE_TRIG},
}

DEGREE_FUNCTIONS = {
    **FUNCTIONS,
    **{
        name: (lambda fn: lambda x: fn(math.radians(x)))(getattr(math, name))
        for name in TRIG
    },
    **{
        name: (lambda fn: lambda x: math.degrees(fn(x)))(getattr(math, name))
        for name in INVERSE_TRIG
    },
}

ANGLE_MODES = {"rad": RADIAN_FUNCTIONS, "deg": DEGREE_FUNCTIONS}
DEFAULT_ANGLE_MODE = "rad"

# "standard" and "scientific" share an evaluator -- they differ only in which
# keys the frontend offers. "programmer" is a separate one, below.
CALC_MODES = ("standard", "scientific", "programmer")
DEFAULT_MODE = "standard"

# Keeps `9 ** 9 ** 9` from hanging the server on a single request.
MAX_EXPONENT = 1000
MAX_EXPRESSION_LENGTH = 200
# 500! is a 1135-digit number -- past this the cost stops being trivial.
MAX_FACTORIAL = 500


def _factorial(n):
    """math.factorial with a ceiling, so one request cannot burn the CPU."""
    if isinstance(n, float):
        if not n.is_integer():
            raise CalculationError("Factorial needs a whole number")
        n = int(n)
    if not isinstance(n, int) or isinstance(n, bool):
        raise CalculationError("Factorial needs a whole number")
    if n < 0:
        raise CalculationError("Factorial needs a positive number")
    if n > MAX_FACTORIAL:
        raise CalculationError(f"Factorial input must be {MAX_FACTORIAL} or less")
    return math.factorial(n)


def evaluate(expression, angle=DEFAULT_ANGLE_MODE):
    """Evaluate an arithmetic expression string and return a number.

    `angle` picks the unit the trig functions speak, "rad" or "deg".
    """
    if len(expression) > MAX_EXPRESSION_LENGTH:
        raise CalculationError("Expression too long")
    functions = ANGLE_MODES.get(angle)
    if functions is None:
        raise CalculationError("Angle mode must be 'rad' or 'deg'")
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        raise CalculationError("Invalid expression")

    value = _eval_node(tree.body, functions)

    if isinstance(value, complex):
        raise CalculationError("Result is not a real number")
    if isinstance(value, float) and not math.isfinite(value):
        raise CalculationError("Result is undefined")
    return value


def _eval_node(node, functions):
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise CalculationError("Only numbers are allowed")
        return node.value

    if isinstance(node, ast.BinOp):
        op = BIN_OPS.get(type(node.op))
        if op is None:
            raise CalculationError("Unsupported operator")
        left = _eval_node(node.left, functions)
        right = _eval_node(node.right, functions)
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
        return op(_eval_node(node.operand, functions))

    if isinstance(node, ast.Name):
        if node.id not in CONSTANTS:
            raise CalculationError(f"Unknown name '{node.id}'")
        return CONSTANTS[node.id]

    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in functions:
            raise CalculationError("Unknown function")
        if node.keywords:
            raise CalculationError("Functions take positional arguments only")
        args = [_eval_node(arg, functions) for arg in node.args]
        try:
            return functions[node.func.id](*args)
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


# --- Programmer mode -------------------------------------------------------
# Integer-only arithmetic over a fixed word size, with the bitwise operators
# a programmer expects. Literals are read in the caller's base, so "FF" and
# "11111111" are the same request with a different `base`.

BASE_RADIX = {"hex": 16, "dec": 10, "oct": 8, "bin": 2}
DEFAULT_BASE = "dec"

BASE_DIGITS = {16: "0123456789abcdef", 10: "0123456789", 8: "01234567", 2: "01"}

# How each base renders a result. Decimal is handled separately: it is the
# only one that shows a sign rather than a bit pattern.
BASE_FORMATS = {16: "X", 8: "o", 2: "b"}

WIDTHS = (8, 16, 32, 64)
DEFAULT_WIDTH = 32

# `^` means XOR here rather than a power, so Pow is deliberately absent.
# Division, remainder and the shifts need more than an operator each and are
# handled in _eval_int_node.
PROGRAMMER_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.BitAnd: operator.and_,
    ast.BitOr: operator.or_,
    ast.BitXor: operator.xor,
}

PROGRAMMER_UNARY_OPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
    ast.Invert: operator.invert,
}

# A run of letters and digits is one number literal in the active base.
TOKEN_RE = re.compile(r"[0-9A-Za-z_]+")


def _wrap(value, width):
    """Truncate to `width` bits and read the result back as signed."""
    value &= (1 << width) - 1
    if value >= 1 << (width - 1):
        value -= 1 << width
    return value


def _int_divide(a, b):
    """Division that truncates toward zero, the way C does it."""
    if b == 0:
        raise CalculationError("Cannot divide by zero")
    quotient = abs(a) // abs(b)
    return -quotient if (a < 0) != (b < 0) else quotient


def _int_remainder(a, b):
    """Remainder whose sign follows the dividend -- again, C's rule."""
    return a - _int_divide(a, b) * b


def _rewrite_literals(expression, radix):
    """Rewrite every number literal from `radix` into plain decimal.

    Doing this before `ast.parse` means the parser only ever sees base 10,
    while "FF" and "1010" keep meaning what the caller typed. A token holding
    a digit the base does not have is a typo, and says so by name.
    """
    digits = BASE_DIGITS[radix]

    def replace(match):
        token = match.group(0)
        if any(ch not in digits for ch in token.lower()):
            raise CalculationError(f"'{token}' is not a base-{radix} number")
        return str(int(token, radix))

    return TOKEN_RE.sub(replace, expression)


def evaluate_programmer(expression, base=DEFAULT_BASE, width=DEFAULT_WIDTH):
    """Evaluate an integer expression written in `base`, over `width` bits."""
    if len(expression) > MAX_EXPRESSION_LENGTH:
        raise CalculationError("Expression too long")
    radix = BASE_RADIX.get(base)
    if radix is None:
        raise CalculationError("Base must be 'hex', 'dec', 'oct' or 'bin'")
    if width not in WIDTHS:
        raise CalculationError("Word size must be 8, 16, 32 or 64")

    try:
        tree = ast.parse(_rewrite_literals(expression, radix), mode="eval")
    except SyntaxError:
        raise CalculationError("Invalid expression")

    return _eval_int_node(tree.body, width)


def _eval_int_node(node, width):
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, int):
            raise CalculationError("Programmer mode works on whole numbers only")
        return _wrap(node.value, width)

    if isinstance(node, ast.BinOp):
        left = _eval_int_node(node.left, width)
        right = _eval_int_node(node.right, width)
        op_type = type(node.op)

        if op_type in (ast.Div, ast.FloorDiv):
            return _wrap(_int_divide(left, right), width)

        if op_type is ast.Mod:
            return _wrap(_int_remainder(left, right), width)

        if op_type in (ast.LShift, ast.RShift):
            if right < 0:
                raise CalculationError("Shift count cannot be negative")
            # Past the word size every bit has shifted out, so capping the
            # count keeps `1 << 10000` cheap without changing the answer.
            count = min(right, width)
            shifted = left << count if op_type is ast.LShift else left >> count
            return _wrap(shifted, width)

        op = PROGRAMMER_BIN_OPS.get(op_type)
        if op is None:
            raise CalculationError("Unsupported operator")
        return _wrap(op(left, right), width)

    if isinstance(node, ast.UnaryOp):
        op = PROGRAMMER_UNARY_OPS.get(type(node.op))
        if op is None:
            raise CalculationError("Unsupported operator")
        return _wrap(op(_eval_int_node(node.operand, width)), width)

    raise CalculationError("Invalid expression")


def format_in_base(value, base, width):
    """Render an integer the way the active base shows it.

    Decimal keeps the sign; the bit-oriented bases show the two's-complement
    pattern instead, which is what makes -1 read as FFFFFFFF.
    """
    radix = BASE_RADIX[base]
    if radix == 10:
        return str(value)
    return format(value & ((1 << width) - 1), BASE_FORMATS[radix])


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
            # Older clients send none of these; the defaults leave a bare
            # {"expression": ...} request behaving exactly as it always did.
            mode = str(payload.get("mode") or DEFAULT_MODE).strip().lower()
            angle = str(payload.get("angle") or DEFAULT_ANGLE_MODE).strip().lower()
            base = str(payload.get("base") or DEFAULT_BASE).strip().lower()
            width = int(payload.get("width") or DEFAULT_WIDTH)
        except (
            json.JSONDecodeError,
            KeyError,
            TypeError,
            UnicodeDecodeError,
            ValueError,
        ):
            self._send_json(400, {"error": "Expected JSON with an 'expression' field"})
            return

        if mode not in CALC_MODES:
            self._send_json(400, {"error": "Unknown mode"})
            return

        if not expression:
            self._send_json(400, {"error": "Expression is empty"})
            return

        try:
            if mode == "programmer":
                value = evaluate_programmer(expression, base, width)
                body = {
                    "expression": expression,
                    "mode": mode,
                    "base": base,
                    "width": width,
                    "result": format_in_base(value, base, width),
                }
            else:
                body = {
                    "expression": expression,
                    "angle": angle,
                    "result": format_number(evaluate(expression, angle)),
                }
        except CalculationError as exc:
            self._send_json(400, {"error": str(exc)})
            return
        except RecursionError:
            self._send_json(400, {"error": "Expression is too deeply nested"})
            return

        self._send_json(200, body)

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
