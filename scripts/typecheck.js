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
  const start = html.lastIndexOf('<script>');
  const end = html.lastIndexOf('</script>');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('未找到内联脚本');
  }
  return html.slice(start + '<script>'.length, end);
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
