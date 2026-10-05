import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { loadClassicSkills } from '../scripts/classic-skills.mjs';

const policy = await loadClassicSkills();
const source = process.env.MIR_SKILL_GUIDES ?? '.runtime/data-research';
const destination = process.env.MIR_SKILL_REFERENCE_REPORT ?? '.runtime/reports/classic-skill-references';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(join(destination, 'references'), { recursive: true });
const report = { checkedAt: new Date().toISOString(), passed: false, authenticated2003Data: false,
  full176Acceptance: false, scope: 'Cross-check exact skill identities and jobs only. Live legacy pages and a mixed community table are not authenticated 2003 numerical data.',
  policySha256: digest(await readFile('shared/classic-skills.json')), guides: [] };
const browser = await chromium.launch({ headless: true });
try {
  const candidate = JSON.parse(await readFile('docs/reference-176-audit.json'));
  assert.equal(candidate.repository, policy.reference.repository);
  assert.equal(candidate.revision, policy.reference.revision);
  assert.equal(candidate.sourceFiles['Magic.DB'].sha256, policy.reference.sha256);
  const rawTable = join(`.runtime/mirserver-1.76-${policy.reference.revision}`, policy.reference.file);
  assert.equal(digest(await readFile(rawTable)), policy.reference.sha256);
  assert.deepEqual(candidate.first33Skills.map(row => ({ magicId: row.MagID, name: row.MagName, job: row.Job })), policy.skills);
  report.candidate = { ...policy.reference, checkedIdentities: candidate.first33Skills.length };
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.route('**/*', route => route.abort());
  for (const guide of policy.guides) {
    const url = new URL(guide.url);
    const file = `${url.hostname}${url.pathname.replace(/\W/g, '_')}.html`;
    const raw = await readFile(join(source, file));
    assert.equal(digest(raw), guide.sha256, 'Guide bytes changed since research');
    const page = await context.newPage();
    await page.setContent(new TextDecoder('utf-8', { fatal: true }).decode(raw), { waitUntil: 'domcontentloaded' });
    const names = await page.locator('td[colspan="2"] b').evaluateAll(elements => elements
      .map(element => element.textContent.trim().replace(/[:\uFF1A].*$/, '').trim()).filter(Boolean));
    const expected = policy.skills.filter(skill => skill.job === guide.job)
      .map(skill => policy.guideNameAliases[skill.name] ?? skill.name);
    assert.deepEqual(names.slice().sort(), expected.slice().sort(), `Guide skill scope for job ${guide.job}`);
    await copyFile(join(source, file), join(destination, 'references', file));
    report.guides.push({ ...guide, file: `references/${file}`, names, checkedNames: names.length,
      authenticated2003Snapshot: false });
    await page.close();
  }
  report.passed = true;
} catch (error) { report.error = String(error); throw error; }
finally {
  await browser.close();
  await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(`33 classic skill identities match the pinned community table and 6/14/13 legacy guide headings. Report: ${destination}`);
