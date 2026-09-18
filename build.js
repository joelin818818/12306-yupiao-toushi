// build.js — 将 src/ 模块按顺序拼接为可直接安装的油猴脚本 dist/12306余票透视.user.js
// 用法：node build.js
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist');
const DIST_FILE = path.join(DIST_DIR, '12306余票透视.user.js');

// 拼接顺序很重要：先头信息，再依赖（api->dom->ui），最后 main
const ORDER = ['meta.js', 'api.js', 'dom.js', 'ui.js', 'main.js'];

if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

let body = '';
for (const name of ORDER) {
  const p = path.join(SRC_DIR, name);
  body += fs.readFileSync(p, 'utf8').trimEnd() + '\n\n';
}

// meta.js 内含 ==UserScript== 头注释，保留在文件最前；其余代码包进 IIFE
const wrapped = "'use strict';\n(function () {\n" + body + "\n})();\n";

fs.writeFileSync(DIST_FILE, wrapped, 'utf8');
console.log('Built -> ' + DIST_FILE + '  (' + wrapped.length + ' bytes)');
