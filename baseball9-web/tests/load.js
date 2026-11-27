// players.js + engine.js + season.js 를 하나의 스크립트로 읽어 Node 에서 테스트할 수 있게 합니다.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const src = [
  read('players.js'),
  read('engine.js'),
  'const __engineExports = module.exports;',
  read('season.js'),
  'module.exports = Object.assign({}, __engineExports, module.exports);',
].join('\n');
const sandbox = { module: { exports: {} }, console, Math };
vm.runInNewContext(src, sandbox);
module.exports = sandbox.module.exports;
