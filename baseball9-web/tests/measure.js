// 세부 능력치 효과 측정 (개발용): node tests/measure.js
const E = require('./load');
const { GameEngine, GameState, Player, MODE } = E;
const mk = (n, pos, ovr, sub) => { const p = new Player(n, pos, 'x', 27, ovr, ovr, 1, 1, 'T', 2024); p.sub = sub; return p; };
function run(sub, psub = [50, 50], N = 900) {
  let ab = 0, h = 0, hr = 0, k = 0, bb = 0, pa = 0, runs = 0, pk = 0, pbb = 0, pbf = 0;
  for (let s = 0; s < N; s++) {
    const pos = ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'DH'];
    const gs = new GameState('A', 'B');
    const A = pos.map((p, i) => mk('a' + i, p, 80, sub)).concat([mk('asp', 'SP', 80, [50, 50]), mk('arp', 'RP', 80, [50, 50])]);
    const B = pos.map((p, i) => mk('b' + i, p, 80, [50, 50, 50, 50])).concat([mk('bsp', 'SP', 80, psub), mk('brp', 'RP', 80, psub)]);
    gs.mine.lineup = A.slice(0, 9); gs.mine.roster = A; gs.mine.pitcher = A[9];
    gs.theirs.lineup = B.slice(0, 9); gs.theirs.roster = B; gs.theirs.pitcher = B[9];
    const e = new GameEngine(gs, { seed: s + 1 }); e.autoMine = true; e.run(MODE.GAME);
    e.bat.forEach((x, id) => { if (A.some(p => p.id === id)) { ab += x.ab; h += x.h; hr += x.hr; k += x.k; bb += x.bb; pa += x.pa; } });
    runs += gs.mine.score;
  }
  return { AVG: (h / ab).toFixed(3), HR9: (hr / N).toFixed(2), 'BB%': (100 * bb / pa).toFixed(1), 'K%': (100 * k / pa).toFixed(1), runs: (runs / N).toFixed(2) };
}
if (require.main === module) {
  console.log('타자 균형형 [50,50,50,50]', JSON.stringify(run([50, 50, 50, 50])));
  console.log('타자 컨택형 [85,25,50,50]', JSON.stringify(run([85, 25, 50, 50])));
  console.log('타자 파워형 [35,95,50,50]', JSON.stringify(run([35, 95, 50, 50])));
  console.log('타자 선구형 [50,50,90,50]', JSON.stringify(run([50, 50, 90, 50])));
  console.log('상대 투수 탈삼진형 [95,25] vs 균형 타자', JSON.stringify(run([50, 50, 50, 50], [95, 25])));
  console.log('상대 투수 제구형   [25,95] vs 균형 타자', JSON.stringify(run([50, 50, 50, 50], [25, 95])));
}
module.exports = { run };
