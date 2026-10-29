const statKey = /^[a-z][a-z0-9_]*$/;

export function validateSportProfile(profile, sport) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || profile.id !== sport) {
    throw new Error(`Invalid sport profile for ${sport}`);
  }
  for (const key of ['name', 'scoreLabel']) {
    if (typeof profile[key] !== 'string' || !profile[key].trim()) {
      throw new Error(`Sport profile ${sport} needs a ${key}`);
    }
  }
  if (!Array.isArray(profile.periods) || !profile.periods.length ||
      profile.periods.some(period => typeof period !== 'string' || !period.trim())) {
    throw new Error(`Sport profile ${sport} needs period labels`);
  }
  if (!Array.isArray(profile.stats) || !profile.stats.length) {
    throw new Error(`Sport profile ${sport} needs statistics`);
  }
  const keys = new Set();
  for (const stat of profile.stats) {
    if (!stat || typeof stat !== 'object' || !statKey.test(stat.key) ||
        typeof stat.label !== 'string' || !stat.label.trim() || keys.has(stat.key)) {
      throw new Error(`Sport profile ${sport} has an invalid or duplicate statistic`);
    }
    keys.add(stat.key);
  }
  return profile;
}

export function sumProfileStat(rows, key) {
  return rows.reduce((sum, row) => {
    const raw = row[key];
    if (raw === undefined || raw === '') return sum;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${key} statistic`);
    return sum + value;
  }, 0);
}
