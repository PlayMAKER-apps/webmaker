# WebMAKER Studio

WebMAKER Studio is a Tauri 2 + React/TypeScript desktop app developed from the Nerone Basket pilot, whose code was written by the PlayMAKER author. Version 0.2 can create an independent club from its bundled starter, clone an existing club, or open an already-cloned project. It edits CSV/YAML/Markdown files, keeps local drafts and backups, validates content, and prepares guarded Git publishing. It does not need a WebMAKER backend. The code is Apache-2.0 with attribution in the repository NOTICE.

## Run and build

Requires Node.js 22+, stable Rust with the MSVC target, Visual Studio Build Tools for C++, WebView2, and Git for Windows.

```powershell
npm ci
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

Run `npm run tauri build` to produce Windows packages under `src-tauri/target/release/bundle/`. Published installers are on the [GitHub releases page](https://github.com/PlayMAKER-apps/webmaker/releases); they are not part of the static website.

## Create, clone, or open

On the home screen:

- **Create a new club** generates clean club data, all three themes, the shared sport profiles, and the Pages workflow. It initializes `main` and creates the first local commit without overwriting an existing destination.
- The optional GitHub step signs in through Git Credential Manager, creates a public repository under the selected user or organization, pushes the initial commit, and asks GitHub to enable Pages with the included workflow. The token is never returned to the interface or written to disk by Studio.
- **Clone from GitHub** accepts only a normalized GitHub repository URL, clones into a new destination, verifies the WebMAKER structure, and opens it.
- **Open existing project** keeps the earlier workflow for repositories already on the computer.

See [the complete Create Club guide](../docs/create-club.md). Git for Windows with Git Credential Manager is still required in 0.2; bundling or replacing that dependency is separate packaging work.

## Edit and publish

Open the Git root of a club repository containing `site/data/club.yaml`, `site/data/teams.yaml`, `site/data/competitions.yaml`, and `site/content/news/`. The repository may still be local; a remote is not required for editing. Under **Club & theme**, edit branding, URLs, colors, and theme. Save locally and build `site/` to preview the rendered website. Changing the theme does not copy or replace data.

Drafts stay local. Studio writes files atomically and keeps backups. **Publish** validates references and shows the diff before pushing. Publishing requires a `main` branch, a clean staging area, an aligned `origin` that exactly matches the configured `repository_url`, and typed confirmation. Git Credential Manager handles credentials; Studio does not save a token. Check GitHub Actions after pushing because deployment can still fail.

One Studio installation can open multiple clubs in succession; drafts and backups remain separate by project. Studio blocks remote conflicts and external file changes so you can resolve them manually.

The statistics editor still has basketball-oriented fields. The website's sport profiles are in `../shared/profiles/`. A fully profile-driven editor and the social graphics generator are not part of this version.
