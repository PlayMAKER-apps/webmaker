use crate::project::{git, info, validate_root, ProjectInfo, ProjectState};
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_yaml::{Mapping, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tauri::{path::BaseDirectory, Manager};

const GAME_HEADERS: &str = "id,date,time,status,home_team,away_team,home_score,away_score,venue,address,instagram_url,youtube_url,notes,phase,round\n";
const STAT_HEADERS: &str = "game_id,player_id,minutes,points,three_pointers_made,two_pointers_made,free_throws_made,fouls,rebounds_off,rebounds_def,assists,turnovers\n";
const ROSTER_HEADERS: &str = "season,competition,team_id,player_id,number,role,active\n";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateClubRequest {
    pub parent: String,
    pub folder_name: String,
    pub club_name: String,
    pub short_name: String,
    pub sport: String,
    pub theme: String,
    pub season: String,
    pub github: Option<GithubTarget>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubTarget {
    pub account: String,
    pub owner: String,
    pub repository: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneClubRequest {
    pub parent: String,
    pub remote_url: String,
    pub folder_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubAccount {
    pub login: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateClubResult {
    pub project: ProjectInfo,
    pub repository_url: String,
    pub site_url: String,
    pub pages_configured: bool,
    pub warnings: Vec<String>,
}

#[derive(Deserialize)]
struct GithubUser {
    login: String,
    name: Option<String>,
}

#[derive(Deserialize)]
struct GithubRepository {
    clone_url: String,
    html_url: String,
    owner: GithubOwner,
}

#[derive(Deserialize)]
struct GithubOwner {
    login: String,
}

fn valid_slug(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value.chars().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

fn validate_request(request: &CreateClubRequest) -> Result<(), String> {
    if request.club_name.trim().is_empty() || request.club_name.chars().count() > 100 {
        return Err("Enter a club name of up to 100 characters.".into());
    }
    if request.short_name.trim().is_empty() || request.short_name.chars().count() > 30 {
        return Err("Enter a short club name of up to 30 characters.".into());
    }
    if !valid_slug(&request.folder_name) { return Err("Folder name must contain lowercase letters, numbers, and hyphens only.".into()); }
    if !["basketball", "football"].contains(&request.sport.as_str()) { return Err("Choose a supported sport.".into()); }
    if !["bold", "classic", "dynamic"].contains(&request.theme.as_str()) { return Err("Choose a supported theme.".into()); }
    let bytes = request.season.as_bytes();
    if bytes.len() != 7 || bytes[4] != b'-' || !bytes.iter().enumerate().all(|(index, byte)| index == 4 || byte.is_ascii_digit()) {
        return Err("Season must use the YYYY-YY format.".into());
    }
    if let Some(target) = &request.github {
        if !valid_owner(&target.owner) || !valid_repo(&target.repository) || target.account.trim().is_empty() {
            return Err("GitHub owner, repository, or connected account is invalid.".into());
        }
    }
    Ok(())
}

fn valid_owner(value: &str) -> bool {
    !value.is_empty() && value.len() <= 39 && !value.starts_with('-') && !value.ends_with('-')
        && value.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}

fn valid_repo(value: &str) -> bool {
    !value.is_empty() && value.len() <= 100 && !value.starts_with('.')
        && value.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn github_urls(owner: &str, repository: &str) -> (String, String, String) {
    let repository_url = format!("https://github.com/{owner}/{repository}");
    if repository.eq_ignore_ascii_case(&format!("{owner}.github.io")) {
        (repository_url, format!("https://{owner}.github.io/"), String::new())
    } else {
        (repository_url, format!("https://{owner}.github.io/{repository}/"), format!("/{repository}"))
    }
}

fn yaml_set(map: &mut Mapping, key: &str, value: impl Into<Value>) {
    map.insert(Value::String(key.into()), value.into());
}

fn simplify_generated_package(root: &Path) -> Result<(), String> {
    let package_path = root.join("site/package.json");
    let mut package: serde_json::Value = serde_json::from_str(&fs::read_to_string(&package_path).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    if let Some(scripts) = package.get_mut("scripts").and_then(serde_json::Value::as_object_mut) { scripts.remove("test:browser"); }
    if let Some(dependencies) = package.get_mut("devDependencies").and_then(serde_json::Value::as_object_mut) { dependencies.remove("@playwright/test"); }
    fs::write(&package_path, format!("{}\n", serde_json::to_string_pretty(&package).map_err(|error| error.to_string())?)).map_err(|error| error.to_string())?;

    let lock_path = root.join("site/package-lock.json");
    let mut lock: serde_json::Value = serde_json::from_str(&fs::read_to_string(&lock_path).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    if let Some(packages) = lock.get_mut("packages").and_then(serde_json::Value::as_object_mut) {
        if let Some(root_package) = packages.get_mut("").and_then(serde_json::Value::as_object_mut) {
            if let Some(dependencies) = root_package.get_mut("devDependencies").and_then(serde_json::Value::as_object_mut) { dependencies.remove("@playwright/test"); }
        }
        for key in ["node_modules/@playwright/test", "node_modules/playwright", "node_modules/playwright-core"] { packages.remove(key); }
    }
    fs::write(&lock_path, format!("{}\n", serde_json::to_string_pretty(&lock).map_err(|error| error.to_string())?)).map_err(|error| error.to_string())
}

fn clean_generated_content(root: &Path, request: &CreateClubRequest, urls: &(String, String, String)) -> Result<(), String> {
    let club_path = root.join("site/data/club.yaml");
    let source = fs::read_to_string(&club_path).map_err(|error| error.to_string())?;
    let mut club: Value = serde_yaml::from_str(&source).map_err(|error| format!("Invalid starter club.yaml: {error}"))?;
    let map = club.as_mapping_mut().ok_or("Invalid starter club.yaml.")?;
    yaml_set(map, "name", request.club_name.trim());
    yaml_set(map, "short_name", request.short_name.trim());
    yaml_set(map, "tagline", format!("Follow {} through every season", request.short_name.trim()));
    yaml_set(map, "description", format!("News, teams, schedules, and results for {}.", request.club_name.trim()));
    yaml_set(map, "theme", request.theme.clone());
    yaml_set(map, "sport", request.sport.clone());
    yaml_set(map, "repository_url", urls.0.clone());
    yaml_set(map, "site_url", if urls.1.is_empty() { "https://example.github.io/".into() } else { urls.1.clone() });
    yaml_set(map, "base_path", urls.2.clone());
    fs::write(&club_path, serde_yaml::to_string(&club).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;

    let team_id = request.folder_name.clone();
    let mut team = Mapping::new();
    yaml_set(&mut team, "name", request.club_name.trim());
    yaml_set(&mut team, "short_name", request.short_name.trim());
    yaml_set(&mut team, "logo", "");
    yaml_set(&mut team, "logo_on_dark", "");
    let mut teams = Mapping::new();
    teams.insert(Value::String(team_id.clone()), Value::Mapping(team));
    fs::write(root.join("site/data/teams.yaml"), serde_yaml::to_string(&teams).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;

    let competitions = json!({
        "current_season": request.season,
        "seasons": [{
            "id": request.season,
            "competitions": [{
                "id": "league",
                "name": "League",
                "teams": [team_id],
                "standings_points": { "win": 2, "loss": 0 }
            }]
        }]
    });
    fs::write(root.join("site/data/competitions.yaml"), serde_yaml::to_string(&competitions).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;

    for relative in ["site/data/players", "site/data/games", "site/data/player-stats", "site/content/news"] {
        let directory = root.join(relative);
        if directory.exists() { fs::remove_dir_all(&directory).map_err(|error| format!("Could not reset {relative}: {error}"))?; }
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    }
    let games = root.join("site/data/games").join(&request.season);
    let stats = root.join("site/data/player-stats").join(&request.season);
    fs::create_dir_all(&games).map_err(|error| error.to_string())?;
    fs::create_dir_all(&stats).map_err(|error| error.to_string())?;
    fs::write(games.join("league.csv"), GAME_HEADERS).map_err(|error| error.to_string())?;
    fs::write(stats.join("league.csv"), STAT_HEADERS).map_err(|error| error.to_string())?;
    fs::write(root.join("site/data/rosters.csv"), ROSTER_HEADERS).map_err(|error| error.to_string())?;
    let title = serde_json::to_string(&format!("Welcome to {}", request.club_name.trim())).map_err(|error| error.to_string())?;
    let excerpt = serde_json::to_string(&format!("The new home of {} is ready.", request.short_name.trim())).map_err(|error| error.to_string())?;
    let welcome_date = format!("{}-09-01", &request.season[..4]);
    fs::write(root.join("site/content/news/welcome.md"), format!("---\ntitle: {title}\ndate: {welcome_date}\ncover:\nplayers: []\ngames: []\nexcerpt: {excerpt}\n---\n\nWelcome to our official club website.\n")).map_err(|error| error.to_string())?;
    let initializer_test = root.join("site/tests/init-club.test.mjs");
    if initializer_test.exists() { fs::remove_file(initializer_test).map_err(|error| error.to_string())?; }
    let browser_tests = root.join("site/tests/browser");
    if browser_tests.exists() { fs::remove_dir_all(browser_tests).map_err(|error| error.to_string())?; }
    simplify_generated_package(root)?;
    Ok(())
}

fn copy_entry(source: &Path, target: &Path) -> Result<(), String> {
    if source.is_file() {
        if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        fs::copy(source, target).map_err(|error| error.to_string())?;
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(source).min_depth(1).follow_links(false) {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().is_symlink() { return Err("The bundled starter contains an unsupported symbolic link.".into()); }
        let relative = entry.path().strip_prefix(source).map_err(|_| "Invalid starter path.")?;
        if relative.components().any(|part| matches!(part.as_os_str().to_str(), Some("node_modules" | "dist" | ".npm-cache"))) { continue; }
        let destination = target.join(relative);
        if entry.file_type().is_dir() { fs::create_dir_all(&destination).map_err(|error| error.to_string())?; }
        else { if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; } fs::copy(entry.path(), &destination).map_err(|error| error.to_string())?; }
    }
    Ok(())
}

fn copy_template(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_dir() { return Err("The bundled WebMAKER starter is unavailable. Reinstall Studio.".into()); }
    fs::create_dir(target).map_err(|error| format!("Could not create the club folder: {error}"))?;
    for relative in ["site", "shared", ".gitignore", "LICENSE", "NOTICE"] {
        let from = source.join(relative);
        if !from.exists() { return Err(format!("The bundled starter is missing {relative}. Reinstall Studio.")); }
        copy_entry(&from, &target.join(relative))?;
    }
    let workflow = source.join(".github/workflows/deploy.yml");
    if !workflow.is_file() { return Err("The bundled starter is missing its Pages workflow. Reinstall Studio.".into()); }
    copy_entry(&workflow, &target.join(".github/workflows/deploy.yml"))?;
    Ok(())
}

fn write_readme(root: &Path, request: &CreateClubRequest, repository_url: &str) -> Result<(), String> {
    let publish = if repository_url.is_empty() { "Connect this project to GitHub from WebMAKER Studio when you are ready to publish.".to_string() }
        else { format!("Repository: {repository_url}\n\nPushes to `main` publish through the included GitHub Pages workflow.") };
    fs::write(root.join("README.md"), format!("# {}\n\nA sports club website created with [WebMAKER](https://github.com/PlayMAKER-apps/webmaker) by [PlayMAKER](https://github.com/PlayMAKER-apps).\n\nEdit content with WebMAKER Studio or in `site/data/` and `site/content/news/`.\n\n{}\n\n## Local preview\n\n```powershell\ncd site\nnpm ci\nnpm run build\nnpm run dev\n```\n", request.club_name.trim(), publish)).map_err(|error| error.to_string())
}

fn initialize_git(root: &Path, name: &str) -> Result<(), String> {
    git(root, &["init", "-b", "main"])?;
    git(root, &["add", "--all"])?;
    git(root, &["-c", "user.name=WebMAKER Studio", "-c", "user.email=studio@playmaker.local", "commit", "-m", &format!("Create {name} website")])?;
    Ok(())
}

fn create_local(template: &Path, request: &CreateClubRequest) -> Result<(PathBuf, (String, String, String)), String> {
    validate_request(request)?;
    let parent = fs::canonicalize(&request.parent).map_err(|_| "Choose an accessible parent folder.".to_string())?;
    if !parent.is_dir() { return Err("Choose a parent folder.".into()); }
    let target = parent.join(&request.folder_name);
    if target.exists() { return Err("That club folder already exists. Choose another folder name or open it instead.".into()); }
    let urls = request.github.as_ref().map(|github| github_urls(&github.owner, &github.repository)).unwrap_or_default();
    let result = (|| {
        copy_template(template, &target)?;
        clean_generated_content(&target, request, &urls)?;
        write_readme(&target, request, &urls.0)?;
        initialize_git(&target, &request.club_name)?;
        fs::canonicalize(&target).map_err(|error| error.to_string())
    })();
    match result {
        Ok(root) => Ok((root, urls)),
        Err(error) => { let _ = fs::remove_dir_all(&target); Err(error) }
    }
}

fn run_gcm(args: &[&str]) -> Result<(), String> {
    let output = Command::new("git").arg("credential-manager").args(args).output()
        .map_err(|error| format!("Git Credential Manager is unavailable: {error}. Install Git for Windows."))?;
    if output.status.success() { Ok(()) }
    else { Err(format!("GitHub sign-in failed: {}", String::from_utf8_lossy(&output.stderr).trim())) }
}

fn credential(username: Option<&str>) -> Result<(String, String), String> {
    let mut child = Command::new("git").args(["credential", "fill"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .map_err(|error| format!("Git is unavailable: {error}. Install Git for Windows."))?;
    let mut query = "protocol=https\nhost=github.com\n".to_string();
    if let Some(username) = username { query.push_str(&format!("username={username}\n")); }
    query.push('\n');
    child.stdin.take().ok_or("Could not contact Git Credential Manager.")?.write_all(query.as_bytes()).map_err(|error| error.to_string())?;
    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    if !output.status.success() { return Err("GitHub credentials are unavailable. Connect your account first.".into()); }
    let text = String::from_utf8_lossy(&output.stdout);
    let login = text.lines().find_map(|line| line.strip_prefix("username=")).unwrap_or("").trim().to_string();
    let token = text.lines().find_map(|line| line.strip_prefix("password=")).unwrap_or("").trim().to_string();
    if login.is_empty() || token.is_empty() { return Err("Git Credential Manager returned no GitHub account.".into()); }
    Ok((login, token))
}

fn github_client() -> Result<Client, String> {
    Client::builder().user_agent("WebMAKER-Studio/0.2").build().map_err(|error| error.to_string())
}

fn github_error(response: Response, action: &str) -> String {
    let status = response.status();
    let body: serde_json::Value = response.json().unwrap_or_default();
    let message = body.get("message").and_then(serde_json::Value::as_str).unwrap_or("GitHub rejected the request");
    format!("{action} failed ({status}): {message}")
}

fn github_get_user(login_hint: Option<&str>) -> Result<(GithubUser, String), String> {
    let (_, token) = credential(login_hint)?;
    let response = github_client()?.get("https://api.github.com/user").bearer_auth(&token).header("X-GitHub-Api-Version", "2022-11-28").send().map_err(|error| format!("Could not reach GitHub: {error}"))?;
    if !response.status().is_success() { return Err(github_error(response, "GitHub account check")); }
    let user = response.json::<GithubUser>().map_err(|error| error.to_string())?;
    Ok((user, token))
}

fn create_repository(token: &str, target: &GithubTarget, description: &str) -> Result<GithubRepository, String> {
    let endpoint = if target.owner.eq_ignore_ascii_case(&target.account) { "https://api.github.com/user/repos".to_string() }
        else { format!("https://api.github.com/orgs/{}/repos", target.owner) };
    let response = github_client()?.post(endpoint).bearer_auth(token).header("X-GitHub-Api-Version", "2022-11-28")
        .json(&json!({ "name": target.repository, "description": description, "private": false, "auto_init": false, "has_issues": true }))
        .send().map_err(|error| format!("Could not reach GitHub: {error}"))?;
    if !response.status().is_success() { return Err(github_error(response, "Repository creation")); }
    response.json().map_err(|error| error.to_string())
}

fn configure_pages(token: &str, owner: &str, repository: &str) -> Result<(), String> {
    let response = github_client()?.post(format!("https://api.github.com/repos/{owner}/{repository}/pages"))
        .bearer_auth(token).header("X-GitHub-Api-Version", "2022-11-28").json(&json!({ "build_type": "workflow" }))
        .send().map_err(|error| format!("Could not reach GitHub: {error}"))?;
    if response.status().is_success() { Ok(()) } else { Err(github_error(response, "GitHub Pages setup")) }
}

fn push_initial(root: &Path, repository: &GithubRepository, account: &str) -> Result<(), String> {
    git(root, &["remote", "add", "origin", &repository.clone_url])?;
    git(root, &["config", "credential.https://github.com.username", account])?;
    git(root, &["push", "-u", "origin", "main"])?;
    Ok(())
}

fn template_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled = app.path().resolve("starter", BaseDirectory::Resource).map_err(|error| error.to_string())?;
    if bundled.is_dir() { return Ok(bundled); }
    let development = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    if development.join("site").is_dir() { return Ok(development.canonicalize().map_err(|error| error.to_string())?); }
    Err("The bundled WebMAKER starter is unavailable. Reinstall Studio.".into())
}

#[tauri::command]
pub async fn connect_github() -> Result<GithubAccount, String> {
    tauri::async_runtime::spawn_blocking(|| {
        run_gcm(&["github", "login", "--browser"])?;
        let (user, _) = github_get_user(None)?;
        Ok(GithubAccount { name: user.name.unwrap_or_else(|| user.login.clone()), login: user.login })
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn create_club(request: CreateClubRequest, app: tauri::AppHandle, state: tauri::State<'_, ProjectState>) -> Result<CreateClubResult, String> {
    let template = template_root(&app)?;
    let github = request.github.clone();
    let (root, urls) = tauri::async_runtime::spawn_blocking(move || create_local(&template, &request)).await.map_err(|error| error.to_string())??;
    let mut warnings = Vec::new();
    let mut pages_configured = false;
    if let Some(target) = github {
        let target_for_work = target.clone();
        let root_for_work = root.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            let (user, token) = github_get_user(Some(&target_for_work.account))?;
            if !user.login.eq_ignore_ascii_case(&target_for_work.account) { return Err("Connected GitHub account does not match the selected account.".into()); }
            let repository = create_repository(&token, &target_for_work, "Sports club website created with WebMAKER")?;
            if !repository.owner.login.eq_ignore_ascii_case(&target_for_work.owner) { return Err("GitHub created the repository under an unexpected owner.".into()); }
            push_initial(&root_for_work, &repository, &target_for_work.account)?;
            let pages = configure_pages(&token, &repository.owner.login, &target_for_work.repository);
            Ok::<_, String>((repository, pages))
        }).await.map_err(|error| error.to_string())?;
        match outcome {
            Ok((repository, pages)) => {
                if repository.html_url.trim_end_matches('/') != urls.0 { warnings.push(format!("GitHub returned an unexpected repository URL: {}", repository.html_url)); }
                match pages { Ok(()) => pages_configured = true, Err(error) => warnings.push(format!("The repository was pushed, but {error}")) }
            }
            Err(error) => warnings.push(format!("The local club was created, but GitHub setup did not finish: {error}")),
        }
    }
    let opened = validate_root(root.to_string_lossy().as_ref())?;
    let project = info(&opened)?;
    *state.0.lock().map_err(|_| "Project state is unavailable.".to_string())? = Some(opened);
    Ok(CreateClubResult { project, repository_url: urls.0, site_url: urls.1, pages_configured, warnings })
}

#[tauri::command]
pub async fn clone_club(request: CloneClubRequest, state: tauri::State<'_, ProjectState>) -> Result<ProjectInfo, String> {
    if !valid_slug(&request.folder_name) { return Err("Folder name must contain lowercase letters, numbers, and hyphens only.".into()); }
    let normalized = crate::project::normalized_github_remote(&request.remote_url).ok_or("Enter a valid GitHub repository URL.")?;
    let parent = fs::canonicalize(&request.parent).map_err(|_| "Choose an accessible parent folder.".to_string())?;
    let target = parent.join(&request.folder_name);
    if target.exists() { return Err("That destination already exists. Open it locally or choose another name.".into()); }
    let target_for_work = target.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new("git").args(["clone", &normalized, target_for_work.to_string_lossy().as_ref()]).output()
            .map_err(|error| format!("Git is unavailable: {error}. Install Git for Windows."))?;
        if output.status.success() { Ok(()) } else {
            let _ = fs::remove_dir_all(&target_for_work);
            Err(format!("Clone failed: {}", String::from_utf8_lossy(&output.stderr).trim()))
        }
    }).await.map_err(|error| error.to_string())??;
    let root = match validate_root(target.to_string_lossy().as_ref()) {
        Ok(root) => root,
        Err(error) => { let _ = fs::remove_dir_all(&target); return Err(format!("The cloned repository is not a WebMAKER club: {error}")); }
    };
    let project = info(&root)?;
    *state.0.lock().map_err(|_| "Project state is unavailable.".to_string())? = Some(root);
    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn request(parent: &Path) -> CreateClubRequest {
        CreateClubRequest {
            parent: parent.display().to_string(), folder_name: "north-stars".into(), club_name: "North Stars Club".into(), short_name: "North Stars".into(),
            sport: "football".into(), theme: "dynamic".into(), season: "2027-28".into(), github: None,
        }
    }

    #[test]
    fn computes_project_and_account_pages_urls() {
        assert_eq!(github_urls("north-stars", "club-site").1, "https://north-stars.github.io/club-site/");
        assert_eq!(github_urls("north-stars", "north-stars.github.io").2, "");
        assert!(!valid_owner("-invalid"));
        assert!(!valid_repo(".hidden"));
    }

    #[test]
    fn creates_clean_customized_club_and_initial_commit() {
        let base = std::env::temp_dir().join(format!("webmaker-create-{}", Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        let template = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
        let (root, _) = create_local(&template, &request(&base)).unwrap();
        let club = fs::read_to_string(root.join("site/data/club.yaml")).unwrap();
        let teams = fs::read_to_string(root.join("site/data/teams.yaml")).unwrap();
        assert!(club.contains("North Stars Club"));
        assert!(club.contains("theme: dynamic"));
        assert!(club.contains("sport: football"));
        assert!(teams.contains("north-stars"));
        assert!(!club.contains("Aurora"));
        assert!(!teams.contains("Aurora"));
        assert_eq!(git(&root, &["branch", "--show-current"]).unwrap(), "main");
        assert!(git(&root, &["status", "--porcelain"]).unwrap().is_empty());
        assert!(root.join("site/data/games/2027-28/league.csv").is_file());
        assert!(root.join("site/content/news/welcome.md").is_file());
        let package = fs::read_to_string(root.join("site/package.json")).unwrap();
        assert!(!package.contains("playwright"));
        assert!(!root.join("site/tests/init-club.test.mjs").exists());
        assert!(!root.join("site/tests/browser").exists());
        let report = crate::validation::validate(&root);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
        let install = Command::new(npm).args(["ci", "--ignore-scripts"]).current_dir(root.join("site")).output().unwrap();
        assert!(install.status.success(), "{}", String::from_utf8_lossy(&install.stderr));
        let tests = Command::new(npm).args(["test"]).current_dir(root.join("site")).output().unwrap();
        assert!(tests.status.success(), "{}\n{}", String::from_utf8_lossy(&tests.stdout), String::from_utf8_lossy(&tests.stderr));
        let build = Command::new(npm).args(["run", "build"]).current_dir(root.join("site")).output().unwrap();
        assert!(build.status.success(), "{}", String::from_utf8_lossy(&build.stderr));
        let home = fs::read_to_string(root.join("site/dist/index.html")).unwrap();
        assert!(home.contains("North Stars Club"));
        assert!(!home.contains("Aurora"));
        assert!(!home.contains("Nerone"));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn refuses_to_overwrite_existing_destination() {
        let base = std::env::temp_dir().join(format!("webmaker-existing-{}", Uuid::new_v4()));
        fs::create_dir_all(base.join("north-stars")).unwrap();
        assert!(create_local(Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").as_path(), &request(&base)).unwrap_err().contains("already exists"));
        let _ = fs::remove_dir_all(base);
    }
}
