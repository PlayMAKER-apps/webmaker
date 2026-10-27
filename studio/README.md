# WebMAKER Studio 0.1.0

App desktop Tauri 2 + React/TypeScript derivata dal pilota Nerone, creato dall'autore di PlayMAKER. Apre un progetto WebMAKER alla volta, legge e modifica CSV/YAML/Markdown, conserva bozze e backup locali, valida e prepara un push Git controllato. Non richiede un backend web. Codice Apache-2.0 con attribuzione nel file NOTICE della repository.

## Avvio e build

Richiede Node.js 22+, Rust stable con target MSVC, Visual Studio Build Tools C++, WebView2 e Git for Windows.

```powershell
npm ci
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

`npm run tauri build` produce il pacchetto Windows in `src-tauri/target/release/bundle/`. Gli installer pubblicati sono nella [release GitHub](https://github.com/PlayMAKER-apps/webmaker/releases/tag/v0.1.0); non sono inclusi nel sito statico.

## Uso

Apri la root di un repository Git per club con `site/data/club.yaml`, `site/data/teams.yaml`, `site/data/competitions.yaml` e `site/content/news/`. Il repository può essere ancora locale: il remote non è necessario per editare. In **Club e tema** modifica branding, URL, colori e tema; salva sul PC e costruisci `site/` per vedere l'anteprima reale. Studio non copia i dati quando cambia tema.

Le bozze sono salvate localmente e i file vengono scritti in modo atomico con backup. Il pulsante **Pubblica** prima valida i riferimenti e mostra il diff. Serve un branch `main`, `origin` allineato e identico al `repository_url` configurato, staging vuoto e conferma testuale. Le credenziali sono gestite da Git Credential Manager, non da file JSON o PAT nello Studio. Dopo il push controlla GitHub Actions: il deploy può ancora fallire.

Uno Studio può aprire più club in successione; bozze e backup sono separati per progetto. In caso di conflitto remoto o modifiche esterne al file, Studio blocca l'operazione e chiede una risoluzione manuale.

I campi statistiche dell'editor restano inizialmente orientati al basket. I profili sport del sito sono in `../shared/profiles/`; l'editor dinamico per tutti gli sport e il generatore grafico non sono inclusi in questo candidato.
