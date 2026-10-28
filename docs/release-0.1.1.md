# WebMAKER 0.1.1

This update makes the WebMAKER guide, diagrams, fictional club website, and Studio interface available in English. It follows the first public release and preserves the shared 0.1 data schema.

## Changes

- Translated the repository user guide and three illustrated tutorial diagrams.
- Translated the Studio interface, validation messages, and sample club content.
- Changed the sample website's public routes to English. Older Italian routes redirect to their English equivalents.
- Aligned the publishing confirmation between Studio and its backend.
- Set the sample website and Studio HTML language to English.

## Windows downloads

- `WebMAKER.Studio_0.1.1_x64-setup.exe`: NSIS installer for Windows x64.
- `WebMAKER.Studio_0.1.1_x64_en-US.msi`: alternative MSI installer for Windows x64.

SHA-256: EXE `C9623B2B9A5B7F170A4F815E73F2252B4CA3A4211909FF55EAAC1CD4D15C3F7F`; MSI `9EF75E2D24B46E37E18AA83BD96E1B462F630300528EB7430EC566978561B28E`.

The installers are unsigned. Install Git for Windows with Git Credential Manager to publish from Studio. For setup and GitHub Pages instructions, see the [illustrated user guide](https://github.com/PlayMAKER-apps/webmaker#user-guide).

## Known limitations

- Studio's statistics editor still uses basketball-oriented fields while the public website uses sport profiles.
- The Nerone pilot's social graphics generator is not included.
- Studio previews data; run `npm run dev` in `site/` to inspect rendered pages.
- Each club instance contains a copy of the generator. Product updates require a reviewed change, not an automatic sync.

The code is Apache-2.0 with attribution in `NOTICE`. Nerone club images and data are not included.
