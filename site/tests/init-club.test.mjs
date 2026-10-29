import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const source = resolve('..');
const initializer = join(source, 'scripts', 'init-club.mjs');

test('initializer creates an independent Pages starter for all three themes', () => {
  const temp = mkdtempSync(join(tmpdir(), 'webmaker-starter-'));
  const destination = join(temp, 'my-club');
  try {
    const created = spawnSync(process.execPath, [initializer, destination], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    assert.equal(existsSync(join(destination, '.git')), false);
    for (const file of ['.github/workflows/deploy.yml', 'site/package-lock.json', 'site/scripts/build-data.mjs', 'shared/profiles/basketball.json', 'shared/profiles/football.json']) {
      assert.ok(existsSync(join(destination, file)), `Missing ${file}`);
    }
    assert.match(readFileSync(join(destination, '.github/workflows/deploy.yml'), 'utf8'), /deploy-pages@/);
    assert.equal(existsSync(join(destination, 'site/node_modules')), false);
    assert.equal(existsSync(join(destination, 'site/dist')), false);
    for (const folder of ['site/data', 'site/content/news', 'site/public']) {
      const root = join(destination, folder);
      for (const relative of readdirSync(root, { recursive: true })) {
        assert.doesNotMatch(relative, /nerone/i);
        const file = join(root, relative);
        if (statSync(file).isFile() && /\.(yaml|csv|md|svg|css|html)$/i.test(file)) {
          assert.doesNotMatch(readFileSync(file, 'utf8'), /Nerone Basket|nerone-basket/i);
        }
      }
    }

    const clubFile = join(destination, 'site/data/club.yaml');
    const club = YAML.parse(readFileSync(clubFile, 'utf8'));
    club.site_url = 'https://example.github.io/my-club/';
    club.base_path = '/my-club';
    writeFileSync(clubFile, YAML.stringify(club));
    mkdirSync(join(destination, 'site/node_modules'));
    cpSync(resolve('node_modules/yaml'), join(destination, 'site/node_modules/yaml'), { recursive: true });
    for (const theme of ['bold', 'classic', 'dynamic']) {
      const built = spawnSync(process.execPath, ['scripts/build-data.mjs'], {
        cwd: join(destination, 'site'), env: { ...process.env, WEBMAKER_THEME: theme }, encoding: 'utf8'
      });
      assert.equal(built.status, 0, `${theme}: ${built.stderr}`);
      const home = readFileSync(join(destination, 'site/dist/index.html'), 'utf8');
      assert.match(home, new RegExp(`theme-${theme}`));
      assert.match(home, /https:\/\/example\.github\.io\/my-club\//);
      assert.match(home, /href="\/my-club\/assets\/site\.css"/);
      assert.doesNotMatch(home, /Nerone Basket/i);
    }
    const repeated = spawnSync(process.execPath, [initializer, destination], { encoding: 'utf8' });
    assert.notEqual(repeated.status, 0);
    assert.match(repeated.stderr, /already exists/);
  } finally {
    const safeRoot = realpathSync(tmpdir());
    const safeTarget = realpathSync(temp);
    if (!safeTarget.startsWith(`${safeRoot}${sep}`)) throw new Error('Unsafe starter test cleanup path');
    rmSync(safeTarget, { recursive: true, force: true });
  }
});
