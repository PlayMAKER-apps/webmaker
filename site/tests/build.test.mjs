import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

const club=YAML.parse(readFileSync('data/club.yaml','utf8'));
const teams=YAML.parse(readFileSync('data/teams.yaml','utf8'));
const competitions=YAML.parse(readFileSync('data/competitions.yaml','utf8'));
const firstTeam=Object.keys(teams)[0];
const currentSeason=competitions.seasons.find((season)=>season.id===competitions.current_season)??competitions.seasons[0];
const firstCompetition=currentSeason.competitions[0];

for (const theme of ['bold','classic','dynamic']) test(`${theme}: same URLs and data`, () => {
  const run=spawnSync(process.execPath,['scripts/build-data.mjs'],{env:{...process.env,WEBMAKER_THEME:theme},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const home=readFileSync('dist/index.html','utf8');
  const roster=readFileSync(`dist/roster/${firstTeam}/index.html`,'utf8');
  assert.match(home,new RegExp(`theme-${theme}`));
  assert.match(home,new RegExp(club.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(roster,new RegExp(teams[firstTeam].name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(home,/Nerone Basket/);
});
test('football profile changes labels without changing data',()=>{
  const run=spawnSync(process.execPath,['scripts/build-data.mjs'],{env:{...process.env,WEBMAKER_SPORT:'football'},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const page=readFileSync(`dist/competition/${currentSeason.id}/${firstCompetition.id}/index.html`,'utf8');
  assert.match(page,/Football/);
  if(page.includes('<table'))assert.match(page,/Goals/);
  assert.doesNotMatch(page,/>Q2</);
});
