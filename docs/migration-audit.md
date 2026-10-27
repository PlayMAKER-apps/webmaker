# Audit di estrazione da Nerone

Sorgente esaminato: checkout locale di `nerone-basket/nerone-basket.github.io` al commit `11f7c3d`. Il checkout aveva già una modifica preesistente in `site/data/games/2026-27/platinum.csv`; non è stato alterato. La root non presenta un file `LICENSE`. La cronologia Git non è stata importata. L'autore del progetto Nerone ha confermato di averne scritto il codice e ha scelto di distribuirne la parte generalizzata con licenza Apache-2.0 e attribuzione nel NOTICE.

| Area sorgente | Rischio osservato | Decisione in WebMAKER 0.1 |
| --- | --- | --- |
| Sito Next/vinext e build-data | Nomi Nerone, URL, squadre, anni e asset fissi | Nuovo generatore statico e dati fittizi, senza copiare codice o media del sito |
| Foto, loghi, sponsor, roster | Diritti e privacy non verificati, possibili minori | Nessun asset o dato reale importato; solo fixture sintetiche |
| Studio Tauri/React | Codice e icona legati al club; licenza assente nel sorgente Nerone | Codice generalizzato, icona sostituita, titolarità confermata dall'autore, licenza Apache-2.0 e NOTICE aggiunti |
| Pubblicazione Studio | Remote Nerone hardcoded | Remote verificato contro `site/data/club.yaml`; push solo da `main` allineato |
| TagMAKER | Import roster e CSV statistiche basati su percorsi esistenti | Percorsi `teams.yaml`, `players/*.yaml`, `rosters.csv` e CSV partita conservati |
| Graphic generator | Template e sponsor Nerone, logo e font esterni | Non trasferito nel prodotto 0.1; serve estrazione autonoma con audit media |

## Limiti della versione 0.1

- La repository WebMAKER contiene il motore e l'app Studio; il sito di esempio Aurora è dimostrativo. Ogni nuovo club deve creare il proprio repository e abilitare GitHub Pages. La pubblicazione Pages di un club reale richiede verifica separata.
- I tre temi cambiano layout, navigazione visiva, hero e card tramite CSS e markup condiviso. Non esiste ancora una suite di screenshot regression automatizzati a 320/390/768/1440 px; servono prove browser e audit WCAG completi prima di una release stabile.
- Il sito usa un generatore Node di HTML statico invece del runtime React del pilota Nerone. Studio resta React/Tauri. Questa scelta riduce dipendenze e impedisce di trascinare codice e asset senza titolarità accertata.
- Studio conserva l'editor CSV del pilota, con campi statistiche iniziali orientati al basket. Il profilo calcio cambia etichette e sezioni pubbliche; l'editor statistico cross-sport va completato.
- L'anteprima Studio è dei dati, non del sito renderizzato. Per il rendering usa la build del sito. Il tema si modifica in un solo file senza duplicare contenuti.
- Le istanze club contengono una copia del motore. Gli aggiornamenti non sono automatici; vanno portati con confronto di versione e PR.
- La licenza Apache-2.0 e il NOTICE si applicano al codice WebMAKER. Le immagini e i dati del club Nerone non fanno parte della distribuzione e non sono concessi in licenza da questa repository.

## Verifiche locali

`site`: `npm ci`, `npm test` (3 temi + profilo calcio), `npm run build`. `studio`: `npm ci`, `npm test`, `npm run build`, `cargo test --offline`, `cargo check --offline`, build dell'installer Tauri. Un deploy GitHub Pages richiede verifica separata e non è implicito in questi test.
