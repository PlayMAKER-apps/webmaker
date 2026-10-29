import { useEffect, useMemo, useRef, useState } from 'react';
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { marked } from 'marked';
import { parseDocument } from 'yaml';
import { call, type BackupResult, type Catalog, type CreateClubRequest, type CreateClubResult, type Draft, type GithubAccount, type ProjectInfo, type PublicationPreview, type PublicationResult, type ValidationReport } from './lib/api';
import { CsvDocument } from './lib/csv';
import { addCompetition, addSeason, addTeam, editCompetition, editYaml, parseNews, playerSocialUrls, readCompetitionConfig, safeSlug, setCurrentSeason } from './lib/content';

type Section = 'dashboard' | 'branding' | 'games' | 'teams' | 'competitions' | 'players' | 'rosters' | 'stats' | 'news' | 'media' | 'backup' | 'publish';
type SetupMode = 'create' | 'clone' | null;
const sections: { id: Section; label: string; group: string }[] = [
  { id: 'dashboard', label: 'Overview', group: 'Studio' },
  { id: 'branding', label: 'Club & theme', group: 'Studio' },
  { id: 'games', label: 'Games', group: 'Content' },
  { id: 'teams', label: 'Teams', group: 'Content' },
  { id: 'competitions', label: 'Competitions', group: 'Content' },
  { id: 'players', label: 'Players', group: 'Content' },
  { id: 'rosters', label: 'Roster', group: 'Content' },
  { id: 'stats', label: 'Statistics', group: 'Content' },
  { id: 'news', label: 'News', group: 'Content' },
  { id: 'media', label: 'Images', group: 'Tools' },
  { id: 'backup', label: 'Backup', group: 'Tools' },
  { id: 'publish', label: 'Publish', group: 'Tools' },
];
const fieldLabels: Record<string, string> = {
  id: 'Stable ID', date: 'Date', time: 'Time', status: 'Status', home_team: 'Home team', away_team: 'Away team',
  home_score: 'Home score', away_score: 'Away score', venue: 'Venue', address: 'Address', instagram_url: 'Instagram post', youtube_url: 'YouTube video',
  notes: 'Notes', phase: 'Phase', round: 'Round', game_id: 'Game', player_id: 'Player', minutes: 'Minutes (MM:SS)', points: 'Points',
  three_pointers_made: 'Three-pointers', two_pointers_made: 'Two-pointers', free_throws_made: 'Free throws', fouls: 'Fouls',
  rebounds_off: 'Offensive rebounds', rebounds_def: 'Defensive rebounds', assists: 'Assists', turnovers: 'Turnovers', season: 'Season',
  competition: 'Competition', team_id: 'Team', number: 'Number', role: 'Role', active: 'Active',
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
  return value ? new Date(Number(value) * 1000).toLocaleString('en-US') : 'never in this copy';
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
  const [commitMessage, setCommitMessage] = useState('Update WebMAKER content');
  const [published, setPublished] = useState<PublicationResult | null>(null);
  const [mediaPath, setMediaPath] = useState('');
  const [mediaPreview, setMediaPreview] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [setupMode, setSetupMode] = useState<SetupMode>(null);
  const [setupParent, setSetupParent] = useState('');
  const [clubName, setClubName] = useState('');
  const [clubShortName, setClubShortName] = useState('');
  const [clubFolder, setClubFolder] = useState('');
  const [clubSport, setClubSport] = useState<'basketball' | 'football'>('basketball');
  const [clubTheme, setClubTheme] = useState<'bold' | 'classic' | 'dynamic'>('bold');
  const [clubSeason, setClubSeason] = useState(() => { const year = new Date().getFullYear(); return `${year}-${String(year + 1).slice(-2)}`; });
  const [publishNewClub, setPublishNewClub] = useState(false);
  const [githubAccount, setGithubAccount] = useState<GithubAccount | null>(null);
  const [githubOwner, setGithubOwner] = useState('');
  const [githubRepository, setGithubRepository] = useState('');
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneFolder, setCloneFolder] = useState('');
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
      setError(`Could not save the draft: ${cause}`);
      return false;
    }
  }
  async function openProject() {
    if (!await preserveDraft()) return;
    const chosen = await open({ directory: true, multiple: false, title: 'Select the WebMAKER site folder' });
    if (typeof chosen !== 'string') return;
    await run(async () => {
      const loaded = await call<ProjectInfo>('open_project', { path: chosen });
      setProject(loaded);
      setCatalog(await call<Catalog>('catalog'));
      setSection('dashboard'); setFile('');
      setPublishFiles(loaded.changedFiles.filter((path) => path.startsWith('site/data/') || path.startsWith('site/content/news/') || path.startsWith('site/public/assets/')));
    }, 'Local project opened. Changes are saved on your computer first.');
  }
  async function chooseSetupParent() {
    const chosen = await open({ directory: true, multiple: false, title: 'Choose where to save the club project' });
    if (typeof chosen === 'string') setSetupParent(chosen);
  }
  function applyClubName(value: string) {
    setClubName(value);
    if (!clubShortName || clubShortName === clubName) setClubShortName(value);
    const slug = safeSlug(value);
    if (!clubFolder || clubFolder === safeSlug(clubName)) setClubFolder(slug);
    if (!githubRepository || githubRepository === safeSlug(clubName)) setGithubRepository(slug);
  }
  async function connectGithub() {
    await run(async () => {
      const account = await call<GithubAccount>('connect_github');
      setGithubAccount(account); setGithubOwner(account.login);
      setNotice(`Connected to GitHub as ${account.login}. The credential remains in Git Credential Manager.`);
    });
  }
  async function createClub() {
    const request: CreateClubRequest = {
      parent: setupParent, folderName: clubFolder, clubName, shortName: clubShortName, sport: clubSport, theme: clubTheme, season: clubSeason,
      github: publishNewClub && githubAccount ? { account: githubAccount.login, owner: githubOwner, repository: githubRepository } : null,
    };
    await run(async () => {
      const result = await call<CreateClubResult>('create_club', { request });
      setProject(result.project); setCatalog(await call<Catalog>('catalog')); setSetupMode(null); setSection('dashboard');
      setPublishFiles([]);
      const publication = result.repositoryUrl ? result.pagesConfigured ? ` Repository created and Pages configured: ${result.siteUrl}` : ' The repository was created; check the warning below before publishing.' : '';
      setNotice(`Club project created at ${result.project.root}.${publication}${result.warnings.length ? `\n${result.warnings.join('\n')}` : ''}`);
    });
  }
  async function cloneClub() {
    await run(async () => {
      const loaded = await call<ProjectInfo>('clone_club', { request: { parent: setupParent, remoteUrl: cloneUrl, folderName: cloneFolder } });
      setProject(loaded); setCatalog(await call<Catalog>('catalog')); setSetupMode(null); setSection('dashboard');
      setPublishFiles(loaded.changedFiles.filter((path) => path.startsWith('site/data/') || path.startsWith('site/content/news/') || path.startsWith('site/public/assets/')));
      setNotice(`Club cloned and opened at ${loaded.root}.`);
    });
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
      if (recovered) setNotice(`Local draft recovered (${formatTime(String(draft.savedAt))}). Use “Save locally” to apply it.`);
      else if (!disk && starter) setNotice('New archive: add records and save locally to create the CSV.');
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
    }, 'Saved locally. No changes have been published.');
  }
  useEffect(() => {
    if (!project || !file || !dirty) return;
    const timer = window.setTimeout(() => { void call('save_draft', { relative: file, content }).catch((cause) => setError(`Draft not saved: ${cause}`)); }, 650);
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
      setNotice('Team added to the draft. Save locally before using it in a competition or game.');
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
      setNotice('Competition added to the draft. Save it to open its Games and Statistics archives.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function updateNewsField(key: string, value: unknown, body?: string) {
    try { if (news) change(news.update({ [key]: value }, body ?? news.body)); } catch (cause) { setError(String(cause)); }
  }
  async function newPlayer() {
    if (!await preserveDraft()) return;
    const name = newTitle.trim(); const slug = safeSlug(name);
    if (!name || !slug) { setError('Enter a full name.'); return; }
    const relative = `site/data/players/${slug}.yaml`;
    if (files.includes(relative)) { setError('A player file with this name already exists.'); return; }
    setFiles((old) => [...old, relative].sort());
    setFile(relative); setSavedContent(''); setContent(`id: ${slug}\nname: ${JSON.stringify(name)}\nbio: Profile coming soon.\n`); setNewTitle(''); history.current = [];
  }
  async function newNews() {
    if (!await preserveDraft()) return;
    const title = newTitle.trim(); const slug = safeSlug(title);
    if (!title || !slug) { setError('Enter a title.'); return; }
    const relative = `site/content/news/${slug}.md`;
    if (files.includes(relative)) { setError('A news item with this slug already exists.'); return; }
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
      if (required.some((field) => !incoming.columns.includes(field))) throw new Error('Imported CSV is missing game_id/player_id.');
      const existing = new Set(csv.rows.map((_, index) => `${csv.get(index).game_id}|${csv.get(index).player_id}`));
      let added = 0; let skipped = 0;
      for (let index = 0; index < incoming.rows.length; index++) {
        const record = incoming.get(index); const key = `${record.game_id}|${record.player_id}`;
        if (existing.has(key)) { skipped++; continue; }
        csv.append(Object.fromEntries(csv.columns.map((column) => [column, record[column] ?? ''])));
        existing.add(key); added++;
      }
      if (added) change(csv.serialize());
      setNotice(`${added} statistics added to the draft; ${skipped} existing records left unchanged. Review them, then save locally.`);
    });
  }
  async function chooseImage() {
    const chosen = await open({ multiple: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    if (typeof chosen !== 'string') return;
    await run(async () => { setMediaPath(chosen); setMediaPreview(await call<string>('preview_image', { path: chosen })); });
  }
  async function importImage() {
    if (!mediaPath) return;
    await run(async () => {
      const sitePath = await call<string>('import_media', { path: mediaPath });
      await refreshProject();
      setNotice(`Image copied into the project: ${sitePath}. Use this path in the photo/cover field, then publish when ready.`);
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
      setNotice(`${exportMode ? 'Backup created' : 'Restore completed'}: ${result.written} files. ${result.skipped.length ? `Skipped: ${result.skipped.slice(0, 5).join('; ')}` : ''}`);
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
      <div className="sidebar-project"><span className="status-dot" />{project ? <><strong>{project.root.split(/[\\/]/).pop()}</strong><small>{project.branch} · local copy</small></> : <><strong>No project</strong><small>Open the site folder</small></>}</div>
      <nav aria-label="Studio sections">{sections.map((item, index) => <div key={item.id}>
        {(index === 0 || item.group !== sections[index - 1].group) && <p className="nav-group">{item.group}</p>}
        <button type="button" className={section === item.id ? 'active' : ''} onClick={() => void go(item.id)} disabled={!project && item.id !== 'dashboard'}>{item.label}{item.id === 'publish' && project?.changedFiles.length ? <b>{project.changedFiles.length}</b> : null}</button>
      </div>)}</nav>
      <div className="sidebar-bottom"><span>v0.2.0 · local desktop app</span><span>Ctrl+S to save</span></div>
    </aside>
    <main className="workspace">
      <header className="workspace-top"><div><span className="eyebrow">WebMAKER Studio</span><h1>{sections.find((item) => item.id === section)?.label}</h1></div><div className="top-actions"><span className="local-badge">{dirty ? 'Unapplied draft' : 'Local data'}</span>{file && <><button className="button subtle" onClick={undo} disabled={!history.current.length}>Undo</button><button className="button primary" onClick={() => void saveFile()} disabled={!dirty || busy}>Save locally</button></>}</div></header>
      <ErrorNotice text={error} /><Notice text={notice} />
      {section === 'dashboard' && <div className="dashboard">
        <div className="hero-panel"><span className="eyebrow">Your club workspace</span><h2>CONTENT<br /><em>UNDER CONTROL.</em></h2><p>Games, rosters, statistics, and news stay as files in the repository. Create a first club here, clone one from GitHub, or open an existing local project.</p><div className="button-row"><button className="button primary" onClick={() => setSetupMode('create')}>Create a new club</button><button className="button subtle" onClick={() => setSetupMode('clone')}>Clone from GitHub</button><button className="button subtle" onClick={() => void openProject()}>Open existing project</button></div></div>
        {!project && setupMode === 'create' && <div className="panel setup-panel">
          <div className="panel-heading"><div><span className="eyebrow">Guided setup</span><h2>Create a new club</h2></div><button className="text-action" onClick={() => setSetupMode(null)}>Cancel</button></div>
          <p>Studio creates an independent WebMAKER project with no sample-club identity, initializes a clean <code>main</code> branch, and can publish the first version to a new public GitHub repository.</p>
          <div className="form-grid">
            <label><span>Club name</span><input value={clubName} onChange={(event) => applyClubName(event.target.value)} placeholder="North Stars Sports Club" /></label>
            <label><span>Short name</span><input value={clubShortName} onChange={(event) => setClubShortName(event.target.value)} placeholder="North Stars" /></label>
            <label><span>Sport</span><select value={clubSport} onChange={(event) => setClubSport(event.target.value as 'basketball' | 'football')}><option value="basketball">Basketball</option><option value="football">Football</option></select></label>
            <label><span>Theme</span><select value={clubTheme} onChange={(event) => setClubTheme(event.target.value as 'bold' | 'classic' | 'dynamic')}><option value="bold">Bold · sporty</option><option value="classic">Classic · institutional</option><option value="dynamic">Dynamic · magazine</option></select></label>
            <label><span>First season</span><input value={clubSeason} onChange={(event) => setClubSeason(event.target.value)} placeholder="2026-27" /></label>
            <label><span>Folder name</span><input value={clubFolder} onChange={(event) => setClubFolder(safeSlug(event.target.value))} placeholder="north-stars" /></label>
            <label className="wide"><span>Save inside</span><div className="path-picker"><input value={setupParent} readOnly placeholder="Choose a parent folder" /><button className="button subtle" onClick={() => void chooseSetupParent()}>Choose folder</button></div></label>
          </div>
          <label className="setup-choice"><input type="checkbox" checked={publishNewClub} onChange={(event) => setPublishNewClub(event.target.checked)} /><span><strong>Create and publish a GitHub repository</strong><small>The repository will be public so it can use GitHub Pages. Studio never writes your credential into the project.</small></span></label>
          {publishNewClub && <div className="github-setup">
            {githubAccount ? <div className="validation good"><strong>Connected as {githubAccount.login}</strong><p>Authentication is managed by Git Credential Manager.</p></div> : <div><p>Sign in through the GitHub browser window. Git for Windows and Git Credential Manager are required by this Studio release.</p><button className="button subtle" onClick={() => void connectGithub()}>Connect GitHub</button></div>}
            <div className="form-grid"><label><span>Repository owner</span><input value={githubOwner} onChange={(event) => setGithubOwner(event.target.value)} placeholder="GitHub user or organization" /></label><label><span>Repository name</span><input value={githubRepository} onChange={(event) => setGithubRepository(event.target.value)} placeholder="north-stars" /></label></div>
          </div>}
          <div className="setup-submit"><p className="hint">Nothing is overwritten. If the destination already exists, Studio stops and asks you to open it instead.</p><button className="button primary" disabled={busy || !setupParent || !clubName.trim() || !clubShortName.trim() || !clubFolder || (publishNewClub && (!githubAccount || !githubOwner || !githubRepository))} onClick={() => void createClub()}>Create club</button></div>
        </div>}
        {!project && setupMode === 'clone' && <div className="panel setup-panel">
          <div className="panel-heading"><div><span className="eyebrow">Existing repository</span><h2>Clone a WebMAKER club</h2></div><button className="text-action" onClick={() => setSetupMode(null)}>Cancel</button></div>
          <p>Use this when the club already has a WebMAKER repository on GitHub. Private repositories use the account stored in Git Credential Manager.</p>
          <div className="form-grid"><label className="wide"><span>GitHub repository URL</span><input value={cloneUrl} onChange={(event) => { setCloneUrl(event.target.value); const name = event.target.value.split('/').pop()?.replace(/\.git$/i, '') ?? ''; if (!cloneFolder) setCloneFolder(safeSlug(name)); }} placeholder="https://github.com/owner/club-site" /></label><label><span>Local folder name</span><input value={cloneFolder} onChange={(event) => setCloneFolder(safeSlug(event.target.value))} placeholder="club-site" /></label><label><span>Save inside</span><div className="path-picker"><input value={setupParent} readOnly placeholder="Choose a parent folder" /><button className="button subtle" onClick={() => void chooseSetupParent()}>Choose folder</button></div></label></div>
          <button className="button primary" disabled={busy || !setupParent || !cloneUrl || !cloneFolder} onClick={() => void cloneClub()}>Clone and open</button>
        </div>}
        {project ? <><div className="metric-grid"><div><small>BRANCH</small><strong>{project.branch}</strong></div><div><small>CHANGED FILES</small><strong>{project.changedFiles.length}</strong></div><div><small>LAST SYNC</small><strong className="metric-small">{formatTime(project.lastSync)}</strong></div></div><div className="panel"><div className="panel-heading"><h3>Local copy status</h3><div className="button-row"><button className="text-action" onClick={() => void run(refreshProject)}>Refresh status</button><button className="text-action" onClick={() => void run(async () => { setProject(await call<ProjectInfo>('sync_project')); }, 'Synchronization complete.')}>Sync from GitHub</button></div></div><p><b>Folder:</b> {project.root}</p><p><b>Origin:</b> {project.remote || 'Local only — connect a GitHub repository when you are ready.'}</p><div className="file-tags">{project.changedFiles.length ? project.changedFiles.map((path) => <code key={path}>{path}</code>) : <span>No local changes.</span>}</div></div></> : !setupMode && <div className="panel"><h3>Choose how to start</h3><p><strong>Create a new club</strong> is the guided route for a first website. <strong>Clone from GitHub</strong> downloads an existing club. <strong>Open existing project</strong> keeps working for repositories already on this computer.</p></div>}
        <div className="panel"><h3>Site preview</h3><p>Studio shows the data you are editing. To see the complete site, run <code>cd site; npm run build; npm run dev</code> in the project.</p></div>
        <div className="panel"><h3>Attribution appreciated</h3><p>If you publish a site or post made with WebMAKER, a credit in the footer or description is appreciated but optional: <a href="https://github.com/PlayMAKER-apps/webmaker" target="_blank" rel="noreferrer">WebMAKER</a> by <a href="https://github.com/PlayMAKER-apps" target="_blank" rel="noreferrer">PlayMAKER</a>.</p></div>
      </div>}

      {project && section === 'branding' && clubDoc && <div className="panel narrow"><span className="eyebrow">Site identity</span><h2>{String(clubDoc.get('name') ?? 'Club')}</h2><div className="form-grid">{[['name','Club name'],['short_name','Short name'],['tagline','Tagline'],['description','Description'],['language','Language'],['timezone','Time zone'],['site_url','Site URL'],['repository_url','Repository GitHub'],['base_path','Base path'],['logo','Logo /assets/...'],['hero_image','Hero image /assets/...']].map(([key,label])=><label key={key}><span>{label}</span><input value={String(clubDoc.get(key) ?? '')} onChange={(event)=>updateYamlField(key,event.target.value)} /></label>)}<label><span>Site theme</span><select value={String(clubDoc.get('theme') ?? 'bold')} onChange={(event)=>updateYamlField('theme',event.target.value)}><option value="bold">Bold · sporty</option><option value="classic">Classic · institutional</option><option value="dynamic">Dynamic · magazine</option></select></label><label><span>Sport</span><select value={String(clubDoc.get('sport') ?? 'basketball')} onChange={(event)=>updateYamlField('sport',event.target.value)}><option value="basketball">Basketball</option><option value="football">Football</option></select></label>{[['primary','Primary color'],['accent','Accent color']].map(([key,label])=><label key={key}><span>{label}</span><input type="color" value={String(clubDoc.getIn(['colors',key]) ?? '#153a7a')} onChange={(event)=>updateYamlField(key,event.target.value,'colors')} /></label>)}</div><p className="hint">Changing the theme only edits club.yaml. Save locally, build the site to preview it, then publish.</p></div>}

      {project && (section === 'games' || section === 'stats' || section === 'players' || section === 'news') && <div className="file-strip"><label>File <select value={file} onChange={(event) => void loadFile(event.target.value)}><option value="">Select a file…</option>{files.map((path) => <option key={path} value={path}>{fileTitle(path)}</option>)}</select></label>{(section === 'players' || section === 'news') && <div className="create-inline"><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder={section === 'players' ? 'New player name' : 'New article title'} /><button className="button subtle" onClick={() => void (section === 'players' ? newPlayer() : newNews())}>Create</button></div>}</div>}

      {project && csvKind && csv && <div className="editor-layout"><div className="record-list"><div className="record-list-head"><input type="search" placeholder="Search…" value={filter} onChange={(event) => setFilter(event.target.value)} /><button title="Add record" onClick={addCsvRow}>+</button></div><small className="count">{filteredRows.length} record · {fileTitle(file)}</small><div className="record-scroll">{filteredRows.map((index) => { const row = csv.get(index); const title = csvKind === 'games' ? `${row.home_team || 'Home'} / ${row.away_team || 'Away'}` : csvKind === 'stats' ? `${row.player_id || 'Player'} / ${row.game_id || 'Game'}` : `${row.player_id || 'Player'} / ${row.team_id || 'Team'}`; return <button key={`${index}-${row.id || row.player_id}`} className={selectedRow === index ? 'selected' : ''} onClick={() => setSelectedRow(index)}><small>{row.date || row.season || row.game_id || 'NEW'}</small><strong>{title}</strong><span>{row.status || row.number || row.points || ''}</span></button>; })}</div></div><div className="panel record-editor">{selected ? <><div className="panel-heading"><div><span className="eyebrow">{csvKind === 'games' ? 'Game record' : csvKind === 'stats' ? 'Recorded statistic' : 'Roster entry'}</span><h2>{csvKind === 'games' ? 'Game details' : csvKind === 'stats' ? 'Player statistics' : 'Team player'}</h2></div></div><div className="form-grid">{[...preferredFields[csvKind], ...csv.columns.filter((column) => !preferredFields[csvKind].includes(column))].filter((column) => csv.columns.includes(column)).map((column) => <label key={column} className={['notes', 'instagram_url', 'youtube_url', 'address'].includes(column) ? 'wide' : ''}><span>{fieldLabels[column] || column}</span>{(column === 'home_team' || column === 'away_team' || column === 'team_id') ? <select value={selected[column]} onChange={(event) => updateCsv(selectedRow!, column, event.target.value)}><option value="">Select…</option>{catalog.teams.map((id) => <option key={id}>{id}</option>)}</select> : column === 'player_id' ? <select value={selected[column]} onChange={(event) => updateCsv(selectedRow!, column, event.target.value)}><option value="">Select…</option>{catalog.players.map((id) => <option key={id}>{id}</option>)}</select> : column === 'game_id' ? <select value={selected[column]} onChange={(event) => updateCsv(selectedRow!, column, event.target.value)}><option value="">Select…</option>{catalog.games.map((id) => <option key={id}>{id}</option>)}</select> : column === 'status' ? <select value={selected[column]} onChange={(event) => updateCsv(selectedRow!, column, event.target.value)}>{['scheduled', 'played', 'final'].map((item) => <option key={item}>{item}</option>)}</select> : column === 'active' ? <select value={selected[column]} onChange={(event) => updateCsv(selectedRow!, column, event.target.value)}><option value="true">Yes</option><option value="false">No</option></select> : <input value={selected[column] ?? ''} type={column === 'date' ? 'date' : column === 'time' ? 'time' : 'text'} readOnly={column === 'id' && savedContent.includes(selected.id)} onChange={(event) => updateCsv(selectedRow!, column, event.target.value)} />}</label>)}</div>{csvKind === 'stats' && <p className="hint">These are the values stored in the CSV. The site calculates averages and totals during the build.</p>}</> : <div className="empty-selection"><strong>Select a record</strong><p>Open a row from the list or create a new one. Changes remain in the draft until you select “Save locally”.</p></div>}{csvKind === 'stats' && <button className="button subtle" onClick={() => void importStats()}>Import CSV · add only new records</button>}</div></div>}

      {project && section === 'teams' && file && <div className="entity-stack narrow">
        <div className="panel"><div className="panel-heading"><h2>Teams</h2><span>{teamIds.length} teams</span></div>
          <div className="team-tabs">{teamIds.map((id) => <button key={id} className={selectedTeam === id ? 'active' : ''} onClick={() => setSelectedTeam(id)}>{id}</button>)}</div>
          {selectedTeam ? <><p className="hint">Stable ID: <code>{selectedTeam}</code>. It cannot change because games and rosters use it.</p><div className="form-grid">{['name', 'short_name', 'logo', 'logo_on_dark'].map((key) => <label key={key}><span>{key === 'name' ? 'Full name' : key === 'short_name' ? 'Short name' : key === 'logo' ? 'Logo on light' : 'Logo on dark'}</span><input value={String(teamDoc?.getIn([selectedTeam, key]) ?? '')} onChange={(event) => updateYamlField(key, event.target.value, selectedTeam)} /></label>)}</div></> : <p>Select a team to edit it, or add one below.</p>}
        </div>
        <div className="panel"><span className="eyebrow">New team</span><h2>Add team</h2><div className="form-grid">
          <label><span>Stable ID (e.g. aurora-juniors)</span><input value={newTeamId} onChange={(event) => setNewTeamId(event.target.value)} placeholder="new-team" /></label>
          <label><span>Full name</span><input value={newTeamName} onChange={(event) => setNewTeamName(event.target.value)} placeholder="Official name" /></label>
          <label><span>Short name</span><input value={newTeamShortName} onChange={(event) => setNewTeamShortName(event.target.value)} placeholder="Scoreboard name" /></label>
        </div><p className="hint">After adding it to the draft, select it above to set logos. Import images under “Images”.</p><button className="button primary" onClick={createTeam}>Add to draft</button></div>
      </div>}

      {project && section === 'competitions' && file && competitionConfig && <div className="entity-stack narrow">
        <div className="panel"><span className="eyebrow">Seasons</span><h2>Season to manage</h2><div className="form-grid">
          <label><span>Season</span><select value={activeSeasonId} onChange={(event) => { setSelectedSeason(event.target.value); setSelectedCompetition(''); }}>
            {competitionConfig.seasons.map((season) => <option key={season.id} value={season.id}>{season.id}</option>)}
          </select></label>
          <label><span>Current site season</span><select value={competitionConfig.current_season} onChange={(event) => applyContent(() => setCurrentSeason(content, event.target.value))}>
            {competitionConfig.seasons.map((season) => <option key={season.id} value={season.id}>{season.id}</option>)}
          </select></label>
        </div><p className="hint">Selecting a season here only opens it for editing; changing “Current site season” changes which season appears first on the site.</p>
          <div className="entity-create"><label><span>New season (YYYY-YY)</span><input value={newSeasonId} onChange={(event) => setNewSeasonId(event.target.value)} placeholder="2027-28" /></label><button className="button subtle" onClick={createSeason}>Add season</button></div>
        </div>
        {activeSeason && <div className="panel"><div className="panel-heading"><div><span className="eyebrow">{activeSeason.id}</span><h2>Competitions</h2></div><span>{activeSeason.competitions.length} competitions</span></div>
          <div className="team-tabs">{activeSeason.competitions.map((competition) => <button key={competition.id} className={activeCompetitionId === competition.id ? 'active' : ''} onClick={() => setSelectedCompetition(competition.id)}>{competition.name || competition.id}</button>)}</div>
          {activeCompetition ? <><p className="hint">Stable ID: <code>{activeCompetition.id}</code>. Keeping it prevents older games, standings, and statistics from losing their links.</p><div className="form-grid">
            <label className="wide"><span>Competition name</span><input value={activeCompetition.name ?? ''} onChange={(event) => applyContent(() => editCompetition(content, activeSeasonId, activeCompetitionId, { name: event.target.value }))} /></label>
            <label><span>Points per win (blank = wins only)</span><input type="number" min="0" step="1" value={activeCompetition.standings_points?.win ?? ''} onChange={(event) => applyContent(() => editCompetition(content, activeSeasonId, activeCompetitionId, { win: event.target.value === '' ? null : Number(event.target.value) }))} /></label>
            <label><span>Points per loss</span><input type="number" min="0" step="1" value={activeCompetition.standings_points?.loss ?? ''} onChange={(event) => applyContent(() => editCompetition(content, activeSeasonId, activeCompetitionId, { loss: event.target.value === '' ? null : Number(event.target.value) }))} /></label>
          </div><div className="entity-checks"><strong>Participating teams</strong><div className="checkbox-grid">{clubTeamOptions.map((id) => <label key={id}><input type="checkbox" checked={activeCompetitionTeams.includes(id)} onChange={(event) => applyContent(() => editCompetition(content, activeSeasonId, activeCompetitionId, { teams: event.target.checked ? [...activeCompetitionTeams, id] : activeCompetitionTeams.filter((team) => team !== id) }))} />{id}</label>)}</div></div></> : <p>No competitions in this season. Add one below.</p>}
        </div>}
        {activeSeason && <div className="panel"><span className="eyebrow">New competition · {activeSeasonId}</span><h2>Add competition</h2><div className="form-grid">
          <label><span>Stable ID (e.g. gold)</span><input value={newCompetitionId} onChange={(event) => setNewCompetitionId(event.target.value)} placeholder="gold" /></label>
          <label><span>Full name</span><input value={newCompetitionName} onChange={(event) => setNewCompetitionName(event.target.value)} placeholder="Community League Gold" /></label>
        </div><div className="entity-checks"><strong>Participating teams</strong><div className="checkbox-grid">{catalog.teams.map((id) => <label key={id}><input type="checkbox" checked={newCompetitionTeams.includes(id)} onChange={(event) => setNewCompetitionTeams(event.target.checked ? [...newCompetitionTeams, id] : newCompetitionTeams.filter((team) => team !== id))} />{id}</label>)}</div></div>
          <p className="hint">Game and statistics archives become available after saving the configuration. IDs cannot be changed in Studio.</p><button className="button primary" onClick={createCompetition}>Add to draft</button>
        </div>}
      </div>}

      {project && section === 'players' && file && playerDoc && <div className="panel narrow"><span className="eyebrow">Player profile</span><h2>{String(playerDoc.get('name') ?? 'New player')}</h2><div className="form-grid">{['id', 'name', 'birth_date', 'instagram', 'photo'].map((key) => <label key={key}><span>{key === 'birth_date' ? 'Date of birth' : key === 'photo' ? 'Photo (/assets/...)' : key}</span><input value={String(playerDoc.get(key) ?? '')} readOnly={key === 'id'} onChange={(event) => updateYamlField(key, event.target.value)} /></label>)}<label className="wide"><span>Bio</span><textarea rows={8} value={String(playerDoc.get('bio') ?? '')} onChange={(event) => updateYamlField('bio', event.target.value)} /></label><label className="wide"><span>Social links (one URL per line)</span><textarea rows={4} value={playerSocialUrls(playerDoc).join('\n')} onChange={(event) => updateYamlField('social_urls', event.target.value.split('\n').map((value) => value.trim()).filter(Boolean))} /></label></div><p className="hint">For photo paths, import the image under Images first. Career details can stay in the biography.</p></div>}

      {project && section === 'news' && file && news && <div className="news-layout"><div className="panel"><span className="eyebrow">News item · {fileTitle(file)}</span><div className="form-grid">{['title', 'date', 'cover', 'excerpt'].map((key) => <label key={key} className={key === 'excerpt' ? 'wide' : ''}><span>{key === 'title' ? 'Title' : key === 'date' ? 'Date' : key === 'cover' ? 'Cover (/assets/...)' : 'Introduction'}</span><input type={key === 'date' ? 'date' : 'text'} value={String(news.metadata[key] ?? '')} onChange={(event) => updateNewsField(key, event.target.value)} /></label>)}{['players', 'games'].map((key) => <label key={key}><span>{key === 'players' ? 'Linked players (comma-separated IDs)' : 'Linked games (comma-separated IDs)'}</span><input value={Array.isArray(news.metadata[key]) ? (news.metadata[key] as string[]).join(', ') : ''} onChange={(event) => updateNewsField(key, event.target.value.split(',').map((id) => id.trim()).filter(Boolean))} /></label>)}<label className="wide"><span>Markdown text</span><textarea className="markdown-editor" rows={20} value={news.body} onChange={(event) => { try { change(news.update({}, event.target.value)); } catch (cause) { setError(String(cause)); } }} /></label></div></div><div className="panel preview-panel"><span className="eyebrow">Markdown preview</span><h2>{String(news.metadata.title ?? '')}</h2><iframe sandbox="" title="Article preview" srcDoc={`<!doctype html><html><head><meta charset="UTF-8"><style>body{font:16px/1.65 Arial;padding:24px;color:#222}img{max-width:100%}a{color:#8a2632}h1,h2{line-height:1.1}</style></head><body>${String(marked.parse(news.body, { async: false }))}</body></html>`} /></div></div>}

      {project && section === 'media' && <div className="panel narrow"><span className="eyebrow">Site assets</span><h2>Import an image</h2><p>PNG, JPEG, WebP, or GIF up to 8 MB. Studio copies the file with a safe name into <code>site/public/assets/</code>.</p><button className="button subtle" onClick={() => void chooseImage()}>Choose image</button>{mediaPath && <div className="media-preview"><p>{mediaPath}</p>{mediaPreview && <img src={mediaPreview} alt="Selected image preview" />}<button className="button primary" onClick={() => void importImage()}>Copy into project</button></div>}<p className="hint">Do not import large videos; use a YouTube link in the game field.</p></div>}

      {project && section === 'backup' && <div className="panel narrow"><span className="eyebrow">Controlled restore</span><h2>Content backups</h2><p>The ZIP backup includes data, news, and images. A standard restore adds only missing files and reports existing ones.</p><div className="button-row"><button className="button primary" onClick={() => void backup(true)}>Export ZIP</button><button className="button subtle" onClick={() => void backup(false)}>Restore without overwriting</button></div><details><summary>Restore and overwrite</summary><p>Studio backs up each existing file before replacing it. Use this only after checking the ZIP.</p><button className="button danger" onClick={() => void backup(false, true)}>Choose ZIP and overwrite</button></details></div>}

      {project && section === 'publish' && <div className="publish-layout"><div className="panel"><span className="eyebrow">1 / Checks</span><h2>Before publishing</h2><button className="button subtle" onClick={() => void validate()}>Validate all content</button>{validation && <div className={validation.errors.length ? 'validation bad' : 'validation good'}><strong>{validation.errors.length ? `${validation.errors.length} issues to fix` : 'Valid data'}</strong><p>{validation.games} games · {validation.players} players · {validation.news} news</p>{validation.errors.map((item, index) => <p key={index}>{item}</p>)}</div>}<p className="hint">Entered data is checked against existing teams, players, and games. Build the full website before a release.</p></div><div className="panel"><span className="eyebrow">2 / Review</span><h2>Files to include</h2><p>Select only the files you intend to publish. Studio and site source code are not staged automatically.</p><div className="publish-files">{project.changedFiles.filter((path) => path.startsWith('site/data/') || path.startsWith('site/content/news/') || path.startsWith('site/public/assets/')).map((path) => <label key={path}><input type="checkbox" checked={publishFiles.includes(path)} onChange={(event) => setPublishFiles(event.target.checked ? [...publishFiles, path] : publishFiles.filter((item) => item !== path))} /><code>{path}</code></label>)}{!project.changedFiles.length && <p>No local files changed.</p>}</div><button className="button subtle" onClick={() => void showPreview()} disabled={!publishFiles.length}>Preview commit / push (dry run)</button>{preview && <><div className={preview.canPublish ? 'validation good' : 'validation bad'}><strong>{preview.canPublish ? 'Ready to publish' : 'Push blocked in this copy'}</strong>{preview.errors.map((item, index) => <p key={index}>{item}</p>)}<p>{preview.files.length} selected files · branch {preview.branch} · origin/main: {preview.ahead ?? '?'} ahead, {preview.behind ?? '?'} behind</p></div><pre className="diff">{preview.diff || 'No tracked diff; new media are added only after confirmation.'}</pre></>}</div><div className="panel publish-confirm"><span className="eyebrow">3 / Explicit confirmation</span><h2>Publish to GitHub</h2><p>Studio fetches, blocks divergence, commits only selected files, and pushes to <code>main</code>. GitHub Pages deployment starts after the push.</p><label><span>Commit message</span><input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} /></label><label><span>To confirm, type PUBLISH TO MAIN</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label><button className="button primary" disabled={!preview?.canPublish || confirmation !== 'PUBLISH TO MAIN' || busy} onClick={() => void doPublish()}>Publish to GitHub</button>{published && <div className="validation good"><strong>Push successful · {published.commit.slice(0, 8)}</strong><p>{published.deployStatus}</p><a href={published.commitUrl} target="_blank" rel="noreferrer">Commit ↗</a><a href={published.actionsUrl} target="_blank" rel="noreferrer">Actions workflow ↗</a><a href={published.siteUrl} target="_blank" rel="noreferrer">Site ↗</a></div>}</div></div>}
      {project && ['games', 'stats', 'players', 'news'].includes(section) && !file && <div className="panel empty-file"><h2>Select a file</h2><p>Choose a season or profile from the list above. Historical data remain available without automatic changes.</p></div>}
      {busy && <div className="busy" role="status">Working…</div>}
    </main>
  </div>;
}


