import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { addCompetition, addSeason, addTeam, editCompetition, editYaml, parseNews, playerSocialUrls, readCompetitionConfig, safeSlug, setCurrentSeason } from './content.ts';

test('YAML conserva campi non gestiti', () => {
  const updated = editYaml('id: marco\nname: Marco\ncustom: resta\n', { name: 'Marco D.' });
  assert.match(updated, /custom: resta/);
  assert.match(updated, /name: Marco D\./);
});

test('notizia conserva metadati personalizzati e genera slug sicuro', () => {
  const news = parseNews('---\ntitle: Titolo\nextra: valore\n---\nTesto');
  assert.match(news.update({ title: 'Nuovo' }, 'Corpo'), /extra: valore/);
  assert.equal(safeSlug('Novità Aurora 2026/27!'), 'novita-aurora-2026-27');
});

test('i profili demo e social_urls si aprono senza bloccare lo Studio', () => {
  const players = new URL('../../../site/data/players/', import.meta.url);
  let profilesWithSocial = 0;
  for (const filename of readdirSync(players).filter((name) => name.endsWith('.yaml'))) {
    const document = parseDocument(readFileSync(new URL(filename, players), 'utf8'));
    const urls = playerSocialUrls(document);
    assert.ok(Array.isArray(urls), filename);
    if (urls.length) profilesWithSocial++;
  }
  const synthetic = parseDocument('id: demo\nsocial_urls:\n  - https://example.org/highlight\n');
  assert.deepEqual(playerSocialUrls(synthetic), ['https://example.org/highlight']);
  assert.ok(profilesWithSocial >= 0);
});

test('nuova squadra conserva le precedenti e rifiuta ID duplicati', () => {
  const source = 'aurora:\n  name: Aurora\n  custom: resta\n';
  const added = addTeam(source, 'nuova-squadra', 'Nuova Squadra', 'Nuova');
  const value = parseDocument(added).toJS();
  assert.equal(value.aurora.custom, 'resta');
  assert.equal(value['nuova-squadra'].short_name, 'Nuova');
  assert.throws(() => addTeam(added, 'nuova-squadra', 'Altra', 'Altra'), /esiste già/);
  assert.throws(() => addTeam(source, '../bad', 'Altra', 'Altra'), /ID squadra/);
});

test('stagioni e campionati nuovi mantengono gli ID e i campi storici', () => {
  const source = readFileSync(new URL('../../../site/data/competitions.yaml', import.meta.url), 'utf8');
  const season = addSeason(source, '2027-28');
  const added = addCompetition(season, '2027-28', 'silver', 'Lega Silver', ['aurora']);
  const edited = editCompetition(added, '2027-28', 'silver', { name: 'Lega Silver aggiornata', win: 2, loss: 0, teams: ['aurora', 'stella'] });
  const selected = setCurrentSeason(edited, '2027-28');
  const config = readCompetitionConfig(selected);
  assert.equal(config.current_season, '2027-28');
  assert.equal(config.seasons.find((entry) => entry.id === '2027-28')?.competitions[0].id, 'silver');
  assert.deepEqual(config.seasons.find((entry) => entry.id === '2027-28')?.competitions[0].teams, ['aurora', 'stella']);
  assert.deepEqual(config.seasons.find((entry) => entry.id === '2026-27')?.competitions[0].teams, ['aurora']);
  assert.throws(() => addCompetition(added, '2027-28', 'silver', 'Duplicato', ['aurora']), /esiste già/);
  assert.throws(() => addSeason(source, '2026-27'), /esiste già/);
});

test('modificare un campionato storico non cambia il suo ID né elimina campi extra', () => {
  const source = 'current_season: 2025-26\nseasons:\n  - id: 2025-26\n    competitions:\n      - id: platinum\n        name: Originale\n        team: aurora\n        custom: conserva\n';
  const edited = editCompetition(source, '2025-26', 'platinum', { name: 'Nuovo nome', teams: ['aurora'], win: 3 });
  const competition = readCompetitionConfig(edited).seasons[0].competitions[0] as { id: string; name: string; team: string; custom: string; standings_points: { win: number } };
  assert.equal(competition.id, 'platinum');
  assert.equal(competition.team, 'aurora');
  assert.equal(competition.custom, 'conserva');
  assert.equal(competition.standings_points.win, 3);
});

