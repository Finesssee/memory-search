const Database = require('better-sqlite3');
const {glob} = require('glob');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Load config to get sources and database path
const configPath = path.join(os.homedir(), '.memory-search', 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('No config found at', configPath);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const dbPath = (config.indexPath || '~/.memory-search/index.db').replace(/^~/, os.homedir());
const sources = config.sources || [];

if (sources.length === 0) {
  console.error('No sources configured in', configPath);
  process.exit(1);
}

const db = new Database(dbPath, {readonly: true});
const rows = db.prepare('SELECT id, path FROM files').all();

// Glob all markdown files from configured sources
const patterns = sources.map(s => s.replace(/\\/g, '/') + '/**/*.md');
Promise.all(patterns.map(p => glob(p, {ignore: ['**/node_modules/**','**/.git/**','**/sandbox/**','**/dist/**','**/build/**']}))).then(results => {
  const found = results.flat();
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
  goneFrDisk.slice(0, 20).forEach(r => console.log('  ', r.path));
  if (goneFrDisk.length > 20) console.log(`  ... and ${goneFrDisk.length - 20} more`);

  db.close();
});
