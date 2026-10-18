const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [
  path.join(root, 'server.js'),
  path.join(root, 'public', 'index.html'),
  path.join(__dirname, 'typecheck.js'),
  path.join(__dirname, 'regression.js'),
  path.join(__dirname, 'e2e.js'),
  path.join(__dirname, 'smoke.js')
];

function collectIssues(filePath, content) {
  const issues = [];
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/\s+$/.test(line)) {
      issues.push(`${filePath}:${lineNumber} 存在行尾空白`);
    }
    if (/\t/.test(line)) {
      issues.push(`${filePath}:${lineNumber} 存在 Tab 字符`);
    }
    if (/\bdebugger\b/.test(line)) {
      issues.push(`${filePath}:${lineNumber} 存在 debugger`);
    }
    if (/console\.(log|debug)\s*\(/.test(line) && !/Server running at http:\/\/localhost:\$\{port\}/.test(line)) {
      issues.push(`${filePath}:${lineNumber} 存在调试输出`);
    }
  });
  return issues;
}

function main() {
  const issues = files.flatMap(filePath => collectIssues(filePath, fs.readFileSync(filePath, 'utf8')));
  // 入口脚本会随升级包覆盖到容器内，缺少可执行位会导致容器无法启动。
  const entrypointPath = path.join(root, 'docker-entrypoint.sh');
  if ((fs.statSync(entrypointPath).mode & 0o111) === 0) {
    issues.push(`${entrypointPath}:1 缺少可执行位，请执行 chmod +x docker-entrypoint.sh`);
  }
  if (issues.length > 0) {
    process.stderr.write(issues.join('\n') + '\n');
    process.exit(1);
  }
  process.stdout.write('Lint passed\n');
}

main();
