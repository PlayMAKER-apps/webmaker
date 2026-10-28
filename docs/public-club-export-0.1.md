# Public club export 0.1

WebMAKER now has an opt-in public data export for PostMAKER. It reads the existing club, teams, competitions, games, players and roster files without changing their formats. `site/data/public-export.yaml` selects what may leave the site project. Only selected player IDs are included when `include_players` is true; optional stats are limited to those selected players and published fixtures. Sponsors must be listed with an asset and license. Contacts, notes, biographies, social links and private media are excluded.

Run `npm run export:club -- --out <file.json>` inside `site/` for a manual JSON file. To include `/data/playmaker-club-0.1.json` in the static build, set `publish_on_build: true` or `WEBMAKER_PUBLISH_CLUB_JSON=1`. Use `WEBMAKER_PUBLISH_CLUB_JSON=0` to suppress it. The starter site leaves publication disabled. Exported asset URLs include the configured GitHub Pages `base_path`; the JSON file itself is available under the same deployed base path. The export records its generation timestamp in UTC.

The format is specified in `PlayMAKER-apps/playmaker-schema/club-public-0.1.schema.json`. It is separate from the TagMAKER timeline JSON. WebMAKER Studio's roster CSV importer and all three site themes continue to use their existing data sources.
