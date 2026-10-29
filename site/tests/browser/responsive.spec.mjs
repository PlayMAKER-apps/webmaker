import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, sep, extname, join } from 'node:path';

const siteRoot = resolve('.');
const dist = join(siteRoot, 'dist');
const sizes = [320, 390, 768, 1440];
const types = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };

for (const theme of ['bold', 'classic', 'dynamic']) {
  test.describe(`${theme} responsive snapshot`, () => {
    let server;
    let baseUrl;

    test.beforeAll(async () => {
      const build = spawnSync(process.execPath, ['scripts/build-data.mjs'], {
        cwd: siteRoot, env: { ...process.env, WEBMAKER_THEME: theme }, encoding: 'utf8'
      });
      expect(build.status, build.stderr).toBe(0);
      server = createServer((request, response) => {
        const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        let file = resolve(dist, `.${path}`);
        if (file !== dist && !file.startsWith(`${dist}${sep}`)) { response.writeHead(403).end(); return; }
        if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
        if (!existsSync(file)) { response.writeHead(404).end(); return; }
        response.writeHead(200, { 'Content-Type': `${types[extname(file)] ?? 'application/octet-stream'}; charset=utf-8` });
        response.end(readFileSync(file));
      });
      await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    test.afterAll(async () => {
      if (server) await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    });

    for (const width of sizes) {
      test(`${width}px layout, SEO and basic accessibility`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(baseUrl);
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://example.github.io/');
        await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Aurora/);
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await expect(page.locator('.skip-link')).toHaveAttribute('href', '#main');
        const snapshot = await page.evaluate(() => {
          const headerNav = document.querySelector('.header-inner > nav');
          const mobileNav = document.querySelector('.mobile-nav');
          const grid = document.querySelector('.home-teams .card-grid');
          return {
            theme: document.body.className,
            title: document.title,
            heading: document.querySelector('h1')?.textContent,
            canonical: document.querySelector('link[rel="canonical"]')?.href,
            navigation: [...headerNav.querySelectorAll('a')].map(link => link.textContent),
            desktopNavVisible: getComputedStyle(headerNav).display !== 'none',
            mobileNavVisible: getComputedStyle(mobileNav).display !== 'none',
            gridColumns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            imagesMissingAlt: document.querySelectorAll('img:not([alt])').length,
            unnamedLinks: [...document.querySelectorAll('a')].filter(link => !link.textContent.trim() && !link.getAttribute('aria-label') && !link.querySelector('img[alt]:not([alt=""])')).length
          };
        });
        expect(snapshot.horizontalOverflow).toBe(false);
        expect(snapshot.imagesMissingAlt).toBe(0);
        expect(snapshot.unnamedLinks).toBe(0);
        expect(snapshot.mobileNavVisible).toBe(width <= 800);
        expect(snapshot.desktopNavVisible).toBe(width > 800);
        if (width <= 800) {
          await page.locator('.mobile-nav summary').click();
          await expect(page.locator('.mobile-nav nav a').first()).toBeVisible();
        }
        expect(JSON.stringify(snapshot, null, 2)).toMatchSnapshot(`${theme}-${width}.txt`);
        await testInfo.attach(`${theme}-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

        await page.goto(`${baseUrl}/competition/2026-27/amatori/`);
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('table')).toHaveCount(1);
        const standings = await page.evaluate(() => ({
          canonical: document.querySelector('link[rel="canonical"]')?.href,
          heading: document.querySelector('h1')?.textContent,
          documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          tableScrollable: document.querySelector('.table-wrap').scrollWidth > document.querySelector('.table-wrap').clientWidth
        }));
        expect(standings.documentOverflow).toBe(false);
        expect(standings.canonical).toBe('https://example.github.io/competition/2026-27/amatori/');
        expect(JSON.stringify(standings, null, 2)).toMatchSnapshot(`${theme}-${width}-standings.txt`);
        await testInfo.attach(`${theme}-${width}-standings.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      });
    }
  });
}
