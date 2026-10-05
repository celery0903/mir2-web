import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const snapshotFile = process.argv[2];
const destination = process.argv[3];
assert.ok(snapshotFile && destination, 'Expected native snapshot and output paths');
const snapshotBytes = await readFile(snapshotFile);
const snapshot = JSON.parse(snapshotBytes);
const pinsBytes = await readFile('shared/classic-item-sources.json');
const pins = JSON.parse(pinsBytes);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(JSON.stringify(snapshot.rows)), snapshot.definitionsSha256);
const normalize = name => name.trim().replaceAll('（', '(').replaceAll('）', ')').replace(/[:：]+$/, '');
const browser = await chromium.launch({ headless: true });
const pages = [];
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  for (const pin of pins.guides) {
    const raw = await readFile(pin.path);
    assert.equal(digest(raw), pin.sha256, `Unpinned item guide: ${pin.url}`);
    await page.setContent(raw.toString('utf8'));
    const records = await page.evaluate(() => [...document.querySelectorAll('tr')].flatMap((row, index) => {
      const cells = [...row.querySelectorAll(':scope > td')];
      if (cells.length < 2) return [];
      const images = [...row.querySelectorAll('img')].filter(image => image.closest('tr') === row && /\/images\/item\//.test(image.getAttribute('src') ?? ''));
      if (!images.length) return [];
      const imageCell = images[0].closest('td');
      const imageIndex = cells.indexOf(imageCell);
      const nameCell = imageIndex === 0 ? cells[1] : imageIndex === 1 ? cells[0] : null;
      if (!nameCell) return [];
      const label = (nameCell.querySelector('b')?.innerText ?? nameCell.innerText).trim().split('\n')[0].trim();
      if (!label || label.length > 24) return [];
      return [{ row: index, label, text: cells.map(cell => cell.innerText.trim()).filter(Boolean).join('\n'),
        images: images.map(image => image.getAttribute('src')) }];
    }));
    pages.push({ ...pin, records: records.map(record => {
      const name = normalize(record.label);
      const exact = snapshot.rows.filter(row => row.Name === name);
      const sexVariants = exact.length ? [] : snapshot.rows.filter(row => row.Name === `${name}(男)` || row.Name === `${name}(女)`);
      return { ...record, normalizedLabel: name, matchingIds: [...exact, ...sexVariants].map(row => row.Id),
        matchKind: exact.length ? 'exact-name' : sexVariants.length ? 'explicit-sex-variants' : 'unresolved-label',
        damagedLabel: /[*�]/.test(record.label), numericalAcceptance: 'unverified' };
    }) });
  }
} finally { await browser.close(); }
const records = pages.flatMap(page => page.records.map(record => ({ url: page.url, ...record })));
for (const name of ['蜡烛', '鹤嘴锄', '布衣', '神秘腰带'])
  assert.equal(records.filter(record => record.normalizedLabel === name).length, 1, `Missing or duplicate guide item: ${name}`);
const comparisons = snapshot.rows.map(row => ({ id: row.Id, name: row.Name, stdMode: row.StdMode,
  guideRecords: records.filter(record => record.matchingIds.includes(row.Id)), numericalAcceptance: 'unverified' }));
const report = { readOnly: true, full176Acceptance: false, authenticated2003Data: false, definitionRows: snapshot.rows.length,
  snapshotSha256: digest(snapshotBytes), definitionsSha256: snapshot.definitionsSha256, sourcePinsSha256: digest(pinsBytes), pages,
  recordCount: records.length, exactMatchedDefinitions: comparisons.filter(row => row.guideRecords.length).length,
  unresolvedLabels: records.filter(record => !record.matchingIds.length), comparisons,
  interpretation: 'DOM rows are extracted from seven pinned current pages, with source text retained. Punctuation and explicit male/female armor names are the only matching transformations. Censored names and spelling differences remain unresolved; absent guide names are not evidence of later content. Merchant multipliers and textual conflicts prevent direct numerical import.' };
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ definitions: report.definitionRows, guideRecords: records.length, matchedDefinitions: report.exactMatchedDefinitions,
  unresolvedLabels: report.unresolvedLabels.length, report: destination }, null, 2));
