import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
