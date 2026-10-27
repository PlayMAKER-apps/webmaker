# WebMAKER 0.1.0

WebMAKER crea siti statici per associazioni sportive. Questa repository contiene il motore del sito, tre temi, WebMAKER Studio per Windows, dati demo fittizi e un inizializzatore per nuovi club. Il codice di Studio deriva dal progetto Nerone, scritto dall'autore di PlayMAKER. Il codice è distribuito con licenza Apache-2.0; conserva il file [NOTICE](NOTICE) nelle redistribuzioni. Vedi [audit e limiti](docs/migration-audit.md).

![Illustrazione dei tre temi](docs/images/01-themes.svg)

## Guida per l'uso

### 1. Ottieni il codice e crea il tuo sito

Clona [PlayMAKER-apps/webmaker](https://github.com/PlayMAKER-apps/webmaker) e crea un'istanza indipendente:

```bash
git clone https://github.com/PlayMAKER-apps/webmaker.git
cd webmaker
node scripts/init-club.mjs ../mio-club
```

Il nuovo progetto contiene `site/`, `shared/` e il workflow GitHub Pages; non contiene cronologia, immagini o dati Nerone. Richiede Node.js 22 o successivo.

### 2. Personalizza il club

Apri `mio-club/site/data/club.yaml` e cambia nome, slogan, descrizione, email, social, lingua, timezone, colori, sport, `site_url`, `repository_url` e `base_path`. Scegli `theme: bold`, `classic` o `dynamic`: i contenuti restano identici. Sostituisci squadre, giocatori e roster in `site/data/` e gli articoli in `site/content/news/`. Usa ID stabili e file di prova prima di inserire dati reali. Copia solo immagini di cui hai i diritti in `site/public/assets/`.

Il profilo sport si sceglie con `sport: basketball` o `football`; puoi aggiungerne uno strutturato in `shared/profiles/`. I roster mantengono `site/data/teams.yaml`, `site/data/players/*.yaml` e `site/data/rosters.csv` per l'import di TagMAKER. Le statistiche partita sono un CSV distinto dall'export eventi JSON di TagMAKER 0.1.

![Schema illustrativo di WebMAKER Studio](docs/images/02-studio.svg)

Puoi usare un agente AI per personalizzare il sito: dagli `site/data/club.yaml`, i CSV/YAML demo e [lo schema](shared/site-0.1.schema.json), chiedi modifiche **solo ai contenuti o al tema**, poi controlla il diff e lancia `npm test` e `npm run build`. Non inviare dati personali, foto di minori, credenziali o contenuti non autorizzati al servizio AI. Per cambiare layout o aggiungere sport, chiedi una modifica al motore su un branch separato e verifica tutte le pagine.

### 3. Anteprima e GitHub Pages

```bash
cd mio-club/site
npm ci
npm test
npm run build
npm run dev
```

L'anteprima locale è su `http://localhost:4173`. Per pubblicare, crea un repository GitHub vuoto per il club. Per esempio, per il repository `utente/mio-club` configura `repository_url: https://github.com/utente/mio-club.git`, `site_url: https://utente.github.io/mio-club/` e `base_path: /mio-club` in `site/data/club.yaml`. Quindi, dalla root `mio-club`:

```bash
git init -b main
git add .
git commit -m "Create club site"
git remote add origin https://github.com/utente/mio-club.git
git push -u origin main
```

In **Settings → Pages → Build and deployment** scegli **GitHub Actions**. Il workflow `.github/workflows/deploy.yml` calcola il percorso Pages del repository e pubblica soltanto la build statica; Studio non va sul server. Dopo il push attendi il workflow verde e apri l'URL pubblico. Un push riuscito non prova che il deploy sia completato.

![Schema illustrativo dei passaggi GitHub Pages](docs/images/03-pages.svg)

### 4. WebMAKER Studio per Windows

Scarica [WebMAKER Studio per Windows dalla release 0.1.0](https://github.com/PlayMAKER-apps/webmaker/releases/tag/v0.1.0). L'installer non è firmato digitalmente. Installa anche Git for Windows per pubblicare da Studio. Per avviare Studio da sorgente, nella cartella `studio/` installa Node.js 22+, Rust/MSVC, Visual Studio Build Tools, WebView2 e Git for Windows; poi:

```powershell
npm ci
npm test
npm run build
npm run tauri dev
```

Per costruire un installer usa `npm run tauri build`; controlla `studio/src-tauri/target/release/bundle/`. Apri in Studio la root Git di **un progetto club alla volta**. In **Club e tema** puoi cambiare nome, colori e tema; usa **Salva sul PC**, poi **Pubblica** per validare, vedere il diff e fare push. Il push è ammesso solo da `main` quando `origin` coincide esattamente con `repository_url` nel file club. L'autenticazione passa da Git Credential Manager; Studio non salva PAT. Conflitti o divergenze bloccano la pubblicazione. Lo stato del deploy va verificato in GitHub Actions.

## Per chi vuole migliorare WebMAKER

Apri una issue con il problema e un esempio sintetico, crea un fork/branch, modifica un'area alla volta e proponi una pull request. Per il sito esegui `cd site && npm ci && npm test && npm run build`; per Studio `cd studio && npm ci && npm test && npm run build` e `cargo test --manifest-path src-tauri/Cargo.toml`. Controlla [l'audit](docs/migration-audit.md) e il contratto [PlayMAKER](https://github.com/PlayMAKER-apps/playmaker-schema) prima di cambiare ID o formati. Le modifiche al formato richiedono una nuova versione di schema e una migrazione non distruttiva.

Il generatore grafico Nerone non è incluso in questa versione: contiene asset e logiche di club ancora da separare. Non considerarlo una funzione disponibile in Studio. I tre **temi web** sono distinti dai template per grafiche social.

## Struttura e stato

| Cartella | Contenuto |
| --- | --- |
| `site/` | Generatore statico, dati demo, tre temi e test |
| `studio/` | App desktop Tauri 2 + React/TypeScript |
| `shared/` | Schema configurazione e profili sport |
| `starter/` | Istruzioni per la copia di una nuova istanza |
| `docs/` | Audit, limiti e illustrazioni della guida |

Il motore viene copiato in ogni repository club in questa versione. Gli aggiornamenti richiedono una revisione manuale e una pull request; i template GitHub non si sincronizzano automaticamente. Lo Studio può gestire più repository locali, uno alla volta, senza mescolare bozze o backup.
