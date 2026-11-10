import { test } from 'node:test';
import assert from 'node:assert';
import { distanceKm, bearing } from './index.js';

test('distanceKm Munich -> Augsburg is ~57 km', () => {
  const km = distanceKm(48.1372, 11.5756, 48.3705, 10.8978);
  assert.ok(km > 55 && km < 59, `got ${km}`);
});

test('bearing Munich -> Augsburg is NW (~297°)', () => {
  assert.strictEqual(bearing(48.1372, 11.5756, 48.3705, 10.8978), 'NW');
});
