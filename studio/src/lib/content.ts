import { parseDocument } from 'yaml';

export function safeSlug(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}

export function editYaml(source: string, patch: Record<string, unknown>): string {
  const document = parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length) throw new Error(`YAML non valido: ${document.errors[0].message}`);
  if (!document.contents) throw new Error('YAML vuoto.');
  for (const [key, value] of Object.entries(patch)) document.setIn([key], value);
  return String(document);
}

const stableId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const seasonId = /^\d{4}-\d{2}$/;

function editableDocument(source: string) {
  const document = parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length) throw new Error(`YAML non valido: ${document.errors[0].message}`);
  if (!document.contents) throw new Error('YAML vuoto.');
  return document;
}

export type CompetitionEntry = {
  id: string; name: string; team?: string; teams?: string[];
  standings_points?: { win?: number | null; loss?: number | null };
};
export type SeasonEntry = { id: string; competitions: CompetitionEntry[] };
export type CompetitionConfig = { current_season: string; seasons: SeasonEntry[] };

export function readCompetitionConfig(source: string): CompetitionConfig {
  const value = editableDocument(source).toJS() as Partial<CompetitionConfig>;
  if (!Array.isArray(value.seasons)) throw new Error('Configurazione senza elenco stagioni.');
  return { current_season: value.current_season ?? '', seasons: value.seasons };
}

export function addTeam(source: string, id: string, name: string, shortName: string): string {
  const key = id.trim();
  if (!stableId.test(key)) throw new Error('ID squadra: usa solo lettere minuscole, numeri e trattini.');
  if (!name.trim() || !shortName.trim()) throw new Error('Inserisci nome completo e nome breve.');
  const document = editableDocument(source);
  if (document.has(key)) throw new Error(`La squadra ${key} esiste già.`);
  document.set(key, { name: name.trim(), short_name: shortName.trim(), logo: '' });
  return String(document);
}

export function addSeason(source: string, id: string): string {
  const key = id.trim();
  if (!seasonId.test(key) || Number(key.slice(5)) !== (Number(key.slice(0, 4)) + 1) % 100) {
    throw new Error('Stagione non valida: usa il formato 2027-28.');
  }
  const document = editableDocument(source);
  const config = document.toJS() as Partial<CompetitionConfig>;
  if (!Array.isArray(config.seasons)) throw new Error('Elenco stagioni mancante.');
  if (config.seasons.some((season) => season.id === key)) throw new Error(`La stagione ${key} esiste già.`);
  document.addIn(['seasons'], { id: key, competitions: [] });
  return String(document);
}

function competitionLocation(source: string, season: string, competition: string) {
  const document = editableDocument(source);
  const config = document.toJS() as CompetitionConfig;
  const seasonIndex = config.seasons?.findIndex((item) => item.id === season) ?? -1;
  if (seasonIndex < 0) throw new Error(`Stagione ${season} non trovata.`);
  const items = config.seasons[seasonIndex].competitions;
  if (!Array.isArray(items)) throw new Error('Elenco campionati mancante.');
  const competitionIndex = items.findIndex((item) => item.id === competition);
  return { document, items, seasonIndex, competitionIndex };
}

export function addCompetition(source: string, season: string, id: string, name: string, teams: string[]): string {
  const key = id.trim();
  if (!stableId.test(key)) throw new Error('ID campionato: usa solo lettere minuscole, numeri e trattini.');
  if (!name.trim()) throw new Error('Inserisci il nome del campionato.');
  if (!teams.length) throw new Error('Seleziona almeno una squadra partecipante.');
  const { document, items, seasonIndex } = competitionLocation(source, season, key);
  if (items.some((item) => item.id === key)) throw new Error(`Il campionato ${key} esiste già nella stagione ${season}.`);
  document.addIn(['seasons', seasonIndex, 'competitions'], {
    id: key, name: name.trim(), teams: [...new Set(teams)], standings_points: { win: null, loss: null },
  });
  return String(document);
}

export function editCompetition(source: string, season: string, id: string, patch: { name?: string; teams?: string[]; win?: number | null; loss?: number | null }): string {
  const { document, competitionIndex, seasonIndex } = competitionLocation(source, season, id);
  if (competitionIndex < 0) throw new Error(`Campionato ${id} non trovato nella stagione ${season}.`);
  const path = ['seasons', seasonIndex, 'competitions', competitionIndex];
  if (patch.name !== undefined) {
    document.setIn([...path, 'name'], patch.name);
  }
  if (patch.teams !== undefined) {
    if (!patch.teams.length) throw new Error('Seleziona almeno una squadra partecipante.');
    const existing = document.getIn([...path, 'team']);
    if (existing !== undefined && patch.teams.length === 1) {
      document.setIn([...path, 'team'], patch.teams[0]);
      document.deleteIn([...path, 'teams']);
    } else {
      document.setIn([...path, 'teams'], [...new Set(patch.teams)]);
      document.deleteIn([...path, 'team']);
    }
  }
  for (const key of ['win', 'loss'] as const) {
    if (patch[key] !== undefined) {
      const value = patch[key];
      if (value !== null && (!Number.isInteger(value) || value < 0)) throw new Error('I punti classifica devono essere interi non negativi.');
      document.setIn([...path, 'standings_points', key], value);
    }
  }
  return String(document);
}

export function setCurrentSeason(source: string, season: string): string {
  const document = editableDocument(source);
  const config = document.toJS() as CompetitionConfig;
  if (!config.seasons?.some((item) => item.id === season)) throw new Error(`Stagione ${season} non trovata.`);
  document.set('current_season', season);
  return String(document);
}

export function playerSocialUrls(document: ReturnType<typeof parseDocument>): string[] {
  // YAML collections are YAMLSeq nodes, not JavaScript arrays. Convert before rendering.
  const value = (document.toJS() as Record<string, unknown> | null)?.social_urls;
  return Array.isArray(value) ? value.filter((url): url is string => typeof url === 'string') : [];
}

export type NewsDocument = { metadata: Record<string, unknown>; body: string; update: (patch: Record<string, unknown>, body: string) => string };

export function parseNews(source: string): NewsDocument {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error('Notizia senza front matter YAML valido.');
  const document = parseDocument(match[1], { keepSourceTokens: true });
  if (document.errors.length) throw new Error(`Metadati notizia non validi: ${document.errors[0].message}`);
  const metadata = document.toJS() as Record<string, unknown>;
  return { metadata, body: match[2], update(patch, body) {
    for (const [key, value] of Object.entries(patch)) document.setIn([key], value);
    return `---\n${String(document).trimEnd()}\n---\n${body}`;
  } };
}

