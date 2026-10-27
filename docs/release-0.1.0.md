# WebMAKER 0.1.0

Prima release pubblica di WebMAKER: sito statico riutilizzabile per associazioni sportive e WebMAKER Studio per Windows.

## Include

- Tre temi per tutte le pagine: Bold, Classic e Dynamic, con gli stessi dati, URL e metadati SEO.
- Starter con dati fittizi, profili basket e calcio, inizializzatore `node scripts/init-club.mjs ../mio-club` e workflow GitHub Pages per ogni club.
- Studio per modificare contenuti e tema, salvare localmente, validare, controllare il diff e pubblicare tramite Git in modo controllato.
- Schema di configurazione 0.1 e percorsi roster compatibili con lo scambio dati PlayMAKER/TagMAKER.
- [Guida illustrata](https://github.com/PlayMAKER-apps/webmaker#guida-per-luso) per uso e contributi.

## Download Windows

- `WebMAKER.Studio_0.1.0_x64-setup.exe`: installer NSIS per Windows x64.
- `WebMAKER.Studio_0.1.0_x64_en-US.msi`: installer MSI alternativo per Windows x64.

Gli installer non sono firmati digitalmente. Per pubblicare da Studio installare anche Git for Windows con Git Credential Manager. Lo Studio lavora su una copia locale del repository del club; il sito pubblico usa solo HTML/CSS statico.

## Limiti noti

- L'editor statistiche Studio usa ancora campi orientati al basket; il sito pubblico usa i profili sport. L'editor interamente guidato dal profilo è in programma.
- Il generatore di grafiche social del pilota Nerone non fa parte di questa release.
- La preview in Studio mostra i dati; per controllare il sito renderizzato usare `npm run dev` nella cartella `site/`.
- Ogni istanza club contiene una copia del motore. Gli aggiornamenti del prodotto si applicano con revisione e pull request, non automaticamente.

Il codice è Apache-2.0 con attribuzione in `NOTICE`. I dati e le immagini del club Nerone non sono inclusi.
