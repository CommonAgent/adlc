---
name: read-the-forecast
description: Read tomorrow's forecast for the city the caller names and say whether to take an umbrella.
---

# Read the forecast

Run `scripts/read-forecast.mjs` with the city the caller named and the job's
records folder. It reads tomorrow's forecast from the forecast service the
owner bound, keeps the forecast as it was read in the records folder, and
prints one line of advice. Hand that line back to the caller as it is.

The forecast service is granted at read access. Never write to it, and read
nothing from it but the forecast for the city the caller named.
