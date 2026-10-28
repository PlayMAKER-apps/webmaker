# Create a club with WebMAKER Studio

Studio 0.2 provides three safe starting routes from its home screen.

## Create a new club

1. Install Git for Windows with Git Credential Manager, then open WebMAKER Studio.
2. Select **Create a new club**.
3. Enter the club name, short name, basketball or football profile, one of the three themes, the first season in `YYYY-YY` format, and a lowercase folder name.
4. Choose an existing parent folder. Studio never overwrites the destination.
5. Optionally select **Create and publish a GitHub repository**. Connect through the browser window opened by Git Credential Manager, then choose your user or an organization where you may create repositories.
6. Select **Create club**.

Studio copies the generator, shared schemas and sport profiles, Pages workflow, Apache-2.0 license, and NOTICE from its bundled starter. It replaces the fictional demo identity with the new club, creates empty roster, game, and statistic archives, adds a generic welcome article, initializes `main`, and creates a baseline commit.

If GitHub publishing is selected, Studio creates a public repository, adds a credential-safe HTTPS remote, pushes `main`, and enables Pages with the included Actions workflow. For `owner/club-site`, the default URL is `https://owner.github.io/club-site/`; a repository named `owner.github.io` uses the root URL. GitHub organization policies may still require an owner to approve repository creation or Pages.

## Clone from GitHub

Select **Clone from GitHub**, enter an HTTPS GitHub repository URL, choose the local destination, and select **Clone and open**. Studio rejects non-GitHub URLs, existing destinations, and repositories that do not contain the required WebMAKER structure. Authentication for private repositories is handled by Git Credential Manager.

## Open an existing project

Select **Open existing project** and choose the Git root containing `.git`, `site/data/club.yaml`, and the WebMAKER generator. Studio validates that the selected folder is the repository root before editing anything.

## Failure and recovery

Local creation completes before the optional remote step. If GitHub rejects repository creation or Pages configuration, Studio keeps the valid local project and reports the unfinished step. It never deletes an existing folder or stores a personal access token in the project. A repository push can succeed while Pages deployment is still running; verify the Actions workflow and the live URL afterward.

The current 0.2 implementation requires Git for Windows and Git Credential Manager. A future installer may bundle an audited Git runtime, but that distribution and licensing work is not part of this change.
