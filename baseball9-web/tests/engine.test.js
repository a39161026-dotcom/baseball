const test = require('node:test');
const assert = require('node:assert');
const { createService, GameEngine, GameState, Player, MODE } = require('./load');

const mk = (n, pos, ovr) => new Player(n, pos, '국내', 27, ovr, ovr, 1, 1, 'T', 2024);
function newGame(ovr = 75, seed = 1) {
  const pos = ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'DH', 'DH'];
  const gs = new GameState('우리', '상대');
  const mine = pos.map((p, i) => mk('우리' + i, p, ovr)).concat([mk('우리SP', 'SP', ovr), mk('우리RP1', 'RP', ovr), mk('우리RP2', 'RP', ovr)]);
  const theirs = pos.map((p, i) => mk('상대' + i, p, ovr)).concat([mk('상대SP', 'SP', ovr), mk('상대RP1', 'RP', ovr), mk('상대RP2', 'RP', ovr)]);
  gs.mine.lineup = mine.slice(0, 9); gs.mine.roster = mine; gs.mine.pitcher = mine[10];
  gs.theirs.lineup = theirs.slice(0, 9); gs.theirs.roster = theirs; gs.theirs.pitcher = theirs[10];
  return { gs, e: new GameEngine(gs, { seed }) };
}

test('아웃/주자 불변식, 동점 없이 종료', () => {
  for (let g = 0; g < 150; g++) {
    const { gs, e } = newGame(75, g + 1);
    let guard = 0;
    while (!gs.done && guard++ < 20000) {
      if (e.needsDecision()) e.ackDecision();
      e.step();
      assert.ok(gs.outs >= 0 && gs.outs <= 2);
      const rn = gs.runners.filter(Boolean);
      assert.strictEqual(new Set(rn).size, rn.length);
    }
    assert.ok(gs.done);
    assert.notStrictEqual(gs.mine.score, gs.theirs.score);
  }
});

test('고의4구: 1루 비어 있으면 주자 안 밀림', () => {
  const { gs } = newGame(70, 3);
  gs.top = false;
  const second = gs.theirs.lineup[1], third = gs.theirs.lineup[2];
  gs.runners = [null, second, third];
  const e = new GameEngine(gs, { seed: 3 });
  assert.ok(e.requestIbb());
  const before = gs.theirs.score;
  const r = e.step();
  assert.ok(r.atBatEnded);
  assert.strictEqual(gs.theirs.score, before);
  assert.ok(gs.runners[0]);
  assert.strictEqual(gs.runners[1], second);
  assert.strictEqual(gs.runners[2], third);
});

test('대타는 라인업 슬롯을 교체', () => {
  const { gs, e } = newGame(75, 5);
  const bench = mk('대타', 'OF', 80);
  gs.mine.roster.push(bench);
  const old = gs.mine.currentBatter();
  assert.ok(e.requestPinchHit(bench));
  assert.strictEqual(gs.mine.currentBatter(), bench);
  assert.ok(!gs.mine.lineup.includes(old));
});

test('투수 교체: 불펜에서만, 등판 후 불펜에서 빠짐', () => {
  const { gs, e } = newGame(75, 6);
  gs.top = false;
  const rp = gs.mine.roster[11];
  assert.ok(e.requestPitcherChange(rp));
  assert.strictEqual(gs.mine.pitcher, rp);
  assert.strictEqual(gs.mine.pitcherLines.length, 2);
  assert.ok(!gs.mine.bullpen().includes(rp));
  assert.ok(!e.requestPitcherChange(gs.mine.roster[10]), '이미 내려간 선발은 재등판 불가');
});

test('판단 지점에서는 투구하지 않음', () => {
  const { gs, e } = newGame(75, 9);
  gs.runners[1] = gs.mine.lineup[0];
  assert.ok(e.needsDecision());
  const before = gs.pitchTotal;
  e.run(MODE.PITCH, true);
  assert.strictEqual(gs.pitchTotal, before);
  e.ackDecision();
  assert.ok(!e.needsDecision());
});

test('도루 로그에 주자 이름이 있고 성공/실패 중 하나', () => {
  let checked = 0;
  for (let g = 0; g < 60; g++) {
    const { gs, e } = newGame(72, 100 + g);
    let runner = null, guard = 0;
    while (!runner && guard++ < 500 && !gs.done) {
      e.run(MODE.PITCH);
      if (gs.top && gs.runners[0] && !gs.runners[1]) runner = gs.runners[0];
    }
    if (!runner) continue;
    assert.ok(e.requestSteal(0));
    const r = e.step();
    const t = r.lines.filter(([, x]) => x.startsWith('도루'));
    assert.strictEqual(t.length, 1);
    assert.ok(t[0][1].includes(runner.name));
    checked++;
  }
  assert.ok(checked > 0);
});

test('서비스: 경기 생성 → 끝까지 → 전적 반영', () => {
  const svc = createService(42);
  const lg = svc.dispatch('GET', '/api/league').payload;
  assert.strictEqual(lg.roster.length, 15);
  const r = svc.dispatch('POST', '/api/game', { opponent: 'NC다이노스' });
  assert.strictEqual(r.status, 200);
  const id = r.payload.state.gameId;
  const end = svc.dispatch('POST', `/api/game/${id}/advance`, { mode: 'game', ack: true });
  assert.ok(end.payload.state.done);
  assert.ok(end.payload.state.box.mine.length >= 1);
  const rec = svc.dispatch('GET', '/api/league').payload.record;
  assert.strictEqual(rec.wins + rec.losses, 1);
  assert.strictEqual(svc.dispatch('GET', '/api/game/nope').status, 404);
  assert.strictEqual(svc.dispatch('POST', `/api/game/${id}/order`, { type: 'x' }).status, 400);
});

test('서비스: 자동 진행은 판단 지점에서 멈춤', () => {
  const svc = createService(7);
  const id = svc.dispatch('POST', '/api/game', {}).payload.state.gameId;
  let paused = false;
  for (let i = 0; i < 500 && !paused; i++) {
    const b = svc.dispatch('POST', `/api/game/${id}/advance`, { mode: 'pitch', stopAtDecision: true }).payload;
    paused = b.paused;
  }
  assert.ok(paused);
});

test('밸런스: 팀당 득점이 현실 범위', () => {
  let rm = 0, ro = 0;
  const N = 600;
  for (let s = 0; s < N; s++) {
    const { gs, e } = newGame(80, 5000 + s);
    e.run(MODE.GAME);
    rm += gs.mine.score; ro += gs.theirs.score;
  }
  const avg = (rm + ro) / (2 * N);
  console.log('평균 득점/팀:', avg.toFixed(2));
  assert.ok(avg > 2.5 && avg < 5.5);
});
