use crate::project::{root, ProjectState};
use serde::Serialize;
use serde_yaml::Value;
use std::{collections::HashSet, fs, path::Path};

#[derive(Default, Serialize)]
pub struct ValidationReport { pub errors: Vec<String>, pub warnings: Vec<String>, pub games: usize, pub players: usize, pub news: usize }

fn yaml(path: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
    serde_yaml::from_str(&text).map_err(|error| format!("{}: Invalid YAML: {error}", path.display()))
}

fn field<'a>(value: &'a Value, key: &str) -> Option<&'a str> { value.get(key).and_then(Value::as_str) }

fn csv_rows(path: &Path) -> Result<Vec<csv::StringRecord>, String> {
    let source = fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
    crate::storage::validate_csv_syntax(&source).map_err(|error| format!("{}: {error}", path.display()))?;
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_path(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let headers = reader.headers().map_err(|error| format!("{}: {error}", path.display()))?.clone();
    let mut rows = Vec::new();
    for result in reader.records() {
        let row = result.map_err(|error| format!("{}: Invalid CSV: {error}", path.display()))?;
        if row.len() > headers.len() { return Err(format!("{}: more fields than declared columns.", path.display())); }
        let mut named = csv::StringRecord::new();
        for (index, header) in headers.iter().enumerate() {
            named.push_field(header);
            named.push_field(row.get(index).unwrap_or(""));
        }
        rows.push(named);
    }
    Ok(rows)
}

fn get<'a>(row: &'a csv::StringRecord, key: &str) -> &'a str {
    row.iter().collect::<Vec<_>>().chunks(2).find_map(|pair| if pair.first() == Some(&key) { pair.get(1).copied() } else { None }).unwrap_or("")
}

fn data_files(root: &Path, subdir: &str, extension: &str) -> Vec<std::path::PathBuf> {
    let mut paths: Vec<_> = walkdir::WalkDir::new(root.join(subdir)).into_iter().filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && entry.path().extension().and_then(|value| value.to_str()) == Some(extension)
            && !entry.file_name().to_string_lossy().starts_with('_'))
        .map(|entry| entry.into_path()).collect();
    paths.sort(); paths
}

fn valid_date(value: &str) -> bool {
    let parts: Vec<_> = value.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 { return false; }
    let (Ok(year), Ok(month), Ok(day)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>(), parts[2].parse::<u32>()) else { return false; };
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => return false,
    };
    (1..=max_day).contains(&day)
}

fn valid_time(value: &str) -> bool {
    if value.is_empty() { return true; }
    let parts: Vec<_> = value.split(':').collect();
    parts.len() == 2 && parts[0].len() == 2 && parts[1].len() == 2
        && parts[0].parse::<u32>().is_ok_and(|hour| hour < 24)
        && parts[1].parse::<u32>().is_ok_and(|minute| minute < 60)
}

pub fn validate(root: &Path) -> ValidationReport {
    let mut report = ValidationReport::default();
    let mut competition_pairs = HashSet::new();
    let mut participating_teams = Vec::new();
    match yaml(&root.join("site/data/competitions.yaml")) {
        Ok(config) => {
            let current = field(&config, "current_season").unwrap_or("");
            let mut season_ids = HashSet::new();
            if let Some(seasons) = config.get("seasons").and_then(Value::as_sequence) {
                for season in seasons {
                    let Some(season_id) = field(season, "id") else { report.errors.push("Stagione senza ID in competitions.yaml.".into()); continue; };
                    if !season_ids.insert(season_id.to_string()) { report.errors.push(format!("Duplicate season: {season_id}.")); }
                    if season_id.len() != 7 || !season_id.chars().enumerate().all(|(index, ch)| if index == 4 { ch == '-' } else { ch.is_ascii_digit() }) {
                        report.errors.push(format!("Invalid season ID: {season_id}."));
                    }
                    let Some(competitions) = season.get("competitions").and_then(Value::as_sequence) else { report.errors.push(format!("{season_id}: competition list is missing.")); continue; };
                    if season_id == current && competitions.is_empty() { report.errors.push(format!("The current season {season_id} has no competitions.")); }
                    for competition in competitions {
                        let Some(competition_id) = field(competition, "id") else { report.errors.push(format!("{season_id}: competition is missing an ID.")); continue; };
                        if competition_id.is_empty() || competition_id.starts_with('-') || competition_id.ends_with('-')
                            || !competition_id.chars().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-') {
                            report.errors.push(format!("Invalid competition ID: {competition_id}."));
                        }
                        let pair = format!("{season_id}/{competition_id}");
                        if !competition_pairs.insert(pair.clone()) { report.errors.push(format!("Duplicate competition: {pair}.")); }
                        if field(competition, "name").unwrap_or("").trim().is_empty() { report.errors.push(format!("{pair}: name is missing.")); }
                        if let Some(team) = field(competition, "team") { participating_teams.push((pair.clone(), team.to_string())); }
                        if let Some(ids) = competition.get("teams").and_then(Value::as_sequence) {
                            for team in ids.iter().filter_map(Value::as_str) { participating_teams.push((pair.clone(), team.to_string())); }
                        }
                        for key in ["win", "loss"] {
                            if let Some(value) = competition.get("standings_points").and_then(|points| points.get(key)) {
                                if !value.is_null() && value.as_u64().is_none() { report.errors.push(format!("{pair}: invalid {key} points.")); }
                            }
                        }
                    }
                }
                if !season_ids.contains(current) { report.errors.push(format!("Current season {current} is not configured.")); }
            } else { report.errors.push("competitions.yaml contains no seasons.".into()); }
        },
        Err(error) => report.errors.push(error),
    }
    let teams = match yaml(&root.join("site/data/teams.yaml")) {
        Ok(value) => value.as_mapping().map(|map| map.keys().filter_map(Value::as_str).map(str::to_string).collect::<HashSet<_>>()).unwrap_or_default(),
        Err(error) => { report.errors.push(error); HashSet::new() }
    };
    if teams.is_empty() { report.errors.push("teams.yaml contains no teams.".into()); }
    for (pair, team) in participating_teams { if !teams.contains(&team) { report.errors.push(format!("{pair}: unknown participating team {team}.")); } }
    let mut players = HashSet::new();
    for path in data_files(root, "site/data/players", "yaml") {
        match yaml(&path) {
            Ok(value) => match field(&value, "id") {
                Some(id) if !id.is_empty() => { if !players.insert(id.to_string()) { report.errors.push(format!("Duplicate player ID: {id}")); } },
                _ => report.errors.push(format!("{}: player ID is missing.", path.display())),
            },
            Err(error) => report.errors.push(error),
        }
    }
    report.players = players.len();
    let mut games = HashSet::new();
    for path in data_files(root, "site/data/games", "csv") {
        let relative = path.strip_prefix(root.join("site/data/games")).unwrap_or(&path);
        let pair = relative.to_string_lossy().replace('\\', "/").trim_end_matches(".csv").to_string();
        if !competition_pairs.contains(&pair) { report.warnings.push(format!("{}: archive is not listed in the competition configuration.", path.display())); }
        match csv_rows(&path) {
            Ok(rows) => for row in rows {
                let id = get(&row, "id");
                if id.is_empty() { report.errors.push(format!("{}: game is missing an ID.", path.display())); continue; }
                if !games.insert(id.to_string()) { report.errors.push(format!("Duplicate game ID: {id}")); }
                let home = get(&row, "home_team"); let away = get(&row, "away_team");
                if !teams.contains(home) || !teams.contains(away) { report.errors.push(format!("{id}: team ID is missing from teams.yaml.")); }
                if home == away { report.errors.push(format!("{id}: the two teams are the same.")); }
                if get(&row, "date").is_empty() { report.warnings.push(format!("{id}: historical date is unavailable.")); }
                else if !valid_date(get(&row, "date")) { report.errors.push(format!("{id}: invalid date; use YYYY-MM-DD.")); }
                if !valid_time(get(&row, "time")) { report.errors.push(format!("{id}: invalid time; use HH:MM.")); }
                let status = get(&row, "status");
                if !["scheduled", "played", "final"].contains(&status) { report.errors.push(format!("{id}: unknown status {status}.")); }
                if status == "final" && (get(&row, "home_score").is_empty() || get(&row, "away_score").is_empty()) {
                    report.errors.push(format!("{id}: incomplete final score."));
                }
                for key in ["home_score", "away_score"] {
                    let score = get(&row, key);
                    if !score.is_empty() && score.parse::<u32>().is_err() { report.errors.push(format!("{id}: {key} must be a nonnegative integer.")); }
                }
                report.games += 1;
            },
            Err(error) => report.errors.push(error),
        }
    }
    match csv_rows(&root.join("site/data/rosters.csv")) {
        Ok(rows) => for row in rows {
            let player = get(&row, "player_id"); let team = get(&row, "team_id");
            let pair = format!("{}/{}", get(&row, "season"), get(&row, "competition"));
            if !competition_pairs.contains(&pair) { report.errors.push(format!("Roster {player}: season/competition {pair} is not configured.")); }
            if !players.contains(player) { report.errors.push(format!("Roster: unknown player {player}.")); }
            if !teams.contains(team) { report.errors.push(format!("Roster: unknown team {team}.")); }
            let number = get(&row, "number");
            if !number.is_empty() && number.parse::<u16>().is_err() { report.errors.push(format!("Roster {player}: invalid jersey number.")); }
        },
        Err(error) => report.errors.push(error),
    }
    for path in data_files(root, "site/data/player-stats", "csv") {
        match csv_rows(&path) {
            Ok(rows) => for row in rows {
                let game = get(&row, "game_id"); let player = get(&row, "player_id");
                if !games.contains(game) { report.errors.push(format!("Statistics: unknown game {game}.")); }
                if !players.contains(player) { report.errors.push(format!("Statistics: unknown player {player}.")); }
                let minutes = get(&row, "minutes");
                if !minutes.is_empty() {
                    let parts: Vec<_> = minutes.split(':').collect();
                    if parts.len() != 2 || parts[1].len() != 2 || parts[0].parse::<u32>().is_err() || !parts[1].parse::<u32>().is_ok_and(|seconds| seconds < 60) {
                        report.errors.push(format!("Statistics {game}/{player}: invalid minutes (MM:SS)."));
                    }
                }
                for key in ["points", "three_pointers_made", "two_pointers_made", "free_throws_made", "fouls", "rebounds_off", "rebounds_def", "assists", "turnovers"] {
                    let value = get(&row, key);
                    if !value.is_empty() && value.parse::<u32>().is_err() { report.errors.push(format!("Statistics {game}/{player}: invalid {key}.")); }
                }
            },
            Err(error) => report.errors.push(error),
        }
    }
    for path in data_files(root, "site/content/news", "md") {
        let source = match fs::read_to_string(&path) { Ok(text) => text, Err(error) => { report.errors.push(format!("{}: {error}", path.display())); continue; } };
        let normalized = source.replace("\r\n", "\n");
        let Some(rest) = normalized.strip_prefix("---\n") else { report.errors.push(format!("{}: front matter is missing.", path.display())); continue; };
        let Some((front, _body)) = rest.split_once("\n---\n") else { report.errors.push(format!("{}: front matter is incomplete.", path.display())); continue; };
        match serde_yaml::from_str::<Value>(front) {
            Ok(value) => {
                if field(&value, "title").unwrap_or("").is_empty() { report.errors.push(format!("{}: title is missing.", path.display())); }
                for key in ["players", "games"] {
                    if let Some(items) = value.get(key).and_then(Value::as_sequence) {
                        for item in items.iter().filter_map(Value::as_str) {
                            if key == "players" && !players.contains(item) { report.errors.push(format!("{}: unknown linked player {item}.", path.display())); }
                            if key == "games" && !games.contains(item) { report.errors.push(format!("{}: unknown linked game {item}.", path.display())); }
                        }
                    }
                }
                report.news += 1;
            },
            Err(error) => report.errors.push(format!("{}: Invalid YAML: {error}", path.display())),
        }
    }
    report
}

#[tauri::command]
pub fn validate_project(state: tauri::State<'_, ProjectState>) -> Result<ValidationReport, String> { Ok(validate(&root(&state)?)) }

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    #[test]
    fn rejects_impossible_dates_and_times() {
        assert!(valid_date("2028-02-29"));
        assert!(!valid_date("2026-02-29"));
        assert!(!valid_time("25:00"));
        assert!(valid_time("20:30"));
    }
    #[test]
    fn demo_data_passes_native_validation() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
        let report = validate(&root);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert!(report.games > 0);
        assert!(report.players > 0);
    }
    #[test]
    fn invalid_competition_configuration_is_blocked_before_publish() {
        let temp = std::env::temp_dir().join(format!("webmaker-config-{}", Uuid::new_v4()));
        fs::create_dir_all(temp.join("site/data")).unwrap();
        let root = temp.canonicalize().unwrap();
        fs::write(root.join("site/data/teams.yaml"), "aurora:\n  name: Aurora\n").unwrap();
        fs::write(root.join("site/data/rosters.csv"), "season,competition,team_id,player_id,number\n").unwrap();
        fs::write(root.join("site/data/competitions.yaml"), "current_season: 2028-29\nseasons:\n  - id: 2027-28\n    competitions:\n      - id: gold\n        name: Gold\n        teams: [unknown-team]\n      - id: gold\n        name: Duplicate\n").unwrap();
        let report = validate(&root);
        assert!(report.errors.iter().any(|error| error.contains("Duplicate competition")));
        assert!(report.errors.iter().any(|error| error.contains("Current season")));
        assert!(report.errors.iter().any(|error| error.contains("unknown participating team")));
        assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(root).unwrap();
    }
}
