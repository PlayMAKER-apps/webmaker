# WebMAKER Studio

WebMAKER Studio is a Tauri 2 + React/TypeScript desktop app developed from the Nerone Basket pilot, whose code was written by the PlayMAKER author. It opens one WebMAKER club project at a time, edits CSV/YAML/Markdown files, keeps local drafts and backups, validates content, and prepares a guarded Git push. It does not need a web backend. The code is Apache-2.0 with attribution in the repository NOTICE.

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

## Use

Open the Git root of a club repository containing `site/data/club.yaml`, `site/data/teams.yaml`, `site/data/competitions.yaml`, and `site/content/news/`. The repository may still be local; a remote is not required for editing. Under **Club & theme**, edit branding, URLs, colors, and theme. Save locally and build `site/` to preview the rendered website. Changing the theme does not copy or replace data.

Drafts stay local. Studio writes files atomically and keeps backups. **Publish** validates references and shows the diff before pushing. Publishing requires a `main` branch, a clean staging area, an aligned `origin` that exactly matches the configured `repository_url`, and typed confirmation. Git Credential Manager handles credentials; Studio does not save a token. Check GitHub Actions after pushing because deployment can still fail.

One Studio installation can open multiple clubs in succession; drafts and backups remain separate by project. Studio blocks remote conflicts and external file changes so you can resolve them manually.

The statistics editor still has basketball-oriented fields. The website's sport profiles are in `../shared/profiles/`. A fully profile-driven editor and the social graphics generator are not part of this version.
