import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(root, 'data');
const out = join(root, 'dist');
const readYaml = (path) => YAML.parse(readFileSync(path, 'utf8'));
const error = (message) => { throw new Error(message); };
const club = readYaml(join(data, 'club.yaml'));
const teams = readYaml(join(data, 'teams.yaml'));
const competitionConfig = readYaml(join(data, 'competitions.yaml'));
const players = readdirSync(join(data, 'players')).filter((name) => /\.ya?ml$/.test(name) && !name.startsWith('_')).map((name) => readYaml(join(data, 'players', name)));
const theme = process.env.WEBMAKER_THEME ?? club.theme;
const sport = process.env.WEBMAKER_SPORT ?? club.sport;
if (!/^[a-z0-9-]+$/.test(sport)) error('ID sport non valido');
const profilePath = resolve(root, '..', 'shared', 'profiles', `${sport}.json`);
const profile = existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, 'utf8')) : null;
const required = (value, label) => value || error(`${label} mancante`);
if (club.schema_version !== '0.1') error('Versione schema non supportata');
if (!['bold', 'classic', 'dynamic'].includes(theme)) error('Tema non valido');
const siteUrl = process.env.SITE_URL ?? club.site_url;
if (!/^https:\/\//.test(siteUrl)) error('site_url deve usare HTTPS');
if (!/^#[0-9a-fA-F]{6}$/.test(club.colors?.primary) || !/^#[0-9a-fA-F]{6}$/.test(club.colors?.accent)) error('Colori non validi');
const headingFonts={auto:'',sans:'Arial,sans-serif',serif:'Georgia,serif',display:'Impact,Arial,sans-serif'};
const bodyFonts={sans:'Arial,sans-serif',serif:'Georgia,serif'};
if (!((club.fonts?.heading ?? 'auto') in headingFonts) || !((club.fonts?.body ?? 'sans') in bodyFonts)) error('Font non valido');
const fontStyle=`${headingFonts[club.fonts?.heading??'auto']?`--heading-font:${headingFonts[club.fonts.heading]};`:''}--body-font:${bodyFonts[club.fonts?.body??'sans']};`;
required(club.name, 'Nome club'); required(club.language, 'Lingua'); required(club.timezone, 'Timezone');
if (!profile) error(`Profilo sport ${sport} non trovato`);
const base = process.env.BASE_PATH ?? club.base_path ?? '';
if (base && !/^\/[a-zA-Z0-9/_-]+$/.test(base)) error('BASE_PATH non valido');
const path = (slug = '/') => `${base}${slug === '/' ? '/' : slug.startsWith('/') ? slug : `/${slug}`}`;
const canonical = (slug = '/') => new URL(path(slug).replace(/^\//, ''), new URL(`${new URL(siteUrl).origin}/`)).href;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const csv = (source) => { const rows=[]; let row=[], field='', quoted=false; for(let i=0;i<source.length;i++){const c=source[i]; if(c==='"' && quoted && source[i+1]==='"'){field+='"';i++;} else if(c==='"') quoted=!quoted; else if(c===','&&!quoted){row.push(field);field='';} else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&source[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';} else field+=c;} if(field||row.length){row.push(field);rows.push(row);} const [headers,...body]=rows; return body.map((values)=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??'']))); };
const readCsv = (relative) => { const file=join(data, relative); return existsSync(file) ? csv(readFileSync(file,'utf8')) : []; };
const seasons = competitionConfig.seasons ?? [];
const globalGameIds=new Set();
const memberships = readCsv('rosters.csv');
const playerIds = new Set(players.map((p)=>p.id));
const validId=(id)=>typeof id==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
for(const id of Object.keys(teams))if(!validId(id))error(`ID squadra non valido: ${id}`);
for(const p of players)if(!validId(p.id))error(`ID giocatore non valido: ${p.id}`);
for(const entry of memberships){if(!playerIds.has(entry.player_id))error(`Roster: giocatore ${entry.player_id} inesistente`);if(!teams[entry.team_id])error(`Roster: squadra ${entry.team_id} inesistente`);}
const games=[]; const stats=[]; const standings=new Map();
for(const season of seasons) for(const competition of season.competitions){
  if(!/^\d{4}-\d{2}$/.test(season.id)||!validId(competition.id))error('ID stagione o campionato non valido');
  const key=`${season.id}/${competition.id}`;
  const rows=readCsv(`games/${key}.csv`); const ids=new Set();
  for(const game of rows){if(!validId(game.id)||ids.has(game.id)||globalGameIds.has(game.id))error(`ID partita mancante, non valido o duplicato: ${game.id}`);ids.add(game.id);globalGameIds.add(game.id);if(!teams[game.home_team]||!teams[game.away_team])error(`${game.id}: squadra sconosciuta`);games.push({...game,season:season.id,competition:competition.id});}
  for(const stat of readCsv(`player-stats/${key}.csv`)){if(!ids.has(stat.game_id)||!playerIds.has(stat.player_id))error(`Statistica con riferimento invalido: ${stat.game_id}/${stat.player_id}`);stats.push({...stat,season:season.id,competition:competition.id});}
  const table=new Map(); const add=(id)=>{if(!table.has(id))table.set(id,{id,played:0,wins:0,losses:0,for:0,against:0});return table.get(id);};
  for(const g of rows.filter((g)=>g.status==='final'&&g.home_score!==''&&g.away_score!==''&&(!g.phase||g.phase==='regular-season'))){const h=add(g.home_team),a=add(g.away_team),hs=Number(g.home_score),as=Number(g.away_score);h.played++;a.played++;h.for+=hs;h.against+=as;a.for+=as;a.against+=hs;if(hs>as){h.wins++;a.losses++;}else if(as>hs){a.wins++;h.losses++;}}
  standings.set(key,[...table.values()].map((r)=>({...r,points:r.wins*(competition.standings_points?.win??2)+r.losses*(competition.standings_points?.loss??0)})).sort((a,b)=>b.points-a.points||(b.for-b.against)-(a.for-a.against)));
}
const newsDir=join(root,'content','news');
const news=existsSync(newsDir)?readdirSync(newsDir).filter((n)=>n.endsWith('.md')&&!n.startsWith('_')).map((name)=>{const raw=readFileSync(join(newsDir,name),'utf8');const m=raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);if(!m)error(`${name}: front matter non valido`);return {...YAML.parse(m[1]),body:m[2].trim(),slug:name.slice(0,-3)};}).sort((a,b)=>String(b.date).localeCompare(String(a.date))):[];
for(const article of news)if(!validId(article.slug))error(`Slug notizia non valido: ${article.slug}`);
const clubIds=new Set(seasons.flatMap((s)=>s.competitions.flatMap((c)=>c.teams??(c.team?[c.team]:[]))));
const current=seasons.find((s)=>s.id===competitionConfig.current_season)??error('Stagione corrente inesistente');
const label=(id)=>teams[id]?.short_name??id;
const asset=(value)=>{if(!value)return '';if(!/^\/assets\/[a-zA-Z0-9/_\-.]+$/.test(value))error(`Percorso asset non valido: ${value}`);if(!existsSync(join(root,'public',value.slice(1))))error(`Asset mancante: ${value}`);return path(value);};
const nav=[['/', 'Home'],['/club/','Club'],['/calendario/','Calendario'],['/campionati/','Campionati'],['/roster/','Roster'],['/notizie/','Notizie']];
const link=(slug,text,cls='')=>`<a class="${cls}" href="${path(slug)}">${esc(text)}</a>`;
const teamCard=(id)=>`<article class="team-card">${asset(teams[id].logo)?`<img class="card-image logo-image" src="${asset(teams[id].logo)}" alt="">`:''}<span class="kicker">Squadra</span><h3>${esc(teams[id].name)}</h3>${link(`/roster/${id}/`,'Scopri il roster →')}</article>`;
const gameCard=(g)=>`<article class="game-card"><span class="kicker">${esc(g.date)} · ${esc(g.time)} · ${esc(g.competition)}</span><h3>${esc(label(g.home_team))} <span>${g.status==='final'?`${esc(g.home_score)} : ${esc(g.away_score)}`:'vs'}</span> ${esc(label(g.away_team))}</h3><p>${esc(g.venue||'Campo da definire')}</p>${link(`/partite/${g.id}/`,'Scheda partita →')}</article>`;
const newsCard=(n)=>`<article class="news-card">${asset(n.cover)?`<img class="card-image" src="${asset(n.cover)}" alt="">`:''}<span class="kicker">${esc(n.date)}</span><h3>${esc(n.title)}</h3><p>${esc(n.excerpt||'')}</p>${link(`/notizie/${n.slug}/`,'Leggi →')}</article>`;
const section=(title,content,cls='')=>`<section class="content-section ${cls}"><div class="container"><h2>${esc(title)}</h2>${content}</div></section>`;
const header=()=>`<header class="site-header"><div class="container header-inner"><a class="brand" href="${path('/')}">${asset(club.logo)?`<img src="${asset(club.logo)}" alt="" class="brand-logo">`:''}${esc(club.short_name||club.name)}</a><nav aria-label="Navigazione principale">${nav.map(([url,text])=>link(url,text)).join('')}</nav><details class="mobile-nav"><summary>Menu</summary><nav aria-label="Navigazione mobile">${nav.map(([url,text])=>link(url,text)).join('')}</nav></details></div></header>`;
const footer=()=>`<footer><div class="container"><strong>${esc(club.name)}</strong><p>${esc(club.tagline)}</p><p>${club.contacts?.email?`<a href="mailto:${esc(club.contacts.email)}">${esc(club.contacts.email)}</a>`:''} ${club.social?.instagram?.startsWith('https://')?`<a href="${esc(club.social.instagram)}">Instagram</a>`:''} ${club.social?.youtube?.startsWith('https://')?`<a href="${esc(club.social.youtube)}">YouTube</a>`:''}</p><small><a href="https://github.com/PlayMAKER-apps/webmaker">WebMAKER</a> by <a href="https://playmaker-apps.github.io/">PlayMAKER</a> · ${esc(profile.name)}</small></div></footer>`;
const orgSchema={'@context':'https://schema.org','@type':'SportsOrganization',name:club.name,url:canonical('/'),logo:asset(club.logo)?canonical(club.logo):undefined,email:club.contacts?.email||undefined,sameAs:Object.values(club.social||{}).filter((value)=>typeof value==='string'&&value.startsWith('https://'))};
const ogImage=asset(club.logo)?`<meta property="og:image" content="${canonical(club.logo)}">`:'';
const render=(slug,title,description,body)=>`<!doctype html><html lang="${esc(club.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(club.name)}</title><meta name="description" content="${esc(description||club.description)}"><link rel="canonical" href="${canonical(slug)}"><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)} · ${esc(club.name)}"><meta property="og:description" content="${esc(description||club.description)}"><meta property="og:url" content="${canonical(slug)}">${ogImage}<meta name="theme-color" content="${esc(club.colors.primary)}"><link rel="stylesheet" href="${path('/assets/site.css')}"><link rel="icon" href="${path('/assets/favicon.svg')}"><script type="application/ld+json">${JSON.stringify(orgSchema).replace(/</g,'\\u003c')}</script></head><body class="theme-${theme}" style="--primary:${esc(club.colors.primary)};--accent:${esc(club.colors.accent)};${fontStyle}"><a class="skip-link" href="#main">Vai al contenuto</a>${header()}<main id="main">${body}</main>${footer()}</body></html>`;
const pages=new Map(); const add=(slug,title,description,body)=>pages.set(slug,render(slug,title,description,body));
const next=games.filter((g)=>g.status==='scheduled'&&g.date>=new Date().toISOString().slice(0,10)).sort((a,b)=>a.date.localeCompare(b.date))[0];
const latest=games.filter((g)=>g.status==='final').sort((a,b)=>b.date.localeCompare(a.date))[0];
const teaser=next??latest;
const homeTeams=[...clubIds].filter((id)=>teams[id]);
const hero=`<section class="home-hero"><div class="container hero-layout"><div class="hero-copy"><span class="kicker">${esc(profile.name)} · ${esc(current.id)}</span><h1>${esc(club.name)}</h1><p>${esc(club.tagline)}</p><div class="hero-actions">${link('/calendario/','Segui la stagione →','button')}${link('/club/','Conosci il club','text-link')}</div></div><div class="hero-feature">${asset(club.hero_image)?`<img class="hero-image" src="${asset(club.hero_image)}" alt="">`:''}<span class="kicker">${teaser?(teaser.status==='final'?'Ultimo risultato':'Prossima partita'):'In aggiornamento'}</span>${teaser?gameCard(teaser):'<p>Il calendario sarà disponibile presto.</p>'}</div></div></section>`;
add('/','Home',club.description,hero+section('Le nostre squadre',`<div class="card-grid">${homeTeams.length?homeTeams.map(teamCard).join(''):'<p>Nessuna squadra ancora inserita.</p>'}</div>`,'home-teams')+section('Dal club',`<div class="card-grid">${news.length?news.slice(0,3).map(newsCard).join(''):'<p>Nessuna notizia pubblicata.</p>'}</div>`,'home-news'));
add('/club/','Il club',club.description,`<section class="page-hero"><div class="container"><span class="kicker">La nostra identità</span><h1>${esc(club.name)}</h1><p>${esc(club.description)}</p></div></section>`+section('Squadre',`<div class="card-grid">${homeTeams.map(teamCard).join('')}</div>`)+section('Contatti',`<p>${esc(club.contacts?.email||'Contatti in aggiornamento')}</p>`));
add('/calendario/','Calendario','Calendario e risultati',`<section class="page-hero"><div class="container"><span class="kicker">${esc(current.id)}</span><h1>Calendario</h1><p>Partite future e archivio risultati.</p></div></section>`+section('Partite',`<div class="card-grid">${games.length?games.sort((a,b)=>b.date.localeCompare(a.date)).map(gameCard).join(''):'<p>Nessuna partita inserita.</p>'}</div>`));
add('/campionati/','Campionati','Campionati e classifiche',`<section class="page-hero"><div class="container"><h1>Campionati</h1></div></section>`+section('Stagioni',`<div class="card-grid">${seasons.flatMap((s)=>s.competitions.map((c)=>`<article class="team-card"><span class="kicker">${esc(s.id)}</span><h3>${esc(c.name)}</h3>${link(`/campionato/${s.id}/${c.id}/`,'Risultati e classifica →')}</article>`)).join('')}</div>`));
for(const s of seasons)for(const c of s.competitions){const key=`${s.id}/${c.id}`; const table=standings.get(key)||[];add(`/campionato/${s.id}/${c.id}/`,c.name,`Risultati e classifica ${s.id}`,`<section class="page-hero"><div class="container"><span class="kicker">${esc(s.id)}</span><h1>${esc(c.name)}</h1></div></section>`+section('Classifica',table.length?`<div class="table-wrap"><table><thead><tr><th>Squadra</th><th>G</th><th>V</th><th>P</th><th>${esc(profile.scoreLabel)}</th></tr></thead><tbody>${table.map((r)=>`<tr><th>${esc(teams[r.id]?.name||r.id)}</th><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.points}</td></tr>`).join('')}</tbody></table></div>`:'<p>La classifica sarà disponibile dopo i primi risultati.</p>')+section('Partite',`<div class="card-grid">${games.filter((g)=>g.season===s.id&&g.competition===c.id).map(gameCard).join('')}</div>`));}
add('/roster/','Roster','Squadre e giocatori',`<section class="page-hero"><div class="container"><h1>Roster</h1></div></section>`+section('Squadre',`<div class="card-grid">${homeTeams.map(teamCard).join('')}</div>`));
for(const id of homeTeams){const roster=memberships.filter((r)=>r.team_id===id&&r.season===current.id);add(`/roster/${id}/`,teams[id].name,`Roster di ${teams[id].name}`,`<section class="page-hero"><div class="container"><span class="kicker">Roster ${esc(current.id)}</span><h1>${esc(teams[id].name)}</h1></div></section>`+section('Giocatori',`<div class="card-grid">${roster.length?roster.map((r)=>{const p=players.find((x)=>x.id===r.player_id);return `<article class="player-card"><span class="number">${esc(r.number)}</span><h3>${esc(p?.name||r.player_id)}</h3><p>${esc(r.role)}</p>${link(`/giocatori/${r.player_id}/`,'Profilo →')}</article>`}).join(''):'<p>Roster in aggiornamento.</p>'}</div>`));}
for(const p of players){const totals=stats.filter((s)=>s.player_id===p.id);add(`/giocatori/${p.id}/`,p.name,`Profilo di ${p.name}`,`<section class="page-hero"><div class="container"><span class="kicker">Giocatore</span><h1>${esc(p.name)}</h1><p>${esc(p.bio||'')}</p></div></section>`+section('Statistiche',totals.length?`<div class="stat-grid">${profile.stats.map((s)=>`<div><strong>${totals.reduce((sum,r)=>sum+Number(r[s.key]||0),0)}</strong><span>${esc(s.label)}</span></div>`).join('')}</div>`:'<p>Statistiche non ancora disponibili.</p>'));}
add('/notizie/','Notizie','Notizie del club',`<section class="page-hero"><div class="container"><h1>Notizie</h1></div></section>`+section('Ultimi articoli',`<div class="card-grid">${news.length?news.map(newsCard).join(''):'<p>Nessun articolo pubblicato.</p>'}</div>`));
for(const n of news)add(`/notizie/${n.slug}/`,n.title,n.excerpt,`<article class="article container"><span class="kicker">${esc(n.date)}</span><h1>${esc(n.title)}</h1><p class="lead">${esc(n.excerpt||'')}</p>${n.body.split(/\n\n+/).map((p)=>`<p>${esc(p)}</p>`).join('')}</article>`);
for(const g of games)add(`/partite/${g.id}/`,`${label(g.home_team)} – ${label(g.away_team)}`,'Scheda partita',`<section class="page-hero"><div class="container"><span class="kicker">${esc(g.date)} · ${esc(g.competition)}</span><h1>${esc(label(g.home_team))} ${g.status==='final'?`${esc(g.home_score)} – ${esc(g.away_score)}`:'vs'} ${esc(label(g.away_team))}</h1><p>${esc(g.venue||'Campo da definire')}</p></div></section>`+section('Dettagli',`<p>${esc(g.notes||'Dettagli in aggiornamento.')}</p>`));
mkdirSync(out,{recursive:true}); cpSync(join(root,'public'),out,{recursive:true,force:true});
for(const [slug,html]of pages){const file=join(out,slug==='/'?'index.html':`${slug.slice(1)}index.html`);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,html);}
const urls=[...pages.keys()].map((slug)=>`  <url><loc>${esc(canonical(slug))}</loc></url>`).join('\n');
writeFileSync(join(out,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
writeFileSync(join(out,'robots.txt'),`User-agent: *\nAllow: /\nSitemap: ${canonical('/sitemap.xml')}\n`);
writeFileSync(join(out,'.nojekyll'),'');
console.log(`WebMAKER: ${pages.size} pagine, ${games.length} partite, ${players.length} giocatori, tema ${theme}.`);

