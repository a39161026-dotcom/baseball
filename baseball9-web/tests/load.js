// players.js + engine.js 를 하나로 읽어 Node 에서 테스트할 수 있게 합니다.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = ['players.js', 'engine.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');
const sandbox = { module: { exports: {} }, console, Math };
vm.runInNewContext(src, sandbox);
module.exports = sandbox.module.exports;
