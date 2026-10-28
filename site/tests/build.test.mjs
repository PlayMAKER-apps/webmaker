import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { buildPublicClub } from '../scripts/export-public-club.mjs';

for (const theme of ['bold','classic','dynamic']) test(`${theme}: same URLs and data`, () => {
  const run=spawnSync(process.execPath,['scripts/build-data.mjs'],{env:{...process.env,WEBMAKER_THEME:theme},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const home=readFileSync('dist/index.html','utf8');
  const roster=readFileSync('dist/roster/aurora/index.html','utf8');
  assert.match(home,new RegExp(`theme-${theme}`));
  assert.match(home,/Aurora Sport Club/);
  assert.match(roster,/Alex Riva/);
  assert.doesNotMatch(home,/Nerone Basket/);
});
test('football profile changes labels without changing data',()=>{
  const run=spawnSync(process.execPath,['scripts/build-data.mjs'],{env:{...process.env,WEBMAKER_SPORT:'football'},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const page=readFileSync('dist/competition/2026-27/amatori/index.html','utf8');
  assert.match(page,/Goals/);
  assert.doesNotMatch(page,/>Q2</);
});
test('manual public export selects only publishable fields', () => {
  const document = buildPublicClub({ now: new Date('2026-10-28T10:00:00Z') });
  assert.equal(document.schema_version, '0.1');
  assert.equal(document.fixtures.length, 2);
  assert.deepEqual(document.results, [{ fixture_id: 'demo-01', home_score: 78, away_score: 72 }]);
  assert.equal(document.club.name, 'Aurora Sport Club');
  assert.ok(!('players' in document));
  assert.doesNotMatch(JSON.stringify(document), /info@example\.org|instagram_url|youtube_url|notes|bio/);
});
test('public export accepts the deployed GitHub Pages base path', () => {
  const document = buildPublicClub({ basePath: '/club-site', siteUrl: 'https://example.github.io/club-site/' });
  assert.equal(document.source.base_path, '/club-site');
  assert.equal(document.source.site_url, 'https://example.github.io/club-site/');
});
test('public export can select players while preserving roster CSV', () => {
  const document = buildPublicClub({ selection: { enabled: true, club_id: 'aurora-club', include_players: true, player_ids: ['alex-riva'], include_stats: false, sponsors: [] } });
  assert.equal(document.players.length, 1);
  assert.equal(document.rosters[0].player_ids[0], 'alex-riva');
  assert.match(readFileSync('data/rosters.csv', 'utf8'), /sam-neri/);
});
test('static JSON is opt-in and respects a disable override', () => {
  const disabled = spawnSync(process.execPath, ['scripts/build-data.mjs'], { env: { ...process.env, WEBMAKER_PUBLISH_CLUB_JSON: '0' }, encoding: 'utf8' });
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.equal(existsSync('dist/data/playmaker-club-0.1.json'), false);
  const enabled = spawnSync(process.execPath, ['scripts/build-data.mjs'], { env: { ...process.env, WEBMAKER_PUBLISH_CLUB_JSON: '1' }, encoding: 'utf8' });
  assert.equal(enabled.status, 0, enabled.stderr);
  assert.equal(existsSync('dist/data/playmaker-club-0.1.json'), true);
});
