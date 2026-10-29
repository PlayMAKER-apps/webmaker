use crate::storage::draft_paths;
use serde::Serialize;
use std::{fs::{self, OpenOptions}, path::{Component, Path, PathBuf}, process::Command, sync::Mutex};
use uuid::Uuid;

pub fn normalized_github_remote(remote: &str) -> Option<String> {
    let value = remote.trim().trim_end_matches('/').trim_end_matches(".git");
    let path = value.strip_prefix("https://github.com/")
        .or_else(|| value.strip_prefix("git@github.com:"))
        .or_else(|| value.strip_prefix("ssh://git@github.com/"))?;
    let mut parts = path.split('/');
    let owner = parts.next()?; let repo = parts.next()?;
    if parts.next().is_some() || owner.is_empty() || repo.is_empty()
        || !owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        || !repo.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') { return None; }
    Some(format!("https://github.com/{owner}/{repo}").to_ascii_lowercase())
}

pub fn configured_remote(root: &Path, remote: &str) -> bool {
    let Ok(source) = fs::read_to_string(root.join("site/data/club.yaml")) else { return false; };
    let Ok(club) = serde_yaml::from_str::<serde_yaml::Value>(&source) else { return false; };
    let Some(expected) = club.get("repository_url").and_then(serde_yaml::Value::as_str) else { return false; };
    match (normalized_github_remote(expected), normalized_github_remote(remote)) { (Some(a), Some(b)) => a == b, _ => false }
}

pub fn club_urls(root: &Path) -> Result<(String, String), String> {
    let club: serde_yaml::Value = serde_yaml::from_str(&fs::read_to_string(root.join("site/data/club.yaml")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let repo = club.get("repository_url").and_then(serde_yaml::Value::as_str).and_then(normalized_github_remote).ok_or("Set repository_url in site/data/club.yaml")?;
    let site = club.get("site_url").and_then(serde_yaml::Value::as_str).filter(|s| s.starts_with("https://")).ok_or("Set an HTTPS site_url in site/data/club.yaml")?;
    Ok((repo, site.to_string()))
}

#[derive(Default)]
pub struct ProjectState(pub Mutex<Option<PathBuf>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub root: String,
    pub branch: String,
    pub remote: String,
    pub changed_files: Vec<String>,
    pub last_sync: Option<String>,
}

pub fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    Ok(String::from_utf8_lossy(&git_bytes(root, args)?).trim().to_string())
}

fn git_bytes(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("git").args(args).current_dir(root).output()
        .map_err(|error| format!("Git is unavailable: {error}. Install Git for Windows."))?;
    if !output.status.success() {
        return Err(format!("Git {}: {}", args.first().unwrap_or(&""), String::from_utf8_lossy(&output.stderr).trim()));
    }
    Ok(output.stdout)
}

pub fn validate_root(path: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(path).map_err(|_| "Folder is inaccessible.".to_string())?;
    if !root.join(".git").exists() || !root.join("site/data/competitions.yaml").is_file()
        || !root.join("site/scripts/build-data.mjs").is_file()
        || !root.join("site/content/news").is_dir() || !root.join("site/data/club.yaml").is_file() {
        return Err("Choose the Git root of a WebMAKER project containing site/data/club.yaml.".into());
    }
    let top = git(&root, &["rev-parse", "--show-toplevel"])?;
    if fs::canonicalize(top).map_err(|_| "Invalid repository.".to_string())? != root {
        return Err("The selected folder is not the project's Git root.".into());
    }
    let probe = root.join("site/data").join(format!(".webmaker-{}", Uuid::new_v4()));
    OpenOptions::new().write(true).create_new(true).open(&probe)
        .map_err(|error| format!("The data folder is not writable: {error}"))?;
    fs::remove_file(&probe).map_err(|error| format!("Could not remove the write test file: {error}"))?;
    Ok(root)
}

pub fn root(state: &ProjectState) -> Result<PathBuf, String> {
    state.0.lock().map_err(|_| "Project state is unavailable.".to_string())?
        .clone().ok_or_else(|| "Open a WebMAKER project first.".to_string())
}

pub fn relative_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let normalized = relative.replace('\\', "/");
    let path = Path::new(&normalized);
    if path.is_absolute() || path.components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err("Invalid path.".into());
    }
    let allowed = normalized.starts_with("site/data/") || normalized.starts_with("site/content/news/")
        || normalized.starts_with("site/public/assets/");
    if !allowed || normalized.contains(':') { return Err("Path is outside the allowed data folders.".into()); }
    let target = root.join(path);
    let mut ancestor = target.as_path();
    while !ancestor.exists() { ancestor = ancestor.parent().ok_or("Invalid path.")?; }
    let canonical = fs::canonicalize(ancestor).map_err(|_| "Path is inaccessible.".to_string())?;
    if !canonical.starts_with(root) { return Err("Symbolic path points outside the project.".into()); }
    Ok(target)
}

pub fn editable(relative: &str) -> bool {
    (relative.starts_with("site/data/") && ["csv", "yaml", "yml", "json"].iter().any(|ext| relative.ends_with(&format!(".{ext}"))))
        || (relative.starts_with("site/content/news/") && relative.ends_with(".md"))
}

pub fn changed_files(root: &Path) -> Result<Vec<String>, String> {
    let bytes = git_bytes(root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    let output = String::from_utf8_lossy(&bytes);
    let mut changed = Vec::new();
    let mut parts = output.split('\0').filter(|part| !part.is_empty());
    while let Some(entry) = parts.next() {
        if entry.len() < 4 { continue; }
        changed.push(entry[3..].replace('\\', "/"));
        if entry.starts_with('R') || entry.starts_with('C') || entry.chars().nth(1) == Some('R') || entry.chars().nth(1) == Some('C') {
            if let Some(old) = parts.next() { changed.push(old.replace('\\', "/")); }
        }
    }
    changed.sort(); changed.dedup();
    Ok(changed)
}

pub fn info(root: &Path) -> Result<ProjectInfo, String> {
    let remote = git(root, &["remote", "get-url", "origin"]).unwrap_or_default();
    let branch = git(root, &["branch", "--show-current"])?;
    let git_path = git(root, &["rev-parse", "--git-path", "FETCH_HEAD"]).unwrap_or_default();
    let fetch_head = if Path::new(&git_path).is_absolute() { PathBuf::from(git_path) } else { root.join(git_path) };
    let last_sync = fs::metadata(fetch_head).ok().and_then(|meta| meta.modified().ok()).and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|time| time.as_secs().to_string());
    Ok(ProjectInfo { root: root.display().to_string(), branch, remote, changed_files: changed_files(root)?, last_sync })
}

#[tauri::command]
pub fn open_project(path: String, state: tauri::State<'_, ProjectState>) -> Result<ProjectInfo, String> {
    let root = validate_root(&path)?;
    let info = info(&root)?;
    *state.0.lock().map_err(|_| "Project state is unavailable.".to_string())? = Some(root);
    Ok(info)
}

#[tauri::command]
pub fn project_info(state: tauri::State<'_, ProjectState>) -> Result<ProjectInfo, String> { info(&root(&state)?) }

#[tauri::command]
pub fn sync_project(state: tauri::State<'_, ProjectState>) -> Result<ProjectInfo, String> {
    let root = root(&state)?;
    if !configured_remote(&root, &git(&root, &["remote", "get-url", "origin"])?) { return Err("Origin does not match the club's repository_url.".into()); }
    git(&root, &["fetch", "origin", "main"])?;
    info(&root)
}

#[tauri::command]
pub fn list_files(kind: String, state: tauri::State<'_, ProjectState>) -> Result<Vec<String>, String> {
    let root = root(&state)?;
    let prefix = match kind.as_str() {
        "games" => "site/data/games", "stats" => "site/data/player-stats", "players" => "site/data/players",
        "news" => "site/content/news", "teams" => "site/data", _ => return Err("Unsupported list type.".into()),
    };
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root.join(prefix)).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() { continue; }
        let relative = entry.path().strip_prefix(&root).map_err(|_| "Invalid path.")?.to_string_lossy().replace('\\', "/");
        if relative.rsplit('/').next().unwrap_or("").starts_with('_') || !editable(&relative) { continue; }
        if kind == "teams" && relative != "site/data/teams.yaml" && relative != "site/data/rosters.csv" { continue; }
        files.push(relative);
    }
    if kind != "teams" {
        files.extend(draft_paths(&root)?.into_iter().filter(|path| path.starts_with(&format!("{prefix}/"))));
    }
    if kind == "games" || kind == "stats" { files.extend(configured_archive_paths(&root, &kind)?); }
    files.sort(); files.dedup();
    Ok(files)
}

fn configured_archive_paths(root: &Path, kind: &str) -> Result<Vec<String>, String> {
    let source = fs::read_to_string(root.join("site/data/competitions.yaml")).map_err(|error| error.to_string())?;
    let config: serde_yaml::Value = serde_yaml::from_str(&source).map_err(|error| format!("Invalid competitions YAML: {error}"))?;
    let folder = if kind == "games" { "games" } else { "player-stats" };
    let mut paths = Vec::new();
    for season in config.get("seasons").and_then(serde_yaml::Value::as_sequence).into_iter().flatten() {
        let Some(season_id) = season.get("id").and_then(serde_yaml::Value::as_str) else { continue; };
        for competition in season.get("competitions").and_then(serde_yaml::Value::as_sequence).into_iter().flatten() {
            let Some(competition_id) = competition.get("id").and_then(serde_yaml::Value::as_str) else { continue; };
            let path = format!("site/data/{folder}/{season_id}/{competition_id}.csv");
            relative_path(root, &path)?;
            paths.push(path);
        }
    }
    Ok(paths)
}

#[derive(Serialize)]
pub struct Catalog { pub teams: Vec<String>, pub players: Vec<String>, pub games: Vec<String> }

#[tauri::command]
pub fn catalog(state: tauri::State<'_, ProjectState>) -> Result<Catalog, String> {
    let root = root(&state)?;
    catalog_for_root(&root)
}

fn catalog_for_root(root: &Path) -> Result<Catalog, String> {
    let yaml = fs::read_to_string(root.join("site/data/teams.yaml")).map_err(|error| error.to_string())?;
    let teams_value: serde_yaml::Value = serde_yaml::from_str(&yaml).map_err(|error| format!("Invalid teams YAML: {error}"))?;
    let teams = teams_value.as_mapping().ok_or("Invalid teams YAML.")?.keys().filter_map(serde_yaml::Value::as_str).map(str::to_string).collect();
    let mut players = Vec::new();
    for entry in walkdir::WalkDir::new(root.join("site/data/players")).max_depth(1).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() || entry.file_name().to_string_lossy().starts_with('_') { continue; }
        let text = fs::read_to_string(entry.path()).map_err(|error| error.to_string())?;
        let value: serde_yaml::Value = serde_yaml::from_str(&text).map_err(|error| format!("{}: {error}", entry.path().display()))?;
        if let Some(id) = value.get("id").and_then(serde_yaml::Value::as_str) { players.push(id.to_string()); }
    }
    players.sort();
    let mut games = Vec::new();
    for entry in walkdir::WalkDir::new(root.join("site/data/games")).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() || entry.path().extension().and_then(|ext| ext.to_str()) != Some("csv") { continue; }
        // Older season files omit trailing empty cells; match the site's CSV reader.
        let mut reader = csv::ReaderBuilder::new().flexible(true).from_path(entry.path()).map_err(|error| error.to_string())?;
        let headers = reader.headers().map_err(|error| error.to_string())?.clone();
        let id_col = headers.iter().position(|header| header == "id").ok_or("Games CSV is missing the id column.")?;
        for row in reader.records() {
            let row = row.map_err(|error| error.to_string())?;
            if row.len() > headers.len() { return Err(format!("Games CSV has extra columns: {}", entry.path().display())); }
            games.push(row.get(id_col).unwrap_or("").to_string());
        }
    }
    games.sort();
    Ok(Catalog { teams, players, games })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_configured_remote() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
        assert!(!configured_remote(&root, "https://github.com/another/site.git"));
        assert_eq!(normalized_github_remote("git@github.com:example/site.git"), Some("https://github.com/example/site".into()));
        assert!(normalized_github_remote("https://evil.example/a/b").is_none());
    }
    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        assert!(relative_path(&root, "site/data/../../secrets.csv").is_err());
        assert!(relative_path(&root, "C:/secrets.csv").is_err());
        assert!(relative_path(&root, "site/data/games/2026-27/platinum.csv").is_ok());
    }
    #[test]
    fn demo_catalog_opens_with_games() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
        let catalog = catalog_for_root(&root).unwrap();
        assert!(!catalog.teams.is_empty());
        assert!(!catalog.players.is_empty());
        assert!(!catalog.games.is_empty());
    }
    #[test]
    fn configured_competition_archives_are_available_even_before_csv_exists() {
        let temp = std::env::temp_dir().join(format!("webmaker-archives-{}", Uuid::new_v4()));
        fs::create_dir_all(temp.join("site/data")).unwrap();
        let root = temp.canonicalize().unwrap();
        fs::write(root.join("site/data/competitions.yaml"), "seasons:\n  - id: 2027-28\n    competitions:\n      - id: silver\n        name: Silver\n").unwrap();
        assert_eq!(configured_archive_paths(&root, "games").unwrap(), vec!["site/data/games/2027-28/silver.csv"]);
        assert_eq!(configured_archive_paths(&root, "stats").unwrap(), vec!["site/data/player-stats/2027-28/silver.csv"]);
        assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(root).unwrap();
    }
}
