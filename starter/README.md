# Club starter

The `site/` demonstration contains only fictional clubs, players, and games. Create a new instance without the Nerone Git history:

```bash
node scripts/init-club.mjs ../my-club
```

The initializer copies `site/`, `shared/`, and the GitHub Pages workflow into a new folder. It does not copy Studio: one desktop installation can open multiple club repositories. This version places a copy of the generator in every club instance. Later fixes do not arrive automatically; compare versions and bring changes in through a reviewed pull request.

Before publishing, replace all demonstration data and configure the URL, repository, images, and contact details in `site/data/club.yaml`. Keep team, player, and game IDs stable after the first publication.
