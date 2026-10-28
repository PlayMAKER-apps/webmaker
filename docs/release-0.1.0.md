# WebMAKER 0.1.0

The first public WebMAKER release combines a reusable static sports-club website with WebMAKER Studio for Windows.

## Included

- Three site themes, Bold, Classic, and Dynamic, with shared data, URLs, and SEO metadata.
- A fictional club starter, basketball and football profiles, `node scripts/init-club.mjs ../my-club`, and a GitHub Pages workflow for each club.
- Studio editing for content and theme, local save, validation, diff review, and guarded Git publishing.
- Versioned 0.1 configuration schema and roster paths compatible with PlayMAKER/TagMAKER data exchange.
- An [illustrated user and contributor guide](https://github.com/PlayMAKER-apps/webmaker#user-guide).

## Windows downloads

- `WebMAKER.Studio_0.1.0_x64-setup.exe`: NSIS installer for Windows x64.
- `WebMAKER.Studio_0.1.0_x64_en-US.msi`: alternative MSI installer for Windows x64.

The installers are unsigned. Install Git for Windows with Git Credential Manager to publish from Studio. Studio works with a local club repository; the public website serves only static HTML/CSS.

## Known limitations

- Studio's statistics editor still uses basketball-oriented fields while the public website uses sport profiles.
- The Nerone pilot's social graphics generator is not included.
- Studio previews data; run `npm run dev` in `site/` to inspect rendered pages.
- Each club instance contains a copy of the generator. Product updates require a reviewed change, not an automatic sync.

The code is Apache-2.0 with attribution in `NOTICE`. Nerone club images and data are not included.
