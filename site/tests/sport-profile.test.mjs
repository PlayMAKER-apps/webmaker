import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSportProfile, sumProfileStat } from '../scripts/sport-profile.mjs';

for (const sport of ['basketball', 'football']) {
  test(`${sport} profile is valid`, () => {
    const profile = JSON.parse(readFileSync(new URL(`../../shared/profiles/${sport}.json`, import.meta.url)));
    assert.equal(validateSportProfile(profile, sport).id, sport);
  });
}

test('custom sport statistics use profile keys without changing roster data', () => {
  const profile = validateSportProfile({
    id: 'volleyball', name: 'Volleyball', scoreLabel: 'Sets',
    periods: ['Set 1', 'Set 2'], stats: [{ key: 'aces', label: 'Aces' }]
  }, 'volleyball');
  assert.equal(sumProfileStat([{ aces: '2' }, { aces: '3' }], profile.stats[0].key), 5);
  assert.equal(sumProfileStat([{ points: '7' }], profile.stats[0].key), 0);
  assert.throws(() => sumProfileStat([{ aces: 'not-a-number' }], 'aces'), /Invalid aces/);
  assert.throws(() => validateSportProfile({ ...profile, stats: [profile.stats[0], profile.stats[0]] }, 'volleyball'), /duplicate/);
});
