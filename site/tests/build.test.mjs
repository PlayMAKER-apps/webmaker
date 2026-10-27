import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

for (const theme of ['bold','classic','dynamic']) test(`${theme}: stessi URL e dati`, () => {
  const run=spawnSync(process.execPath,['scripts/build-data.mjs'],{env:{...process.env,WEBMAKER_THEME:theme},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const home=readFileSync('dist/index.html','utf8');
  const roster=readFileSync('dist/roster/aurora/index.html','utf8');
  assert.match(home,new RegExp(`theme-${theme}`));
  assert.match(home,/Aurora Sport Club/);
  assert.match(roster,/Alex Riva/);
  assert.doesNotMatch(home,/Nerone Basket/);
});
test('profilo calcio cambia i termini senza alterare i dati',()=>{
  const run=spawnSync(process.execPath,['scripts/build-data.mjs'],{env:{...process.env,WEBMAKER_SPORT:'football'},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const page=readFileSync('dist/campionato/2026-27/amatori/index.html','utf8');
  assert.match(page,/Gol/);
  assert.doesNotMatch(page,/>Q2</);
});
