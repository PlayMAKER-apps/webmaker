# WebMAKER hardening checks

This branch keeps the WebMAKER 0.1 site data and TagMAKER roster CSV/YAML paths compatible. It does not change the Nerone pilot or import its graphic generator.

## Automated checks

- `cd site && npm ci && npm test && npm run build` checks the three themes, starter creation, GitHub Pages base paths, sport profile validation, and static output.
- `cd site && npx playwright install chromium && npm run test:browser` captures screenshots and compares semantic/layout snapshots for Bold, Classic, and Dynamic at 320, 390, 768, and 1440 pixels. It also checks horizontal overflow, responsive navigation, page language, title, description, canonical URL, one main heading, image alt attributes, and link names. Review screenshots attached to the test report when a snapshot changes.
- `cd studio && npm ci && npm test && npm run build` checks Studio's TypeScript content adapters and UI build.
- `cargo test --locked --manifest-path studio/src-tauri/Cargo.toml` checks native save, validation, publication preview, Git branch/remote conflicts, and no staging or push during preview.
- CI runs these checks and `npm audit --audit-level=high` for both Node projects, plus `cargo audit` for Rust dependencies. The weekly run catches advisories published after a PR merges.
- The first audit found `zip` 2.6.1 advisories RUSTSEC-2026-0367, RUSTSEC-2026-0368, and RUSTSEC-2026-0369. Studio now uses `zip` 9 and handles its fallible entry-name API; the CI audit must remain green.

Browser snapshots record stable DOM and layout facts; PNGs in the CI report support visual review. They do not prove pixel-perfect rendering across operating systems or replace manual accessibility testing.

## Public export dependency

The proposed native API is `preview_public_export(selection) -> PublicExportPreview` followed by an explicit `save_public_export(path, selection)`. The preview must be read-only, enumerate only selected public fields, validate source IDs and assets, and never publish or push. The saved JSON must follow a separately versioned `club-public-0.1` contract, with optional players and statistics excluded unless selected. Do not implement or advertise that JSON format on this hardening branch until the schema team has approved its specification. The existing TagMAKER timeline JSON and roster CSV/YAML remain independent contracts.

## Human checks still needed

- Review screenshots and keyboard/screen-reader behavior on real devices, including mobile navigation, contrast, zoom, and motion preferences.
- Install Studio on a clean Windows PC; verify Git Credential Manager and an actual Pages deployment with a synthetic club.
- Review licenses and asset permissions before a new binary release. This CI does not constitute a legal review or binary audit.
