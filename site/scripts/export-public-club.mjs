import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readYaml = file => YAML.parse(readFileSync(file, 'utf8'));
function csv(source) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') { if (quoted && source[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\r' || c === '\n') && !quoted) { if (c === '\r' && source[i + 1] === '\n') i++; row.push(field); if (row.some(v => v.trim())) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  const [head = [], ...body] = rows;
  return body.map(cells => Object.fromEntries(head.map((name, i) => [name.trim(), cells[i]?.trim() ?? ''])));
}
function readCsv(root, relative) {
  const file = join(root, 'data', relative);
  return existsSync(file) ? csv(readFileSync(file, 'utf8')) : [];
}
function assetUrl(value, siteRoot, origin, base) {
  if (!value) return undefined;
  if (/^https:\/\//.test(value)) return value;
  if (!/^\/assets\/[a-zA-Z0-9/_\-.]+\.(png|jpe?g|webp|svg)$/i.test(value)) throw new Error(`Invalid public asset path: ${value}`);
  if (!existsSync(join(siteRoot, 'public', value.slice(1)))) throw new Error(`Missing public asset: ${value}`);
  return new URL(`${base}${value}`, origin).href;
}
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
function id(value, label) { if (typeof value !== 'string' || !idPattern.test(value)) throw new Error(`Invalid ${label} ID`); return value; }
function score(value, label) { const n = Number(value); if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid ${label} score`); return n; }

export function buildPublicClub({ siteRoot = defaultRoot, now = new Date(), selection, basePath, siteUrl } = {}) {
  const dataRoot = join(siteRoot, 'data');
  const club = readYaml(join(dataRoot, 'club.yaml'));
  const teamsData = readYaml(join(dataRoot, 'teams.yaml'));
  const competitionsData = readYaml(join(dataRoot, 'competitions.yaml'));
  const settings = selection ?? readYaml(join(dataRoot, 'public-export.yaml'));
  if (settings.enabled !== true) throw new Error('Public export is disabled in data/public-export.yaml');
  if (club.schema_version !== '0.1') throw new Error('Unsupported WebMAKER site schema');
  const base = basePath ?? club.base_path ?? '';
  if (base && !/^\/[A-Za-z0-9/_-]+$/.test(base)) throw new Error('Invalid base_path');
  const publicSiteUrl = siteUrl ?? club.site_url;
  if (!/^https:\/\//.test(publicSiteUrl)) throw new Error('Public site URL must use HTTPS');
  const origin = new URL(publicSiteUrl).origin;
  const teams = Object.entries(teamsData).map(([teamId, team]) => ({
    id: id(teamId, 'team'), name: String(team.name),
    ...(team.short_name ? { short_name: String(team.short_name) } : {}),
    ...(assetUrl(team.logo, siteRoot, origin, base) ? { logo_url: assetUrl(team.logo, siteRoot, origin, base) } : {})
  }));
  const seasons = competitionsData.seasons ?? [];
  const squadIds = new Set(seasons.flatMap(season => season.competitions.flatMap(competition => competition.teams ?? (competition.team ? [competition.team] : []))));
  const squads = [...squadIds].map(teamId => ({ id: id(teamId, 'squad'), team_id: teamId, label: teamsData[teamId]?.name ?? teamId }));
  const competitions = seasons.flatMap(season => season.competitions.map(item => ({
    id: id(`${season.id}/${item.id}`, 'competition'), name: String(item.name), season: String(season.id),
    squad_ids: item.teams ?? (item.team ? [item.team] : [])
  })));
  const fixtures = [], results = [];
  for (const season of seasons) for (const competition of season.competitions) {
    for (const game of readCsv(siteRoot, `games/${season.id}/${competition.id}.csv`)) {
      if (!['scheduled', 'final'].includes(game.status)) continue;
      const fixture = {
        id: id(game.id, 'fixture'), competition_id: `${season.id}/${competition.id}`,
        home_team_id: id(game.home_team, 'home team'), away_team_id: id(game.away_team, 'away team'),
        date: game.date, status: game.status,
        ...(game.time ? { time: game.time } : {}), ...(game.venue ? { venue: game.venue } : {})
      };
      fixtures.push(fixture);
      if (game.status === 'final' && game.home_score !== '' && game.away_score !== '') {
        results.push({ fixture_id: game.id, home_score: score(game.home_score, 'home'), away_score: score(game.away_score, 'away') });
      }
    }
  }
  const selectedPlayers = new Set(settings.include_players ? settings.player_ids ?? [] : []);
  const players = readdirSync(join(dataRoot, 'players')).filter(name => /\.ya?ml$/.test(name) && !name.startsWith('_'))
    .map(name => readYaml(join(dataRoot, 'players', name))).filter(player => selectedPlayers.has(player.id))
    .map(player => ({ id: id(player.id, 'player'), name: String(player.name) }));
  if (selectedPlayers.size !== players.length) throw new Error('Selected public player is missing');
  const memberships = readCsv(siteRoot, 'rosters.csv');
  const rosters = settings.include_players ? competitions.flatMap(competition => competition.squad_ids.map(squadId => {
    const playerIds = memberships.filter(row => row.season === competition.season && `${row.season}/${row.competition}` === competition.id && row.team_id === squadId && selectedPlayers.has(row.player_id)).map(row => row.player_id);
    return { id: `${competition.id}/${squadId}`, squad_id: squadId, competition_id: competition.id, player_ids: [...new Set(playerIds)] };
  })) : undefined;
  const playerStats = settings.include_stats && settings.include_players ? seasons.flatMap(season => season.competitions.flatMap(competition =>
    readCsv(siteRoot, `player-stats/${season.id}/${competition.id}.csv`).filter(row => selectedPlayers.has(row.player_id) && fixtures.some(fixture => fixture.id === row.game_id))
      .map(row => ({ fixture_id: row.game_id, player_id: row.player_id, values: Object.fromEntries(Object.entries(row).filter(([key, value]) => !['game_id', 'player_id', 'minutes'].includes(key) && value !== '' && Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)])) }))
  )) : undefined;
  const sponsors = (settings.sponsors ?? []).map(sponsor => ({ id: id(sponsor.id, 'sponsor'), name: String(sponsor.name), logo_url: assetUrl(sponsor.logo_url, siteRoot, origin, base), license: String(sponsor.license) }));
  if (sponsors.some(sponsor => !sponsor.logo_url || !sponsor.license.trim())) throw new Error('Public sponsors need a logo and license');
  return {
    schema_version: '0.1',
    club: { id: id(settings.club_id, 'club'), name: String(club.name), sport: String(club.sport), timezone: String(club.timezone),
      branding: { primary_color: club.colors.primary, accent_color: club.colors.accent,
        ...(assetUrl(club.logo, siteRoot, origin, base) ? { logo_url: assetUrl(club.logo, siteRoot, origin, base) } : {}) } },
    squads, teams, competitions, fixtures, results,
    ...(settings.include_players ? { players, rosters } : {}),
    ...(playerStats ? { player_stats: playerStats } : {}),
    ...(sponsors.length ? { sponsors } : {}),
    source: { product: 'webmaker', site_url: String(publicSiteUrl), base_path: base },
    exported_at: now.toISOString()
  };
}

export function writePublicClub(file, options = {}) {
  const output = buildPublicClub(options);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out') {
    console.error('Usage: node scripts/export-public-club.mjs --out <json-file>'); process.exitCode = 2;
  } else {
    try { const output = writePublicClub(resolve(args[1])); console.log(`Exported ${output.fixtures.length} public fixtures to ${resolve(args[1])}`); }
    catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
  }
}
