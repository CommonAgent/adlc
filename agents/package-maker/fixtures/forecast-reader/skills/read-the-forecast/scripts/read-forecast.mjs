// Read tomorrow's forecast for a city and say whether to take an umbrella.
//   node read-forecast.mjs <city> <records folder for this job>
//
// The forecast service is the one the owner binds as forecast-service. Where it
// answers is the setting FORECAST_SERVICE_URL and its key is FORECAST_API_KEY;
// both are placed at install, and this program carries neither.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function readForecast(city) {
  const where = process.env.FORECAST_SERVICE_URL;
  const key = process.env.FORECAST_API_KEY;
  const r = await fetch(`${where}/forecast?city=${encodeURIComponent(city)}&day=tomorrow`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`the forecast service answered ${r.status}`);
  return r.json();
}

export function advice(forecast) {
  return forecast.rain_chance >= 0.4 ? "Take an umbrella tomorrow." : "No umbrella needed tomorrow.";
}

const [city, records] = process.argv.slice(2);
if (city && records) {
  const forecast = await readForecast(city);
  mkdirSync(records, { recursive: true });
  writeFileSync(join(records, "forecast.json"), JSON.stringify(forecast, null, 2) + "\n");
  console.log(advice(forecast));
}
