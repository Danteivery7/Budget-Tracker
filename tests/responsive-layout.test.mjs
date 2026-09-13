import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../responsive.css', import.meta.url), 'utf8');
const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

test('responsive stylesheet loads after feature styles so its breakpoints win', () => {
  const health = index.indexOf('/system-health.css');
  const responsive = index.indexOf('/responsive.css');
  assert.ok(health >= 0);
  assert.ok(responsive > health);
});

test('responsive runtime and assets are included in the production shell and offline cache', () => {
  assert.match(index, /src="\/responsive\.js"/);
  assert.match(sw, /'\/responsive\.css'/);
  assert.match(sw, /'\/responsive\.js'/);
});

test('phone layout prevents desktop shell overflow and uses a scrollable navigation dock', () => {
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.sidebar\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(css, /\.main-panel\s*\{[\s\S]*?margin-left:\s*0\s*!important/);
  assert.match(css, /\.mobile-nav\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /grid-auto-columns:\s*minmax\(76px, 1fr\)/);
});

test('narrow phones collapse dense financial dashboards to readable single columns', () => {
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /\.summary-grid,[\s\S]*?grid-template-columns:\s*1fr\s*!important/);
  assert.match(css, /\.bank-account-balance\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});

test('compact laptop breakpoint keeps MacBook-sized windows from using the full desktop spacing', () => {
  assert.match(css, /@media \(max-width: 1180px\) and \(min-width: 761px\)/);
  assert.match(css, /--sidebar:\s*220px/);
  assert.match(css, /\.main-panel\s*\{[\s\S]*?padding:\s*28px 22px 64px/);
});
