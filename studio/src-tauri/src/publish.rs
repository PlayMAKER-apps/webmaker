use crate::{project::{changed_files, editable, git, info, configured_remote, club_urls, relative_path, root, ProjectState}, validation::validate};
use serde::Serialize;
use std::path::Path;

fn publishable(path: &str) -> bool {
    editable(path) || (path.starts_with("site/public/assets/") && ["png", "jpg", "jpeg", "webp", "gif"].iter().any(|ext| path.ends_with(&format!(".{ext}"))))
}

fn normalize_selected(root: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    let changed = changed_files(root)?;
    let mut selected = Vec::new();
    for path in paths {
        let normalized = path.replace('\\', "/");
        if !publishable(&normalized) { return Err(format!("File cannot be published: {normalized}")); }
        relative_path(root, &normalized)?;
        if !changed.contains(&normalized) { return Err(format!("File has no local changes: {normalized}")); }
        if !selected.contains(&normalized) { selected.push(normalized); }
    }
    if selected.is_empty() { return Err("Select at least one changed data or media file.".into()); }
    Ok(selected)
}

fn upstream_counts(root: &Path) -> Result<(u32, u32), String> {
    let raw = git(root, &["rev-list", "--left-right", "--count", "HEAD...origin/main"])?;
    let parts: Vec<_> = raw.split_whitespace().collect();
    if parts.len() != 2 { return Err("Cannot compare main with origin/main.".into()); }
    Ok((parts[0].parse().map_err(|_| "Invalid commit count.")?, parts[1].parse().map_err(|_| "Invalid commit count.")?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationPreview {
    pub branch: String,
    pub remote: String,
    pub files: Vec<String>,
    pub diff: String,
    pub errors: Vec<String>,
    pub can_publish: bool,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
}

#[tauri::command]
pub fn preview_publication(paths: Vec<String>, state: tauri::State<'_, ProjectState>) -> Result<PublicationPreview, String> {
    let root = root(&state)?;
    preview_for_root(&root, paths)
}

fn preview_for_root(root: &Path, paths: Vec<String>) -> Result<PublicationPreview, String> {
    let files = normalize_selected(root, &paths)?;
    let project = info(root)?;
    let mut errors = validate(root).errors;
    if project.branch != "main" { errors.push("Publishing blocked: use an authorized clone on the main branch. You can preview changes on this branch.".into()); }
    if !configured_remote(root, &project.remote) { errors.push("Origin does not match the club's repository_url.".into()); }
    let counts = upstream_counts(root).ok();
    if let Some((ahead, behind)) = counts {
        if ahead != 0 || behind != 0 { errors.push(format!("HEAD differs from origin/main: {ahead} commits ahead, {behind} behind. Resolve this manually.")); }
    } else { errors.push("Cannot verify origin/main. Sync before publishing.".into()); }
    let staged = git(root, &["diff", "--cached", "--name-only"])?;
    if !staged.trim().is_empty() { errors.push("Files are already staged. Clear the staging area before publishing.".into()); }
    let mut args = vec!["diff", "--no-ext-diff", "--"];
    args.extend(files.iter().map(String::as_str));
    let diff = git(root, &args)?;
    Ok(PublicationPreview { branch: project.branch, remote: project.remote, files, diff, can_publish: errors.is_empty(), errors, ahead: counts.map(|c| c.0), behind: counts.map(|c| c.1) })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationResult { pub commit: String, pub commit_url: String, pub actions_url: String, pub site_url: String, pub deploy_status: String }

#[tauri::command]
pub fn publish(paths: Vec<String>, message: String, confirmation: String, state: tauri::State<'_, ProjectState>) -> Result<PublicationResult, String> {
    if confirmation != "PUBLISH TO MAIN" { return Err("Confirmation missing: type PUBLISH TO MAIN.".into()); }
    let root = root(&state)?;
    let files = normalize_selected(&root, &paths)?;
    let project = info(&root)?;
    if project.branch != "main" || !configured_remote(&root, &project.remote) { return Err("Publishing is allowed only from the configured club repository's main branch.".into()); }
    let report = validate(&root);
    if !report.errors.is_empty() { return Err(format!("Validation failed:\n{}", report.errors.join("\n"))); }
    if !git(&root, &["diff", "--cached", "--name-only"])?.is_empty() { return Err("Staging area is occupied. Complete or clear those changes before publishing.".into()); }
    git(&root, &["fetch", "origin", "main"])?;
    let (ahead, behind) = upstream_counts(&root)?;
    if ahead != 0 || behind != 0 { return Err(format!("Publishing blocked: {ahead} commits ahead and {behind} behind origin/main. Resolve this manually.")); }
    let subject = message.trim();
    if subject.len() < 5 || subject.len() > 120 || subject.contains('\n') { return Err("Enter a single-line commit message of 5–120 characters.".into()); }
    let mut add = vec!["add", "--"];
    add.extend(files.iter().map(String::as_str));
    git(&root, &add)?;
    let staged = git(&root, &["diff", "--cached", "--name-only"])?;
    let staged_paths: Vec<_> = staged.lines().map(str::trim).filter(|line| !line.is_empty()).collect();
    if staged_paths.is_empty() || staged_paths.iter().any(|path| !files.iter().any(|selected| selected == path)) {
        return Err("Unexpected staged files. Check the Git diff before trying again.".into());
    }
    git(&root, &["commit", "-m", subject])?;
    let commit = git(&root, &["rev-parse", "HEAD"])?;
    git(&root, &["push", "origin", "main"]).map_err(|error| format!("Created local commit {commit}, but the push failed: {error}"))?;
    let (repo_url, site_url) = club_urls(&root)?;
    Ok(PublicationResult {
        commit_url: format!("{repo_url}/commit/{commit}"),
        actions_url: format!("{repo_url}/actions"),
        site_url,
        deploy_status: "Push succeeded; verify the GitHub Pages deployment in Actions.".into(), commit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};
    use uuid::Uuid;
    #[test]
    fn stages_only_content_and_images() {
        assert!(publishable("site/data/games/2026-27/platinum.csv"));
        assert!(publishable("site/public/assets/new-photo.webp"));
        assert!(!publishable("site/app/page.tsx"));
        assert!(!publishable("studio/src/App.tsx"));
    }
    #[test]
    fn development_branch_can_preview_game_diff_but_cannot_push() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/test-fixtures");
        fs::create_dir_all(&fixtures).unwrap();
        let temp = fixtures.join(format!("webmaker-test-{}", Uuid::new_v4()));
        let folders = ["site/data/games/2026-27", "site/data/player-stats/2026-27", "site/data/players", "site/content/news", "site/scripts"];
        for folder in folders { fs::create_dir_all(temp.join(folder)).unwrap(); }
        let fixture: [(&str, &str); 8] = [
            ("site/data/club.yaml", "repository_url: https://github.com/aurora-sport/club-site.git\n"),
            ("site/data/competitions.yaml", "current_season: 2026-27\nseasons:\n  - id: 2026-27\n    competitions:\n      - id: platinum\n        name: Platinum\n        teams: [aurora]\n"),
            ("site/data/teams.yaml", "aurora:\n  name: Aurora\nrivals:\n  name: Rivals\n"),
            ("site/data/players/player.yaml", "id: player\nname: Player\n"),
            ("site/data/rosters.csv", "season,competition,team_id,player_id,number\n2026-27,platinum,aurora,player,5\n"),
            ("site/data/games/2026-27/platinum.csv", "id,date,time,status,home_team,away_team,home_score,away_score\ngame-1,2026-10-21,21:00,final,aurora,rivals,51,48\n"),
            ("site/data/player-stats/2026-27/platinum.csv", "game_id,player_id,minutes,points\n"),
            ("site/content/news/sample.md", "---\ntitle: Sample\ndate: 2026-10-21\n---\nText\n"),
        ];
        for (path, content) in fixture { fs::write(temp.join(path), content).unwrap(); }
        fs::write(temp.join("site/scripts/build-data.mjs"), "// fixture").unwrap();
        let root = temp.canonicalize().unwrap();
        git(&root, &["init", "-b", "main"]).unwrap();
        git(&root, &["config", "user.name", "Studio Test"]).unwrap();
        git(&root, &["config", "user.email", "studio@example.test"]).unwrap();
        git(&root, &["remote", "add", "origin", "https://github.com/aurora-sport/club-site.git"]).unwrap();
        git(&root, &["add", "--", "site"]).unwrap();
        git(&root, &["commit", "-m", "Fixture"]).unwrap();
        let head = git(&root, &["rev-parse", "HEAD"]).unwrap();
        git(&root, &["update-ref", "refs/remotes/origin/main", &head]).unwrap();
        fs::write(root.join("site/data/games/2026-27/platinum.csv"), "id,date,time,status,home_team,away_team,home_score,away_score\ngame-1,2026-10-21,21:00,final,aurora,rivals,52,48\n").unwrap();
        fs::write(root.join("site/data/rosters.csv"), "season,competition,team_id,player_id,number\n2026-27,platinum,aurora,player,7\n").unwrap();
        fs::write(root.join("site/content/news/sample.md"), "---\ntitle: Updated sample\ndate: 2026-10-21\n---\nNew text\n").unwrap();
        let report = validate(&root);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(report.games, 1);
        assert_eq!(report.news, 1);
        let selection = vec!["site/data/games/2026-27/platinum.csv".into(), "site/data/rosters.csv".into(), "site/content/news/sample.md".into()];
        let clean_preview = preview_for_root(&root, selection.clone()).unwrap();
        assert!(clean_preview.can_publish, "{:?}", clean_preview.errors);
        assert_eq!(clean_preview.files.len(), 3);
        assert_eq!(git(&root, &["rev-parse", "HEAD"]).unwrap(), head);
        assert!(git(&root, &["diff", "--cached", "--name-only"]).unwrap().is_empty());

        git(&root, &["remote", "set-url", "origin", "https://github.com/other/club.git"]).unwrap();
        let mismatched = preview_for_root(&root, selection.clone()).unwrap();
        assert!(!mismatched.can_publish);
        assert!(mismatched.errors.iter().any(|message| message.contains("Origin does not match")));
        git(&root, &["remote", "set-url", "origin", "https://github.com/aurora-sport/club-site.git"]).unwrap();

        git(&root, &["add", "--", "site/data/rosters.csv"]).unwrap();
        git(&root, &["commit", "-m", "Local roster change"]).unwrap();
        let ahead = preview_for_root(&root, vec!["site/data/games/2026-27/platinum.csv".into()]).unwrap();
        assert!(!ahead.can_publish);
        assert!(ahead.errors.iter().any(|message| message.contains("commits ahead")));
        git(&root, &["switch", "-c", "feat/test-studio"]).unwrap();
        let preview = preview_for_root(&root, vec!["site/data/games/2026-27/platinum.csv".into()]).unwrap();
        assert!(!preview.can_publish);
        assert!(preview.errors.iter().any(|message| message.contains("branch")));
        assert!(preview.diff.contains("+game-1,2026-10-21,21:00,final,aurora,rivals,52,48"));
        let temp_root = fixtures.canonicalize().unwrap();
        let target: PathBuf = root.canonicalize().unwrap();
        assert!(target.starts_with(temp_root));
        // A sandbox may protect newly created .git directories from test cleanup.
        let _ = fs::remove_dir_all(target);
    }
}
