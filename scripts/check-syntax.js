const { readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

function javascriptFiles(root) {
  return readdirSync(root).flatMap(name => {
    const file = join(root, name);
    if (name === 'node_modules') return [];
    return statSync(file).isDirectory() ? javascriptFiles(file) : file.endsWith('.js') ? [file] : [];
  });
}

const files = ['server.js', ...javascriptFiles('src'), ...javascriptFiles('public/js')];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Sintaxe validada em ${files.length} arquivos JavaScript.`);
