import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rad = (d) => (d * Math.PI) / 180;

export function distanceKm(lat1, lon1, lat2, lon2) {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// compass direction from point 1 to point 2
export function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

const places = new Map();
async function placeName(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (places.has(key)) return places.get(key);
  try {
    // Nominatim policy: identify the app, max 1 request/s
    await new Promise((r) => setTimeout(r, 1100));
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`, {
      headers: { 'User-Agent': 'SondenScanner/1.0' },
    });
    const name = res.ok ? (await res.json()).name || null : null;
    places.set(key, name);
    return name;
  } catch {
    return null;
  }
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SondeHub HTTP ${res.status}`);
  return res.json();
}

export let latest = { updated: null, home: null, sondes: [] };
// shortcut: in-memory only, a restart forgets landed sondes
const seen = new Map();

async function scan({ lat, lon, radiusKm, warnKm, topic, publicUrl }, notified) {
  // a sonde can be hundreds of km away and still land nearby, so filter all active predictions by landing point
  const [predictions, active] = await Promise.all([
    getJson('https://api.v2.sondehub.org/predictions'),
    getJson('https://api.v2.sondehub.org/sondes?last=600'),
  ]);
  const sondes = predictions
    .map((p) => {
      const s = active[p.vehicle];
      if (!s) return null;
      const path = JSON.parse(p.data);
      const l = path.at(-1);
      const landKm = distanceKm(lat, lon, l.lat, l.lon);
      if (landKm > radiusKm) return null;
      return {
        serial: s.serial, type: s.subtype || s.type, lat: s.lat, lon: s.lon, alt: s.alt, vel_v: s.vel_v ?? 0,
        frequency: s.frequency, datetime: s.datetime, km: distanceKm(lat, lon, s.lat, s.lon), dir: bearing(lat, lon, s.lat, s.lon),
        path: path.map((pt) => [pt.lat, pt.lon]),
        landing: { lat: l.lat, lon: l.lon, time: l.time * 1000, km: landKm, dir: bearing(lat, lon, l.lat, l.lon) },
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.landing.km - b.landing.km);

  // a landed sonde drops out of SondeHub's active list: keep it on the map for 24 h after its last packet
  for (const s of sondes) seen.set(s.serial, s);
  for (const [serial, s] of seen) {
    s.lost = !sondes.includes(s);
    if (Date.now() - Date.parse(s.datetime) > 86_400_000) seen.delete(serial);
  }
  latest = { updated: Date.now(), home: { lat, lon, radiusKm, warnKm }, sondes: [...seen.values()].sort((a, b) => a.landing.km - b.landing.km) };

  console.log(`${new Date().toISOString()} ${sondes.length} sonde(s) landing within ${radiusKm} km`);
  for (const s of sondes) {
    // a sonde gets one normal alert, plus one urgent alert once its predicted landing moves within WARN_KM
    const warn = s.landing.km <= warnKm;
    const key = warn ? `warn:${s.serial}` : s.serial;
    // sequential on purpose (Nominatim 1 req/s); cached per ~1 km so the map stays current
    s.place = await placeName(s.lat, s.lon);
    if (s.landing) s.landing.place = await placeName(s.landing.lat, s.landing.lon);
    const speed = `${s.vel_v >= 0 ? 'rising' : 'falling'} ${Math.abs(s.vel_v).toFixed(1)} m/s`;
    const now = `${s.place ? `Near ${s.place} - ` : ''}${Math.round(s.alt)} m - ${speed} - ${s.frequency?.toFixed(2) ?? '?'} MHz`;
    const land = s.landing
      ? `Landing ~${new Date(s.landing.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` +
        `${s.landing.place ? ` near ${s.landing.place}` : ''} (${s.landing.km.toFixed(0)} km ${s.landing.dir} of you)`
      : 'No landing prediction';
    console.log(`  ${warn ? '!! ' : ''}${s.serial} ${s.km.toFixed(1)} km ${s.dir}: ${now} | ${land}`);
    if (notified.has(key)) continue;
    // shortcut: in-memory only, a restart re-notifies sondes still in range
    // JSON publish keeps umlauts in the title intact (HTTP headers would not)
    const r = await fetch('https://ntfy.sh/', {
      method: 'POST',
      body: JSON.stringify({
        topic,
        // ntfy priority 5 = urgent: long vibration, pop-over, red accent in the app
        priority: warn ? 5 : 3,
        tags: warn ? ['rotating_light'] : ['balloon'],
        title: `${warn ? 'WARNING: ' : ''}Sonde ${s.serial} lands ${s.landing.km.toFixed(0)} km ${s.landing.dir}`,
        message: `${now}\n${land}`,
        click: `${publicUrl}/?s=${encodeURIComponent(s.serial)}`,
      }),
    });
    if (r.ok) notified.add(key).add(s.serial);
    else console.error(`ntfy HTTP ${r.status}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { LAT, LON, RADIUS_KM, NTFY_TOPIC, INTERVAL_MIN = '2', PORT = '3000', WARN_KM = '30' } = process.env;
  if (!LAT || !LON || !RADIUS_KM || !NTFY_TOPIC) {
    console.error('Set LAT, LON, RADIUS_KM and NTFY_TOPIC in .env (see .env.example)');
    process.exit(1);
  }
  const publicUrl = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  const cfg = { lat: Number(LAT), lon: Number(LON), radiusKm: Number(RADIUS_KM), warnKm: Number(WARN_KM), topic: NTFY_TOPIC, publicUrl };
  const notified = new Set();
  const run = () => scan(cfg, notified).catch((e) => console.error('scan failed:', e.message));
  run();
  setInterval(run, Number(INTERVAL_MIN) * 60_000);

  const html = readFileSync(new URL('./map.html', import.meta.url));
  createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/') res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    else if (path === '/data') res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(latest));
    else res.writeHead(404).end();
  }).listen(Number(PORT), () => console.log(`Map on ${publicUrl}`));
}
