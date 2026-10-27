import { useEffect, useMemo, useRef, useState } from 'react';
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { marked } from 'marked';
import { parseDocument } from 'yaml';
import { call, type BackupResult, type Catalog, type Draft, type ProjectInfo, type PublicationPreview, type PublicationResult, type ValidationReport } from './lib/api';
import { CsvDocument } from './lib/csv';
import { addCompetition, addSeason, addTeam, editCompetition, editYaml, parseNews, playerSocialUrls, readCompetitionConfig, safeSlug, setCurrentSeason } from './lib/content';

type Section = 'dashboard' | 'branding' | 'games' | 'teams' | 'competitions' | 'players' | 'rosters' | 'stats' | 'news' | 'media' | 'backup' | 'publish';
const sections: { id: Section; label: string; group: string }[] = [
  { id: 'dashboard', label: 'Panoramica', group: 'Studio' },
  { id: 'branding', label: 'Club e tema', group: 'Studio' },
  { id: 'games', label: 'Partite', group: 'Contenuti' },
  { id: 'teams', label: 'Squadre', group: 'Contenuti' },
  { id: 'competitions', label: 'Campionati', group: 'Contenuti' },
  { id: 'players', label: 'Giocatori', group: 'Contenuti' },
  { id: 'rosters', label: 'Roster', group: 'Contenuti' },
  { id: 'stats', label: 'Statistiche', group: 'Contenuti' },
  { id: 'news', label: 'Notizie', group: 'Contenuti' },
  { id: 'media', label: 'Immagini', group: 'Strumenti' },
  { id: 'backup', label: 'Backup', group: 'Strumenti' },
  { id: 'publish', label: 'Pubblica', group: 'Strumenti' },
];
const fieldLabels: Record<string, string> = {
  id: 'ID stabile', date: 'Data', time: 'Ora', status: 'Stato', home_team: 'Squadra casa', away_team: 'Squadra ospite',
  home_score: 'Punti casa', away_score: 'Punti ospite', venue: 'Campo', address: 'Indirizzo', instagram_url: 'Post Instagram', youtube_url: 'Video YouTube',
  notes: 'Note', phase: 'Fase', round: 'Turno', game_id: 'Partita', player_id: 'Giocatore', minutes: 'Minuti (MM:SS)', points: 'Punti',
  three_pointers_made: 'Tiri da 3', two_pointers_made: 'Tiri da 2', free_throws_made: 'Tiri liberi', fouls: 'Falli',
  rebounds_off: 'Rimbalzi off.', rebounds_def: 'Rimbalzi dif.', assists: 'Assist', turnovers: 'Palle perse', season: 'Stagione',
  competition: 'Campionato', team_id: 'Squadra', number: 'Numero', role: 'Ruolo', active: 'Attivo',
};
const preferredFields: Record<'games' | 'stats' | 'rosters', string[]> = {
  games: ['id', 'date', 'time', 'status', 'home_team', 'away_team', 'home_score', 'away_score', 'venue', 'address', 'phase', 'round', 'notes', 'instagram_url', 'youtube_url'],
  stats: ['game_id', 'player_id', 'minutes', 'points', 'three_pointers_made', 'two_pointers_made', 'free_throws_made', 'fouls', 'rebounds_off', 'rebounds_def', 'assists', 'turnovers'],
  rosters: ['season', 'competition', 'team_id', 'player_id', 'number', 'role', 'active'],
};
const newCsvHeaders = {
  games: 'id,date,time,status,home_team,away_team,home_score,away_score,venue,address,instagram_url,youtube_url,notes,phase,round\n',
  stats: 'game_id,player_id,minutes,points,three_pointers_made,two_pointers_made,free_throws_made,fouls,rebounds_off,rebounds_def,assists,turnovers\n',
};

function formatTime(value: string | null): string {
  return value ? new Date(Number(value) * 1000).toLocaleString('it-IT') : 'mai in questa copia';
}
function fileTitle(path: string) { return path.split('/').slice(-2).join(' / '); }
function ErrorNotice({ text }: { text: string }) { return text ? <div className="notice error" role="alert">{text}</div> : null; }
function Notice({ text }: { text: string }) { return text ? <div className="notice" role="status">{text}</div> : null; }

export function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [catalog, setCatalog] = useState<Catalog>({ teams: [], players: [], games: [] });
  const [section, setSection] = useState<Section>('dashboard');
  const [files, setFiles] = useState<string[]>([]);
  const [file, setFile] = useState('');
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedCompetition, setSelectedCompetition] = useState('');
  const [newTeamId, setNewTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamShortName, setNewTeamShortName] = useState('');
  const [newSeasonId, setNewSeasonId] = useState('');
  const [newCompetitionId, setNewCompetitionId] = useState('');
  const [newCompetitionName, setNewCompetitionName] = useState('');
  const [newCompetitionTeams, setNewCompetitionTeams] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [publishFiles, setPublishFiles] = useState<string[]>([]);
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [commitMessage, setCommitMessage] = useState('Aggiorna contenuti WebMAKER');
  const [published, setPublished] = useState<PublicationResult | null>(null);
  const [mediaPath, setMediaPath] = useState('');
  const [mediaPreview, setMediaPreview] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const history = useRef<string[]>([]);
  const dirty = Boolean(file) && content !== savedContent;

  const csv = useMemo(() => {
    if (!['games', 'stats', 'rosters'].includes(section) || !content) return null;
    try { return new CsvDocument(content); } catch { return null; }
  }, [content, section]);
  const news = useMemo(() => {
    if (section !== 'news' || !content) return null;
    try { return parseNews(content); } catch { return null; }
  }, [content, section]);

  function change(next: string) {
    if (next === content) return;
    history.current = [...history.current.slice(-49), content];
    setContent(next);
    setPreview(null);
  }
  function undo() {
    const previous = history.current.pop();
    if (previous !== undefined) setContent(previous);
  }
  async function run<T>(work: () => Promise<T>, success?: string): Promise<T | undefined> {
    setError(''); setNotice(''); setBusy(true);
    try { const value = await work(); if (success) setNotice(success); return value; }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function refreshProject() {
    const updated = await call<ProjectInfo>('project_info');
    setProject(updated);
    setPublishFiles((current) => current.filter((path) => updated.changedFiles.includes(path)));
    return updated;
  }
  async function preserveDraft(): Promise<boolean> {
    if (!project || !file || !dirty) return true;
    try {
      await call('save_draft', { relative: file, content });
      return true;
    } catch (cause) {
      setError(`Impossibile conservare la bozza: ${cause}`);
      return false;
    }
  }
  async function openProject() {
    if (!await preserveDraft()) return;
    const chosen = await open({ directory: true, multiple: false, title: 'Seleziona la cartella del sito WebMAKER' });
    if (typeof chosen !== 'string') return;
    await run(async () => {
      const loaded = await call<ProjectInfo>('open_project', { path: chosen });
      setProject(loaded);
      setCatalog(await call<Catalog>('catalog'));
      setSection('dashboard'); setFile('');
      setPublishFiles(loaded.changedFiles.filter((path) => path.startsWith('site/data/') || path.startsWith('site/content/news/') || path.startsWith('site/public/assets/')));
    }, 'Progetto locale aperto. Le modifiche si salvano prima sul PC.');
  }
  async function loadFile(relative: string) {
    if (!relative || !await preserveDraft()) return;
    await run(async () => {
      const disk = await call<string>('read_project_file', { relative });
      const draft = await call<Draft | null>('read_draft', { relative });
      const recovered = draft && draft.content !== disk;
      const starter = !disk && relative.startsWith('site/data/games/') ? newCsvHeaders.games
        : !disk && relative.startsWith('site/data/player-stats/') ? newCsvHeaders.stats : disk;
      setFile(relative); setSavedContent(disk); setContent(recovered ? draft.content : starter);
      setSelectedRow(null); setSelectedTeam(''); setSelectedSeason(''); setSelectedCompetition(''); history.current = [];
      if (recovered) setNotice(`Bozza locale recuperata (${formatTime(String(draft.savedAt))}). Usa “Salva sul PC” per applicarla.`);
      else if (!disk && starter) setNotice('Archivio nuovo: aggiungi i record e salva sul PC per creare il CSV.');
    });
  }
  async function go(next: Section) {
    if (!await preserveDraft()) return;
    setSection(next); setFile(''); setContent(''); setSavedContent(''); setSelectedRow(null); setFilter(''); setError(''); setNotice('');
    if (!project) return;
    if (next === 'rosters') { await loadFile('site/data/rosters.csv'); return; }
    if (next === 'teams') { await loadFile('site/data/teams.yaml'); return; }
    if (next === 'branding') { await loadFile('site/data/club.yaml'); return; }
    if (next === 'competitions') { await loadFile('site/data/competitions.yaml'); return; }
    const kind = next === 'games' ? 'games' : next === 'stats' ? 'stats' : next === 'players' ? 'players' : next === 'news' ? 'news' : '';
    if (kind) await run(async () => { setFiles(await call<string[]>('list_files', { kind })); });
    if (next === 'publish') await run(async () => { await refreshProject(); setValidation(await call<ValidationReport>('validate_project')); });
  }
  async function saveFile() {
    if (!file || !dirty) return;
    await run(async () => {
      await call('write_project_file', { relative: file, content, expectedContent: savedContent });
      await call('clear_draft', { relative: file });
      setSavedContent(content);
      if (!files.includes(file)) setFiles((old) => [...old, file].sort());
      await refreshProject();
      setCatalog(await call<Catalog>('catalog'));
      setValidation(null); setPreview(null);
    }, 'Salvato sul PC. Nessuna modifica è stata pubblicata.');
  }
  useEffect(() => {
    if (!project || !file || !dirty) return;
    const timer = window.setTimeout(() => { void call('save_draft', { relative: file, content }).catch((cause) => setError(`Bozza non salvata: ${cause}`)); }, 650);
    return () => window.clearTimeout(timer);
  }, [project, file, content, dirty]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveFile(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  function updateCsv(index: number, column: string, value: string) {
    if (!csv) return;
    try { csv.update(index, { [column]: value }); change(csv.serialize()); }
    catch (cause) { setError(String(cause)); }
  }
  function addCsvRow() {
    if (!csv || !file) return;
    const season = file.split('/')[3] || '2026-27';
    const competition = file.split('/')[4]?.replace('.csv', '') || 'platinum';
    const values: Record<string, string> = section === 'games' ? {
      id: `${season}-${competition}-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}`,
      date: new Date().toISOString().slice(0, 10), status: 'scheduled', home_team: catalog.teams[0] || '', away_team: '',
    } : section === 'rosters' ? { team_id: catalog.teams[0] || '', active: 'true' } : {};
    csv.append(values); setSelectedRow(csv.rows.length - 1); change(csv.serialize());
  }
  function updateYamlField(key: string, value: unknown, nested?: string) {
    try {
      if (nested) {
        const doc = parseDocument(content, { keepSourceTokens: true });
        if (doc.errors.length) throw new Error(doc.errors[0].message);
        doc.setIn([nested, key], value); change(String(doc));
      } else change(editYaml(content, { [key]: value }));
    } catch (cause) { setError(String(cause)); }
  }
  function applyContent(edit: () => string) {
    try { setError(''); change(edit()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function createTeam() {
    const id = newTeamId.trim();
    try {
      change(addTeam(content, id, newTeamName, newTeamShortName));
      setSelectedTeam(id); setNewTeamId(''); setNewTeamName(''); setNewTeamShortName(''); setError('');
      setNotice('Squadra aggiunta alla bozza. Salva sul PC prima di usarla in un campionato o in una partita.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function createSeason() {
    const id = newSeasonId.trim();
    try { change(addSeason(content, id)); setSelectedSeason(id); setSelectedCompetition(''); setNewSeasonId(''); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function createCompetition() {
    const id = newCompetitionId.trim();
    try {
      change(addCompetition(content, activeSeasonId, id, newCompetitionName, newCompetitionTeams));
      setSelectedCompetition(id); setNewCompetitionId(''); setNewCompetitionName(''); setNewCompetitionTeams([]); setError('');
      setNotice('Campionato aggiunto alla bozza. Dopo il salvataggio potrai aprire i relativi archivi Partite e Statistiche.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function updateNewsField(key: string, value: unknown, body?: string) {
    try { if (news) change(news.update({ [key]: value }, body ?? news.body)); } catch (cause) { setError(String(cause)); }
  }
  async function newPlayer() {
    if (!await preserveDraft()) return;
    const name = newTitle.trim(); const slug = safeSlug(name);
    if (!name || !slug) { setError('Inserisci nome e cognome.'); return; }
    const relative = `site/data/players/${slug}.yaml`;
    if (files.includes(relative)) { setError('Un file giocatore con questo nome esiste già.'); return; }
    setFiles((old) => [...old, relative].sort());
    setFile(relative); setSavedContent(''); setContent(`id: ${slug}\nname: ${JSON.stringify(name)}\nbio: Profilo in aggiornamento.\n`); setNewTitle(''); history.current = [];
  }
  async function newNews() {
    if (!await preserveDraft()) return;
    const title = newTitle.trim(); const slug = safeSlug(title);
    if (!title || !slug) { setError('Inserisci un titolo.'); return; }
    const relative = `site/content/news/${slug}.md`;
    if (files.includes(relative)) { setError('Una notizia con questo slug esiste già.'); return; }
    setFiles((old) => [...old, relative].sort());
    setFile(relative); setSavedContent(''); setContent(`---\ntitle: ${JSON.stringify(title)}\ndate: ${new Date().toISOString().slice(0, 10)}\ncover:\nplayers: []\ngames: []\nexcerpt:\n---\n\n`); setNewTitle(''); history.current = [];
  }
  async function importStats() {
    if (!csv || section !== 'stats') return;
    const chosen = await open({ multiple: false, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (typeof chosen !== 'string') return;
    await run(async () => {
      const incoming = new CsvDocument(await call<string>('read_external_csv', { path: chosen }));
      const required = ['game_id', 'player_id'];
      if (required.some((field) => !incoming.columns.includes(field))) throw new Error('CSV importato senza game_id/player_id.');
      const existing = new Set(csv.rows.map((_, index) => `${csv.get(index).game_id}|${csv.get(index).player_id}`));
      let added = 0; let skipped = 0;
      for (let index = 0; index < incoming.rows.length; index++) {
        const record = incoming.get(index); const key = `${record.game_id}|${record.player_id}`;
        if (existing.has(key)) { skipped++; continue; }
        csv.append(Object.fromEntries(csv.columns.map((column) => [column, record[column] ?? ''])));
        existing.add(key); added++;
      }
      if (added) change(csv.serialize());
      setNotice(`${added} statistiche aggiunte alla bozza; ${skipped} già presenti lasciate intatte. Controlla, poi salva sul PC.`);
    });
  }
  async function chooseImage() {
    const chosen = await open({ multiple: false, filters: [{ name: 'Immagini', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    if (typeof chosen !== 'string') return;
    await run(async () => { setMediaPath(chosen); setMediaPreview(await call<string>('preview_image', { path: chosen })); });
  }
  async function importImage() {
    if (!mediaPath) return;
    await run(async () => {
      const sitePath = await call<string>('import_media', { path: mediaPath });
      await refreshProject();
      setNotice(`Immagine copiata nel progetto: ${sitePath}. Inserisci questo percorso nel campo foto/copertina, poi pubblica quando pronta.`);
    });
  }
  async function backup(exportMode: boolean, overwrite = false) {
    const chosen = exportMode
      ? await saveDialog({ defaultPath: `webmaker-backup-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: 'Backup ZIP', extensions: ['zip'] }] })
      : await open({ multiple: false, filters: [{ name: 'Backup ZIP', extensions: ['zip'] }] });
    if (typeof chosen !== 'string') return;
    await run(async () => {
      const result = await call<BackupResult>(exportMode ? 'export_backup' : 'restore_backup', exportMode
        ? { path: chosen, includeMedia: true } : { path: chosen, overwrite });
      if (!exportMode) { await refreshProject(); setCatalog(await call<Catalog>('catalog')); }
      setNotice(`${exportMode ? 'Backup creato' : 'Ripristino completato'}: ${result.written} file. ${result.skipped.length ? `Saltati: ${result.skipped.slice(0, 5).join('; ')}` : ''}`);
    });
  }
  async function validate() { await run(async () => { setValidation(await call<ValidationReport>('validate_project')); }); }
  async function showPreview() {
    await run(async () => { setPreview(await call<PublicationPreview>('preview_publication', { paths: publishFiles })); });
  }
  async function doPublish() {
    if (!preview?.canPublish) return;
    await run(async () => { setPublished(await call<PublicationResult>('publish', { paths: publishFiles, message: commitMessage, confirmation })); await refreshProject(); });
  }

  const csvKind = section === 'games' || section === 'stats' || section === 'rosters' ? section : null;
  const filteredRows = csv?.rows.map((_, index) => index).filter((index) => !filter || Object.values(csv.get(index)).some((value) => value.toLowerCase().includes(filter.toLowerCase()))) ?? [];
  const selected = selectedRow === null || !csv ? null : csv.get(selectedRow);
  const teamDoc = section === 'teams' && content ? parseDocument(content) : null;
  const teamIds = teamDoc?.contents && 'items' in teamDoc.contents ? (teamDoc.contents.items as { key: { value?: unknown } }[]).map((item) => String(item.key.value ?? '')).filter(Boolean) : [];
  const competitionConfig = section === 'competitions' && content ? readCompetitionConfig(content) : null;
  const activeSeasonId = selectedSeason || competitionConfig?.current_season || competitionConfig?.seasons[0]?.id || '';
  const activeSeason = competitionConfig?.seasons.find((season) => season.id === activeSeasonId);
  const activeCompetitionId = selectedCompetition || activeSeason?.competitions[0]?.id || '';
  const activeCompetition = activeSeason?.competitions.find((competition) => competition.id === activeCompetitionId);
  const activeCompetitionTeams = activeCompetition?.teams ?? (activeCompetition?.team ? [activeCompetition.team] : []);
  const clubTeamOptions = catalog.teams;
  const clubDoc = section === 'branding' && content ? parseDocument(content) : null;
  const playerDoc = section === 'players' && content ? parseDocument(content) : null;

  return <div className="studio-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">W</span><div><small>PLAYMAKER</small><strong>WebMAKER<span> Studio</span></strong></div></div>
      <div className="sidebar-project"><span className="status-dot" />{project ? <><strong>{project.root.split(/[\\/]/).pop()}</strong><small>{project.branch} · copia locale</small></> : <><strong>Nessun progetto</strong><small>Apri la cartella del sito</small></>}</div>
      <nav aria-label="Sezioni Studio">{sections.map((item, index) => <div key={item.id}>
        {(index === 0 || item.group !== sections[index - 1].group) && <p className="nav-group">{item.group}</p>}
        <button type="button" className={section === item.id ? 'active' : ''} onClick={() => void go(item.id)} disabled={!project && item.id !== 'dashboard'}>{item.label}{item.id === 'publish' && project?.changedFiles.length ? <b>{project.changedFiles.length}</b> : null}</button>
      </div>)}</nav>
      <div className="sidebar-bottom"><span>v0.2.1 · desktop locale</span><span>Ctrl+S per salvare</span></div>
    </aside>
    <main className="workspace">
      <header className="workspace-top"><div><span className="eyebrow">WebMAKER Studio</span><h1>{sections.find((item) => item.id === section)?.label}</h1></div><div className="top-actions"><span className="local-badge">{dirty ? 'Bozza non applicata' : 'Dati locali'}</span>{file && <><button className="button subtle" onClick={undo} disabled={!history.current.length}>Annulla</button><button className="button primary" onClick={() => void saveFile()} disabled={!dirty || busy}>Salva sul PC</button></>}</div></header>
      <ErrorNotice text={error} /><Notice text={notice} />
      {section === 'dashboard' && <div className="dashboard">
        <div className="hero-panel"><span className="eyebrow">Una scrivania per il sito</span><h2>CONTENUTI<br /><em>SOTTO CONTROLLO.</em></h2><p>Partite, roster, statistiche e notizie restano file nel repository. Le bozze si salvano sul tuo PC; la pubblicazione è un passaggio separato e verificabile.</p><button className="button primary" onClick={() => void openProject()}>Apri progetto locale</button></div>
        {project ? <><div className="metric-grid"><div><small>BRANCH</small><strong>{project.branch}</strong></div><div><small>FILE MODIFICATI</small><strong>{project.changedFiles.length}</strong></div><div><small>ULTIMA SINCRONIZZAZIONE</small><strong className="metric-small">{formatTime(project.lastSync)}</strong></div></div><div className="panel"><div className="panel-heading"><h3>Stato della copia locale</h3><div className="button-row"><button className="text-action" onClick={() => void run(refreshProject)}>Aggiorna stato</button><button className="text-action" onClick={() => void run(async () => { setProject(await call<ProjectInfo>('sync_project')); }, 'Sincronizzazione completata.')}>Sincronizza da GitHub</button></div></div><p><b>Cartella:</b> {project.root}</p><p><b>Origin:</b> {project.remote}</p><div className="file-tags">{project.changedFiles.length ? project.changedFiles.map((path) => <code key={path}>{path}</code>) : <span>Nessuna modifica locale.</span>}</div></div></> : <div className="panel"><h3>Per iniziare</h3><p>Seleziona la cartella che contiene <code>.git</code> e <code>site/</code>. Studio apre ogni progetto WebMAKER con club.yaml. Configura il remoto prima di pubblicare.</p></div>}
        <div className="panel"><h3>Anteprima del sito</h3><p>Studio mostra i dati in modifica. Per vedere il sito completo esegui <code>cd site; npm run build; npm run dev</code> nel progetto.</p></div>
      </div>}

      {project && section === 'branding' && clubDoc && <div className="panel narrow"><span className="eyebrow">Identità del sito</span><h2>{String(clubDoc.get('name') ?? 'Club')}</h2><div className="form-grid">{[['name','Nome società'],['short_name','Nome breve'],['tagline','Slogan'],['description','Descrizione'],['language','Lingua'],['timezone','Timezone'],['site_url','URL del sito'],['repository_url','Repository GitHub'],['base_path','Base path'],['logo','Logo /assets/...'],['hero_image','Immagine hero /assets/...']].map(([key,label])=><label key={key}><span>{label}</span><input value={String(clubDoc.get(key) ?? '')} onChange={(event)=>updateYamlField(key,event.target.value)} /></label>)}<label><span>Tema del sito</span><select value={String(clubDoc.get('theme') ?? 'bold')} onChange={(event)=>updateYamlField('theme',event.target.value)}><option value="bold">Bold · sportivo</option><option value="classic">Classic · istituzionale</option><option value="dynamic">Dynamic · magazine</option></select></label><label><span>Sport</span><select value={String(clubDoc.get('sport') ?? 'basketball')} onChange={(event)=>updateYamlField('sport',event.target.value)}><option value="basketball">Basket</option><option value="football">Calcio</option></select></label>{[['primary','Colore primario'],['accent','Colore accento']].map(([key,label])=><label key={key}><span>{label}</span><input type="color" value={String(clubDoc.getIn(['colors',key]) ?? '#153a7a')} onChange={(event)=>updateYamlField(key,event.target.value,'colors')} /></label>)}</div><p className="hint">Il cambio tema modifica solo club.yaml. Salva sul PC, esegui la build per l’anteprima, poi pubblica.</p></div>}

      {project && (section === 'games' || section === 'stats' || section === 'players' || section === 'news') && <div className="file-strip"><label>File <select value={file} onChange={(event) => void loadFile(event.target.value)}><option value="">Seleziona un file…</option>{files.map((path) => <option key={path} value={path}>{fileTitle(path)}</option>)}</select></label>{(section === 'players' || section === 'news') && <div className="create-inline"><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder={section === 'players' ? 'Nome nuovo giocatore' : 'Titolo nuova notizia'} /><button className="button subtle" onClick={() => void (section === 'players' ? newPlayer() : newNews())}>Crea</button></div>}</div>}

      {project && csvKind && csv && <div className="editor-layout"><div className="record-list"><div className="record-list-head"><input type="search" placeholder="Cerca…" value={filter} onChange={(event) => setFilter(event.target.value)} /><button title="Aggiungi record" onClick={addCsvRow}>+</button></div><small className="count">{filteredRows.length} record · {fileTitle(file)}</small><div className="record-scroll">{filteredRows.map((index) => { const row = csv.get(index); const title = csvKind === 'games' ? `${row.home_team || 'Casa'} / ${row.away_team || 'Trasferta'}` : csvKind === 'stats' ? `${row.player_id || 'Giocatore'} / ${row.game_id || 'Partita'}` : `${row.player_id || 'Giocatore'} / ${row.team_id || 'Squadra'}`; return <button key={`${index}-${row.id || row.player_id}`} className={selectedRow === index ? 'selected' : ''} onClick={() => setSelectedRow(index)}><small>{row.date || row.season || row.game_id || 'NUOVO'}</small><strong>{title}</strong><span>{row.status || row.number || row.points || ''}</span></button>; })}</div></div><div className="panel record-editor">{selected ? <><div className="panel-heading"><div><span className="eyebrow">{csvKind === 'games' ? 'Scheda partita' : csvKind === 'stats' ? 'Dato inserito' : 'Iscrizione roster'}</span><h2>{csvKind === 'games' ? 'Dettagli partita' : csvKind === 'stats' ? 'Statistiche giocatore' : 'Giocatore in squadra'}</h2></div></div><div className="form-grid">{[...preferredFields[csvKind], ...csv.columns.filter((column) => !preferredFields[csvKind].includes(column))].filter((column) => csv.columns.includes(column)).map((column) => <label key={column} className={['notes', 'instagram_url', 'youtube_url', 'address'].includes(column) ? 'wide' : ''}><span>{fieldLabels[column] || column}</span>{(column === 'home_team' || column === 'away_team' || column === 'team_id') ? <select value={selected[column]} onChange={(event) => updateCsv(selectedRow!, column, event.target.value)}><option value="">Seleziona…</option>{catalog.teams.map((id) => <option key={id}>{id}</option>)}</select> : column === 'player_id' ? <select value={selected[column]} onChange={(event) => updateCsv(selectedRow!, column, event.target.value)}><option value="">Seleziona…</option>{catalog.players.map((id) => <option key={id}>{id}</option>)}</select> : column === 'game_id' ? <select value={selected[column]} onChange={(event) => updateCsv(selectedRow!, column, event.target.value)}><option value="">Seleziona…</option>{catalog.games.map((id) => <option key={id}>{id}</option>)}</select> : column === 'status' ? <select value={selected[column]} onChange={(event) => updateCsv(selectedRow!, column, event.target.value)}>{['scheduled', 'played', 'final'].map((item) => <option key={item}>{item}</option>)}</select> : column === 'active' ? <select value={selected[column]} onChange={(event) => updateCsv(selectedRow!, column, event.target.value)}><option value="true">Sì</option><option value="false">No</option></select> : <input value={selected[column] ?? ''} type={column === 'date' ? 'date' : column === 'time' ? 'time' : 'text'} readOnly={column === 'id' && savedContent.includes(selected.id)} onChange={(event) => updateCsv(selectedRow!, column, event.target.value)} />}</label>)}</div>{csvKind === 'stats' && <p className="hint">Questi sono i valori inseriti nel CSV. Le medie e i totali vengono calcolati dal sito durante la build.</p>}</> : <div className="empty-selection"><strong>Seleziona un record</strong><p>Apri una riga dall’elenco o creane una nuova. Le modifiche restano in bozza fino a “Salva sul PC”.</p></div>}{csvKind === 'stats' && <button className="button subtle" onClick={() => void importStats()}>Importa CSV · aggiungi solo record nuovi</button>}</div></div>}

      {project && section === 'teams' && file && <div className="entity-stack narrow">
        <div className="panel"><div className="panel-heading"><h2>Squadre</h2><span>{teamIds.length} squadre</span></div>
          <div className="team-tabs">{teamIds.map((id) => <button key={id} className={selectedTeam === id ? 'active' : ''} onClick={() => setSelectedTeam(id)}>{id}</button>)}</div>
          {selectedTeam ? <><p className="hint">ID stabile: <code>{selectedTeam}</code>. Non cambia, perché è usato in partite e roster.</p><div className="form-grid">{['name', 'short_name', 'logo', 'logo_on_dark'].map((key) => <label key={key}><span>{key === 'name' ? 'Nome completo' : key === 'short_name' ? 'Nome breve' : key === 'logo' ? 'Logo su chiaro' : 'Logo su scuro'}</span><input value={String(teamDoc?.getIn([selectedTeam, key]) ?? '')} onChange={(event) => updateYamlField(key, event.target.value, selectedTeam)} /></label>)}</div></> : <p>Seleziona una squadra per modificarla, oppure aggiungine una qui sotto.</p>}
        </div>
        <div className="panel"><span className="eyebrow">Nuova squadra</span><h2>Aggiungi squadra</h2><div className="form-grid">
          <label><span>ID stabile (es. samurai-aprilia)</span><input value={newTeamId} onChange={(event) => setNewTeamId(event.target.value)} placeholder="nuova-squadra" /></label>
          <label><span>Nome completo</span><input value={newTeamName} onChange={(event) => setNewTeamName(event.target.value)} placeholder="Nome ufficiale" /></label>
          <label><span>Nome breve</span><input value={newTeamShortName} onChange={(event) => setNewTeamShortName(event.target.value)} placeholder="Nome nel tabellone" /></label>
        </div><p className="hint">Dopo averla aggiunta alla bozza, selezionala sopra per impostare i loghi. Le immagini si importano da “Immagini”.</p><button className="button primary" onClick={createTeam}>Aggiungi alla bozza</button></div>
      </div>}

      {project && section === 'competitions' && file && competitionConfig && <div className="entity-stack narrow">
        <div className="panel"><span className="eyebrow">Stagioni</span><h2>Stagione da gestire</h2><div className="form-grid">
          <label><span>Stagione</span><select value={activeSeasonId} onChange={(event) => { setSelectedSeason(event.target.value); setSelectedCompetition(''); }}>
            {competitionConfig.seasons.map((season) => <option key={season.id} value={season.id}>{season.id}</option>)}
          </select></label>
          <label><span>Stagione corrente del sito</span><select value={competitionConfig.current_season} onChange={(event) => applyContent(() => setCurrentSeason(content, event.target.value))}>
            {competitionConfig.seasons.map((season) => <option key={season.id} value={season.id}>{season.id}</option>)}
          </select></label>
        </div><p className="hint">Selezionare una stagione qui serve solo a gestirla; cambiare “Stagione corrente” modifica la stagione mostrata per prima sul sito.</p>
          <div className="entity-create"><label><span>Nuova stagione (AAAA-AA)</span><input value={newSeasonId} onChange={(event) => setNewSeasonId(event.target.value)} placeholder="2027-28" /></label><button className="button subtle" onClick={createSeason}>Aggiungi stagione</button></div>
        </div>
        {activeSeason && <div className="panel"><div className="panel-heading"><div><span className="eyebrow">{activeSeason.id}</span><h2>Campionati</h2></div><span>{activeSeason.competitions.length} campionati</span></div>
          <div className="team-tabs">{activeSeason.competitions.map((competition) => <button key={competition.id} className={activeCompetitionId === competition.id ? 'active' : ''} onClick={() => setSelectedCompetition(competition.id)}>{competition.name || competition.id}</button>)}</div>
          {activeCompetition ? <><p className="hint">ID stabile: <code>{activeCompetition.id}</code>. Mantenerlo evita di scollegare partite, classifiche e statistiche storiche.</p><div className="form-grid">
            <label className="wide"><span>Nome del campionato</span><input value={activeCompetition.name ?? ''} onChange={(event) => applyContent(() => editCompetition(content, activeSeasonId, activeCompetitionId, { name: event.target.value }))} /></label>
            <label><span>Punti per vittoria (vuoto = solo vittorie)</span><input type="number" min="0" step="1" value={activeCompetition.standings_points?.win ?? ''} onChange={(event) => applyContent(() => editCompetition(content, activeSeasonId, activeCompetitionId, { win: event.target.value === '' ? null : Number(event.target.value) }))} /></label>
            <label><span>Punti per sconfitta</span><input type="number" min="0" step="1" value={activeCompetition.standings_points?.loss ?? ''} onChange={(event) => applyContent(() => editCompetition(content, activeSeasonId, activeCompetitionId, { loss: event.target.value === '' ? null : Number(event.target.value) }))} /></label>
          </div><div className="entity-checks"><strong>Squadre partecipanti</strong><div className="checkbox-grid">{clubTeamOptions.map((id) => <label key={id}><input type="checkbox" checked={activeCompetitionTeams.includes(id)} onChange={(event) => applyContent(() => editCompetition(content, activeSeasonId, activeCompetitionId, { teams: event.target.checked ? [...activeCompetitionTeams, id] : activeCompetitionTeams.filter((team) => team !== id) }))} />{id}</label>)}</div></div></> : <p>Nessun campionato in questa stagione. Aggiungine uno sotto.</p>}
        </div>}
        {activeSeason && <div className="panel"><span className="eyebrow">Nuovo campionato · {activeSeasonId}</span><h2>Aggiungi campionato</h2><div className="form-grid">
          <label><span>ID stabile (es. gold)</span><input value={newCompetitionId} onChange={(event) => setNewCompetitionId(event.target.value)} placeholder="gold" /></label>
          <label><span>Nome completo</span><input value={newCompetitionName} onChange={(event) => setNewCompetitionName(event.target.value)} placeholder="Amatori UISP Gold" /></label>
        </div><div className="entity-checks"><strong>Squadre partecipanti</strong><div className="checkbox-grid">{catalog.teams.map((id) => <label key={id}><input type="checkbox" checked={newCompetitionTeams.includes(id)} onChange={(event) => setNewCompetitionTeams(event.target.checked ? [...newCompetitionTeams, id] : newCompetitionTeams.filter((team) => team !== id))} />{id}</label>)}</div></div>
          <p className="hint">Gli archivi delle partite e delle statistiche saranno disponibili dopo aver salvato la configurazione. Gli ID non potranno essere cambiati dall’interfaccia.</p><button className="button primary" onClick={createCompetition}>Aggiungi alla bozza</button>
        </div>}
      </div>}

      {project && section === 'players' && file && playerDoc && <div className="panel narrow"><span className="eyebrow">Profilo giocatore</span><h2>{String(playerDoc.get('name') ?? 'Nuovo giocatore')}</h2><div className="form-grid">{['id', 'name', 'birth_date', 'instagram', 'photo'].map((key) => <label key={key}><span>{key === 'birth_date' ? 'Data di nascita' : key === 'photo' ? 'Foto (/assets/...)' : key}</span><input value={String(playerDoc.get(key) ?? '')} readOnly={key === 'id'} onChange={(event) => updateYamlField(key, event.target.value)} /></label>)}<label className="wide"><span>Bio</span><textarea rows={8} value={String(playerDoc.get('bio') ?? '')} onChange={(event) => updateYamlField('bio', event.target.value)} /></label><label className="wide"><span>Contenuti social (un URL per riga)</span><textarea rows={4} value={playerSocialUrls(playerDoc).join('\n')} onChange={(event) => updateYamlField('social_urls', event.target.value.split('\n').map((value) => value.trim()).filter(Boolean))} /></label></div><p className="hint">Percorsi foto: importa prima l’immagine nella sezione Immagini. La carriera può restare discorsiva nella bio.</p></div>}

      {project && section === 'news' && file && news && <div className="news-layout"><div className="panel"><span className="eyebrow">Notizia · {fileTitle(file)}</span><div className="form-grid">{['title', 'date', 'cover', 'excerpt'].map((key) => <label key={key} className={key === 'excerpt' ? 'wide' : ''}><span>{key === 'title' ? 'Titolo' : key === 'date' ? 'Data' : key === 'cover' ? 'Copertina (/assets/...)' : 'Introduzione'}</span><input type={key === 'date' ? 'date' : 'text'} value={String(news.metadata[key] ?? '')} onChange={(event) => updateNewsField(key, event.target.value)} /></label>)}{['players', 'games'].map((key) => <label key={key}><span>{key === 'players' ? 'Giocatori collegati (ID, separati da virgola)' : 'Partite collegate (ID, separate da virgola)'}</span><input value={Array.isArray(news.metadata[key]) ? (news.metadata[key] as string[]).join(', ') : ''} onChange={(event) => updateNewsField(key, event.target.value.split(',').map((id) => id.trim()).filter(Boolean))} /></label>)}<label className="wide"><span>Testo Markdown</span><textarea className="markdown-editor" rows={20} value={news.body} onChange={(event) => { try { change(news.update({}, event.target.value)); } catch (cause) { setError(String(cause)); } }} /></label></div></div><div className="panel preview-panel"><span className="eyebrow">Anteprima Markdown</span><h2>{String(news.metadata.title ?? '')}</h2><iframe sandbox="" title="Anteprima della notizia" srcDoc={`<!doctype html><html><head><meta charset="UTF-8"><style>body{font:16px/1.65 Arial;padding:24px;color:#222}img{max-width:100%}a{color:#8a2632}h1,h2{line-height:1.1}</style></head><body>${String(marked.parse(news.body, { async: false }))}</body></html>`} /></div></div>}

      {project && section === 'media' && <div className="panel narrow"><span className="eyebrow">Asset del sito</span><h2>Importa un’immagine</h2><p>PNG, JPEG, WebP o GIF fino a 8 MB. Studio copia il file con un nome sicuro dentro <code>site/public/assets/</code>.</p><button className="button subtle" onClick={() => void chooseImage()}>Scegli immagine</button>{mediaPath && <div className="media-preview"><p>{mediaPath}</p>{mediaPreview && <img src={mediaPreview} alt="Anteprima immagine selezionata" />}<button className="button primary" onClick={() => void importImage()}>Copia nel progetto</button></div>}<p className="hint">Non importare video pesanti: usa un link YouTube nel campo della partita.</p></div>}

      {project && section === 'backup' && <div className="panel narrow"><span className="eyebrow">Ripristino controllato</span><h2>Backup dei contenuti</h2><p>Il backup ZIP v1 include dati, notizie e immagini. Il ripristino standard aggiunge soltanto file mancanti e segnala quelli già presenti.</p><div className="button-row"><button className="button primary" onClick={() => void backup(true)}>Esporta ZIP</button><button className="button subtle" onClick={() => void backup(false)}>Ripristina senza sovrascrivere</button></div><details><summary>Ripristino con sovrascrittura</summary><p>Ogni file esistente viene prima copiato nei backup locali di Studio. Usa questa opzione solo dopo aver controllato lo ZIP.</p><button className="button danger" onClick={() => void backup(false, true)}>Scegli ZIP e sovrascrivi</button></details></div>}

      {project && section === 'publish' && <div className="publish-layout"><div className="panel"><span className="eyebrow">1 / Controlli</span><h2>Prima della pubblicazione</h2><button className="button subtle" onClick={() => void validate()}>Valida tutti i contenuti</button>{validation && <div className={validation.errors.length ? 'validation bad' : 'validation good'}><strong>{validation.errors.length ? `${validation.errors.length} problemi da correggere` : 'Dati validi'}</strong><p>{validation.games} partite · {validation.players} giocatori · {validation.news} notizie</p>{validation.errors.map((item, index) => <p key={index}>{item}</p>)}</div>}<p className="hint">I dati inseriti vengono confrontati con squadre, giocatori e partite esistenti. Il sito completo va verificato con la build prima del rilascio.</p></div><div className="panel"><span className="eyebrow">2 / Revisione</span><h2>File da includere</h2><p>Seleziona solo i contenuti intenzionali. Il codice dello Studio e del sito non viene aggiunto automaticamente.</p><div className="publish-files">{project.changedFiles.filter((path) => path.startsWith('site/data/') || path.startsWith('site/content/news/') || path.startsWith('site/public/assets/')).map((path) => <label key={path}><input type="checkbox" checked={publishFiles.includes(path)} onChange={(event) => setPublishFiles(event.target.checked ? [...publishFiles, path] : publishFiles.filter((item) => item !== path))} /><code>{path}</code></label>)}{!project.changedFiles.length && <p>Nessun file locale modificato.</p>}</div><button className="button subtle" onClick={() => void showPreview()} disabled={!publishFiles.length}>Anteprima commit / push (dry run)</button>{preview && <><div className={preview.canPublish ? 'validation good' : 'validation bad'}><strong>{preview.canPublish ? 'Pubblicazione tecnicamente pronta' : 'Push bloccato in questa copia'}</strong>{preview.errors.map((item, index) => <p key={index}>{item}</p>)}<p>{preview.files.length} file selezionati · branch {preview.branch} · origin/main: {preview.ahead ?? '?'} avanti, {preview.behind ?? '?'} indietro</p></div><pre className="diff">{preview.diff || 'Nessun diff tracciato; i nuovi media saranno aggiunti solo alla conferma.'}</pre></>}</div><div className="panel publish-confirm"><span className="eyebrow">3 / Conferma esplicita</span><h2>Pubblica su GitHub</h2><p>Studio esegue fetch, blocca le divergenze, crea un commit dei soli file selezionati e invia a <code>main</code>. Il deploy GitHub Pages parte dopo il push.</p><label><span>Messaggio commit</span><input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} /></label><label><span>Per confermare digita PUBBLICA SU MAIN</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label><button className="button primary" disabled={!preview?.canPublish || confirmation !== 'PUBBLICA SU MAIN' || busy} onClick={() => void doPublish()}>Pubblica su GitHub</button>{published && <div className="validation good"><strong>Push riuscito · {published.commit.slice(0, 8)}</strong><p>{published.deployStatus}</p><a href={published.commitUrl} target="_blank" rel="noreferrer">Commit ↗</a><a href={published.actionsUrl} target="_blank" rel="noreferrer">Workflow Actions ↗</a><a href={published.siteUrl} target="_blank" rel="noreferrer">Sito ↗</a></div>}</div></div>}
      {project && ['games', 'stats', 'players', 'news'].includes(section) && !file && <div className="panel empty-file"><h2>Seleziona un file</h2><p>Scegli una stagione o un profilo dall’elenco qui sopra. I dati storici restano disponibili senza modifiche automatiche.</p></div>}
      {busy && <div className="busy" role="status">Operazione in corso…</div>}
    </main>
  </div>;
}


