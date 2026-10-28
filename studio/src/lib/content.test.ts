import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { addCompetition, addSeason, addTeam, editCompetition, editYaml, parseNews, playerSocialUrls, readCompetitionConfig, safeSlug, setCurrentSeason } from './content.ts';

test('YAML preserves unknown fields', () => {
  const updated = editYaml('id: marco\nname: Marco\ncustom: kept\n', { name: 'Marco D.' });
  assert.match(updated, /custom: kept/);
  assert.match(updated, /name: Marco D\./);
});

test('news preserves custom metadata and creates a safe slug', () => {
  const news = parseNews('---\ntitle: Title\nextra: value\n---\nText');
  assert.match(news.update({ title: 'New' }, 'Body'), /extra: value/);
  assert.equal(safeSlug('Aurora News 2026/27!'), 'aurora-news-2026-27');
});

test('demo profiles and social_urls open without blocking Studio', () => {
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

test('adding a team preserves existing teams and rejects duplicate IDs', () => {
  const source = 'aurora:\n  name: Aurora\n  custom: kept\n';
  const added = addTeam(source, 'new-team', 'New Team', 'New');
  const value = parseDocument(added).toJS();
  assert.equal(value.aurora.custom, 'kept');
  assert.equal(value['new-team'].short_name, 'New');
  assert.throws(() => addTeam(added, 'new-team', 'Other', 'Other'), /already exists/);
  assert.throws(() => addTeam(source, '../bad', 'Other', 'Other'), /Team ID/);
});

test('new seasons and competitions preserve IDs and historical fields', () => {
  const source = readFileSync(new URL('../../../site/data/competitions.yaml', import.meta.url), 'utf8');
  const season = addSeason(source, '2027-28');
  const added = addCompetition(season, '2027-28', 'silver', 'Silver League', ['aurora']);
  const edited = editCompetition(added, '2027-28', 'silver', { name: 'Updated Silver League', win: 2, loss: 0, teams: ['aurora', 'stella'] });
  const selected = setCurrentSeason(edited, '2027-28');
  const config = readCompetitionConfig(selected);
  assert.equal(config.current_season, '2027-28');
  assert.equal(config.seasons.find((entry) => entry.id === '2027-28')?.competitions[0].id, 'silver');
  assert.deepEqual(config.seasons.find((entry) => entry.id === '2027-28')?.competitions[0].teams, ['aurora', 'stella']);
  assert.deepEqual(config.seasons.find((entry) => entry.id === '2026-27')?.competitions[0].teams, ['aurora']);
  assert.throws(() => addCompetition(added, '2027-28', 'silver', 'Duplicate', ['aurora']), /already exists/);
  assert.throws(() => addSeason(source, '2026-27'), /already exists/);
});

test('editing a historical competition preserves its ID and extra fields', () => {
  const source = 'current_season: 2025-26\nseasons:\n  - id: 2025-26\n    competitions:\n      - id: platinum\n        name: Original\n        team: aurora\n        custom: kept\n';
  const edited = editCompetition(source, '2025-26', 'platinum', { name: 'New name', teams: ['aurora'], win: 3 });
  const competition = readCompetitionConfig(edited).seasons[0].competitions[0] as { id: string; name: string; team: string; custom: string; standings_points: { win: number } };
  assert.equal(competition.id, 'platinum');
  assert.equal(competition.team, 'aurora');
  assert.equal(competition.custom, 'kept');
  assert.equal(competition.standings_points.win, 3);
});

