# Starter club

Il sito dimostrativo in `site/` contiene solo club, giocatori e partite fittizi. Per creare una nuova istanza senza la storia Git di Nerone:

```bash
node scripts/init-club.mjs ../mio-club
```

Lo script copia `site/`, `shared/` e il workflow Pages in una nuova cartella. Non copia Studio: lo stesso programma desktop può aprire più repository di club. Questa versione include una copia del motore in ogni istanza; le correzioni successive non arrivano automaticamente. Confronta la versione e porta gli aggiornamenti con una pull request guidata.

Prima di pubblicare, sostituisci tutti i dati dimostrativi e configura URL, repository, immagini e contatti in `site/data/club.yaml`. Gli ID di squadre, giocatori e partite devono restare stabili dopo la prima pubblicazione.
