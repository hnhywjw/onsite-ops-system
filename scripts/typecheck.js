const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const serverPath = path.join(root, 'server.js');
const htmlPath = path.join(root, 'public', 'index.html');
const scriptPaths = [path.join(__dirname, 'lint.js'), path.join(__dirname, 'typecheck.js'), path.join(__dirname, 'regression.js')];

function runNodeCheck(filePath) {
  execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
}

function getInlineScriptSource(html) {
  const end = html.lastIndexOf('</script>');
  const start = html.lastIndexOf('<script', end);
  const openEnd = start === -1 ? -1 : html.indexOf('>', start);
  if (start === -1 || end === -1 || openEnd === -1 || openEnd >= end) {
    throw new Error('未找到内联脚本');
  }
  return html.slice(openEnd + 1, end);
}

function compileInlineScript(source) {
  new Function(source);
}

function main() {
  runNodeCheck(serverPath);
  scriptPaths.forEach(runNodeCheck);
  const html = fs.readFileSync(htmlPath, 'utf8');
  compileInlineScript(getInlineScriptSource(html));
  process.stdout.write('Typecheck passed\n');
}

main();
