# Migration audit: Nerone to WebMAKER

Source reviewed: the local checkout of `nerone-basket/nerone-basket.github.io` at commit `11f7c3d`. The checkout already contained a pre-existing change to `site/data/games/2026-27/platinum.csv`; it was not altered. The Nerone root had no `LICENSE` file. Its Git history was not imported. The Nerone project author confirmed ownership of its code and chose Apache-2.0 with a NOTICE attribution for the generalized work.

| Source area | Risk observed | WebMAKER 0.1 decision |
| --- | --- | --- |
| Nerone site and data build | Fixed club names, URLs, teams, seasons, and assets | New static generator and fictional data; no site code or club media copied |
| Photos, logos, sponsors, rosters | Unverified rights and privacy, including possible minors | No real asset or personal data imported |
| Tauri/React Studio | Club-specific code and icon; no license in Nerone source | Generalized code, replaced icon, author-confirmed ownership, Apache-2.0 and NOTICE added |
| Studio publishing | Nerone remote hardcoded | Remote checked against `site/data/club.yaml`; guarded push from `main` |
| TagMAKER | Roster import and statistics CSV depend on existing paths | Preserved `teams.yaml`, `players/*.yaml`, `rosters.csv`, and per-game CSV paths |
| Social graphics generator | Nerone templates, sponsors, logo, and external fonts | Deferred until engine and media rights can be separated |

## Current limitations

- The WebMAKER repository contains the generator and Studio; Aurora is fictional demonstration data. Each new club creates its own repository and enables GitHub Pages. A real club's Pages deployment must be verified separately.
- All three themes share content and routes while changing the layout, hero, navigation styling, and cards. Automated screenshot regression tests at 320/390/768/1440 px and a full WCAG audit are still needed before a stable release.
- The website uses a Node static HTML generator instead of the Nerone pilot's React runtime. Studio remains React/Tauri. This keeps dependencies small and avoids copying club-specific website code or media.
- Studio's statistics editor still has basketball-oriented fields. The football profile changes public site labels and sections; a fully cross-sport statistics editor remains to be built.
- Studio previews data; build the site to inspect rendered pages. Theme changes only update configuration and do not duplicate content.
- Club instances contain a copy of the generator. Updates require a version comparison and a reviewed pull request.
- Apache-2.0 and NOTICE apply to WebMAKER code. Nerone club images and data are not distributed or licensed by this repository.

## Verification

`site/`: `npm ci`, `npm test` across three themes and a football profile, `npm run build`. `studio/`: `npm ci`, `npm test`, `npm run build`, `cargo test --offline`, `cargo check --offline`, and a Tauri installer build. A GitHub Pages deployment is a separate check.
