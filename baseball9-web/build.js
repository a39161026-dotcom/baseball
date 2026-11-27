// src/play.src.html 에 선수 데이터와 엔진을 넣어 dist/play.html (게시용 단일 파일)을 만듭니다.
// dist/preview.html 은 로컬 브라우저 확인용으로 <!doctype> 골격을 씌운 버전입니다.
const fs = require('fs');
const path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const strip = js => js.replace(/if \(typeof module !== 'undefined'\) \{[\s\S]*?\}\s*$/, '');
let html = src('play.src.html')
  .replace('/*__PLAYERS__*/', () => src('players.js'))
  .replace('/*__ENGINE__*/', () => strip(src('engine.js')) + '\n' + strip(src('season.js')));
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'play.html'), html);
fs.writeFileSync(path.join(__dirname, 'dist', 'preview.html'),
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>' + html + '</body></html>');
console.log('built', (html.length / 1024).toFixed(1) + 'KB');
