# WebMAKER Studio 0.2.0

## Highlights

- Create a clean WebMAKER club directly from Studio without cloning the WebMAKER source repository.
- Choose basketball or football, Bold, Classic, or Dynamic, and the first season during setup.
- Optionally connect through Git Credential Manager, create a public GitHub repository, push `main`, and enable GitHub Pages.
- Clone and validate an existing WebMAKER GitHub repository from the same home screen.
- Keep the existing **Open existing project** workflow for repositories already cloned locally.
- Bundle the site generator, shared schemas, sport profiles, Pages workflow, LICENSE, and NOTICE in the Windows app.
- Upgrade the ZIP dependency to the audited 9.x line.

## Safety boundaries

- Existing destination folders are never overwritten.
- GitHub credentials remain in Git Credential Manager and are not exposed to the web interface or project files.
- GitHub publishing creates public repositories only; Pages availability and organization policies are controlled by GitHub.
- Local creation remains usable when the optional remote step fails, with an explicit warning.
- The installer remains unsigned and Git for Windows is still a prerequisite.

## Verification

- TypeScript content tests and production UI build.
- Native tests for clean creation, validation, Git initialization, URL rules, and overwrite protection.
- Generated-club `npm test` and static build using blank roster, game, and statistics archives.
- Windows NSIS and MSI bundle builds with the embedded starter.

## Windows downloads

- `WebMAKER.Studio_0.2.0_x64-setup.exe`: NSIS installer for Windows x64.
- `WebMAKER.Studio_0.2.0_x64_en-US.msi`: alternative MSI installer for Windows x64.

SHA-256: EXE `243D6646BB9E020E4F544F98D434EBB1569F36B8F3AD987B09714A3B95B210E5`; MSI `EBB017CFEBBABDF7F8BBC2371BFC3DA69DAF4FFD655DDFB9B189E2CA7AFA430A`.

The installers are unsigned. Install Git for Windows with Git Credential Manager to create, clone, synchronize, and publish GitHub projects from Studio.
