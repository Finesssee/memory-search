const Database = require('better-sqlite3');
const {glob} = require('glob');
const fs = require('fs');
const db = new Database('C:/Users/FSOS/.memory-search/index.db', {readonly: true});

const rows = db.prepare('SELECT id, path FROM files').all();

glob('D:/Obsidian/dataset/**/*.md', {ignore: ['**/node_modules/**','**/.git/**','**/sandbox/**','**/dist/**','**/build/**']}).then(found => {
  const foundSet = new Set(found.map(f => f.replace(/\\/g, '/')));

  const stale = rows.filter(r => {
    const p = r.path.replace(/\\/g, '/');
    return !foundSet.has(p);
  });

  const stillExist = [];
  const goneFrDisk = [];
  for (const r of stale) {
    try {
      if (fs.existsSync(r.path)) stillExist.push(r);
      else goneFrDisk.push(r);
    } catch(e) { goneFrDisk.push(r); }
  }

  console.log('Total stale (not in current sources):', stale.length);
  console.log('Still exist on disk:', stillExist.length);
  stillExist.forEach(r => console.log('  EXIST:', r.path));
  console.log('');
  console.log('Gone from disk:', goneFrDisk.length);

  const categories = {};
  for (const r of goneFrDisk) {
    const p = r.path.replace(/\\/g, '/');
    let cat;
    if (p.includes('lol')) cat = 'lol/perplexity notes';
    else if (p.includes('session-')) cat = 'session checkpoints';
    else if (p.match(/NPHONG|Notes_|Obsidian_|Converted_|Archive_/)) cat = 'personal notes';
    else if (p.match(/blade16|equalizer|proxypilot|self-learning|razer|SUMMARIES|GEMINI/)) cat = 'personal/project notes';
    else if (p.includes('/D/apps/') || p.includes('/D/examples/') || p.includes('/D/docs/')) cat = 'firecrawl project files (D/)';
    else if (p.includes('/D/')) cat = 'firecrawl top-level (D/)';
    else if (p.includes('granet-config')) cat = 'granet config';
    else if (p.includes('clawd/')) cat = 'clawd subfolder';
    else if (p.includes('test-collection')) cat = 'test file';
    else cat = 'other: ' + p;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(r);
  }

  console.log('');
  for (const [cat, items] of Object.entries(categories).sort((a,b) => b[1].length - a[1].length)) {
    console.log(`${cat}: ${items.length}`);
    items.slice(0, 5).forEach(r => console.log('  ', r.path));
    if (items.length > 5) console.log('  ...');
  }

  db.close();
});
