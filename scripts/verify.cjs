const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const unit = fs.readdirSync(path.join(root,'tests')).filter(name => name.endsWith('.test.cjs')).map(name => path.join('tests',name));
for (const args of [['scripts/check.cjs'],['--test',...unit],['tests/ui.cjs'],['tests/browser.cjs']]) {
  const result = spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',timeout:120000});
  if (result.error || result.status !== 0) { console.error(result.error?.message || 'Verification failed.'); process.exit(result.status || 1); }
}
console.log('All Anti Red-Tag suites passed.');
