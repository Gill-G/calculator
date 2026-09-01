// A tiny Express service whose only job is handing out a random maths or
// science fact. The Python server (port 8000) serves the app and does the
// arithmetic; this runs alongside it on port 3001.

const express = require("express");
const cors = require("cors");

const PORT = process.env.PORT || 3001;

const FACTS = [
  "A Mobius strip has only one side and one edge — trace it with a finger and you return to the start upside down.",
  "In a room of just 23 people, there is a better-than-even chance two share a birthday.",
  "Euler's identity, e^(iπ) + 1 = 0, links five of the most fundamental constants in mathematics.",
  "There are more real numbers between 0 and 1 than there are whole numbers in all of infinity.",
  "Goldbach's conjecture — every even number above 2 is the sum of two primes — has gone unproven since 1742.",
  "Euclid proved there are infinitely many prime numbers over 2,000 years ago, and the proof still fits on a napkin.",
  "Pi is irrational: its digits run forever without ever settling into a repeating pattern.",
  "In the Monty Hall problem, switching doors doubles your odds of winning from 1/3 to 2/3.",
  "Asked to sum 1 through 100, a young Gauss paired the numbers into fifties of 101 and answered 5050 almost at once.",
  "The number 0.999… repeating is not close to 1 — it is exactly equal to 1.",
  "A day on Venus lasts longer than a Venusian year: it spins slower than it orbits.",
  "A teaspoon of neutron star material would weigh about a billion tons on Earth.",
  "Sunlight takes roughly 8 minutes and 20 seconds to reach Earth, so you always see the Sun slightly in the past.",
  "Honey never spoils — edible jars of it have been found in ancient Egyptian tombs.",
  "Water is unusual: it expands as it freezes, which is why ice floats instead of sinking.",
  "Helium was discovered in the Sun's spectrum in 1868, decades before anyone found it on Earth.",
  "Octopuses have three hearts and blue blood, coloured by copper rather than iron.",
  "Sound travels about four times faster through water than it does through air.",
  "Bananas are faintly radioactive, thanks to the potassium-40 they contain.",
  "Under the Mpemba effect, hot water can sometimes freeze faster than cold water.",
];

const app = express();

// The page is served from port 8000, so it reaches this service cross-origin.
app.use(cors());

app.get("/api/fact", (req, res) => {
  const index = Math.floor(Math.random() * FACTS.length);
  res.json({ fact: FACTS[index], index, total: FACTS.length });
});

app.get("/api/facts", (req, res) => {
  res.json({ facts: FACTS, total: FACTS.length });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, facts: FACTS.length });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Facts service running at http://127.0.0.1:${PORT} (${FACTS.length} facts)`);
});
