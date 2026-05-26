#!/usr/bin/env node
// One-off script: fetch Mapbox Directions API polylines for the fixture legs.
// Usage: node scripts/fetch-directions.mjs <MAPBOX_PUBLIC_TOKEN>

const token = process.argv[2];
if (!token || !token.startsWith('pk.')) {
  console.error('Usage: node scripts/fetch-directions.mjs <pk.your-token>');
  process.exit(1);
}

const legs = [
  { from: 'Ciney',  to: 'Namur', fromCoord: [5.0944, 50.2929], toCoord: [4.8674, 50.4674] },
  { from: 'Namur',  to: 'Liège', fromCoord: [4.8674, 50.4674], toCoord: [5.5734, 50.6326] },
];

async function fetchLeg(leg) {
  const coords = `${leg.fromCoord[0]},${leg.fromCoord[1]};${leg.toCoord[0]},${leg.toCoord[1]}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=polyline&overview=full&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${leg.from} → ${leg.to}: HTTP ${res.status} — ${body}`);
  }

  const data = await res.json();
  if (!data.routes || !data.routes.length) {
    throw new Error(`${leg.from} → ${leg.to}: no routes returned`);
  }

  const route = data.routes[0];
  return {
    label: `${leg.from} → ${leg.to}`,
    polyline: route.geometry,
    distanceKm: (route.distance / 1000).toFixed(1),
    durationMin: (route.duration / 60).toFixed(1),
  };
}

console.log('Fetching directions for fixture legs…\n');

for (const leg of legs) {
  try {
    const result = await fetchLeg(leg);
    console.log(`── ${result.label} (${result.distanceKm} km, ${result.durationMin} min)`);
    console.log(`   lineToNext: '${result.polyline}'`);
    console.log();
  } catch (err) {
    console.error(`✗ ${err.message}`);
  }
}

console.log('Done. Paste the lineToNext values into FIXTURE_FALLBACK in journey-map.js');
