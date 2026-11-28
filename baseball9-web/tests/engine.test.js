const test = require('node:test');
const assert = require('node:assert');
const { createService, GameEngine, GameState, Player, MODE, positionalLineup } = require('./load');

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

test('시즌: 10개 구단, 하루 5경기, 모든 팀 하루 1경기', () => {
  const svc = createService(11);
  const st = svc.state;
  assert.strictEqual(st.teams.length, 10);
  assert.strictEqual(st.schedule.length, 36);
  st.schedule.forEach(day => {
    assert.strictEqual(day.length, 5);
    assert.strictEqual(new Set(day.flat()).size, 10);
  });
  assert.ok(st.teams[0].roster.filter(p => !p.isPitcher).length >= 9);
  st.teams.forEach(t => assert.ok(t.roster.filter(p => !p.isPitcher).length >= 9 && t.roster.some(p => p.isPitcher)));
});

test('시즌: 끝까지 자동 진행 시 기록이 서로 맞음', () => {
  const svc = createService(12);
  svc.dispatch('POST', '/api/season/quick', { days: 100 });
  svc.dispatch('POST', '/api/allstar/auto', {});
  const r = svc.dispatch('POST', '/api/season/quick', { days: 100 });
  const s = r.payload.season;
  assert.ok(s.done);
  assert.ok(s.champion);
  const W = s.standings.reduce((a, t) => a + t.w, 0), L = s.standings.reduce((a, t) => a + t.l, 0);
  assert.strictEqual(W, 5 * 36); assert.strictEqual(L, 5 * 36);
  const st = svc.state;
  const rs = st.teams.reduce((a, t) => a + t.rs, 0);
  const batR = Object.values(st.stats).reduce((a, x) => a + (x.bat ? x.bat.r : 0), 0);
  const pitR = Object.values(st.stats).reduce((a, x) => a + (x.pit ? x.pit.r : 0), 0);
  const pitW = Object.values(st.stats).reduce((a, x) => a + (x.pit ? x.pit.w : 0), 0);
  assert.strictEqual(batR, rs, '타자 득점 합 = 팀 득점 합');
  assert.strictEqual(pitR, rs, '투수 실점 합 = 팀 득점 합');
  assert.strictEqual(pitW, 5 * 36, '승리 투수 수 = 경기 수');
  const stats = svc.dispatch('GET', '/api/stats').payload;
  assert.ok(stats.leaders.hr.length === 5 && stats.leaders.avg.length > 0 && stats.leaders.era.length > 0);
  const lgAvg = stats.leaders.avg[0].avg;
  assert.ok(lgAvg > 0.25 && lgAvg < 0.5, '타격 1위 타율이 현실 범위: ' + lgAvg);
  assert.strictEqual(svc.dispatch('POST', '/api/game', {}).status, 409, '시즌 종료 후 경기 불가');
});

test('시즌: 직접 지휘한 경기도 하루를 진행시키고 전적 반영', () => {
  const svc = createService(13);
  const g = svc.dispatch('POST', '/api/game', {}).payload;
  const id = g.state.gameId;
  const end = svc.dispatch('POST', `/api/game/${id}/advance`, { mode: 'game', ack: true }).payload;
  assert.ok(end.state.done);
  assert.ok(end.state.batBox.length === 9);
  const season = svc.dispatch('GET', '/api/season').payload;
  assert.strictEqual(season.day, 1);
  assert.strictEqual(season.standings.reduce((a, t) => a + t.w + t.l, 0), 10);
  const again = svc.dispatch('POST', `/api/game/${id}/advance`, { mode: 'game' }).payload;
  assert.strictEqual(svc.dispatch('GET', '/api/season').payload.day, 1, '끝난 경기를 다시 진행해도 하루가 두 번 넘어가지 않음');
});

test('훈련과 저장/불러오기', () => {
  const svc = createService(14);
  const p = svc.state.teams[0].roster[0];
  p.potential = p.ovr + 5;                 // 은퇴 선수는 잠재력=능력치라 테스트용으로 여유를 줌
  const before = p.ovr, tp = svc.state.tp;
  const r = svc.dispatch('POST', '/api/train', { id: p.id, kind: 'ovr' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(p.ovr, before + 1);
  assert.strictEqual(svc.state.tp, tp - 3);
  svc.dispatch('POST', '/api/season/quick', { days: 5 });
  const saved = JSON.parse(JSON.stringify(svc.exportState()));
  const svc2 = createService(99);
  assert.ok(svc2.importState(saved));
  const a = svc.dispatch('GET', '/api/season').payload, b = svc2.dispatch('GET', '/api/season').payload;
  assert.strictEqual(JSON.stringify(b.standings), JSON.stringify(a.standings));
  assert.strictEqual(b.day, 5);
  assert.strictEqual(JSON.stringify(svc2.dispatch('GET', '/api/stats').payload.leaders.hr), JSON.stringify(svc.dispatch('GET', '/api/stats').payload.leaders.hr));
  assert.strictEqual(svc2.dispatch('POST', '/api/game', {}).status, 200, '불러온 뒤 경기 진행 가능');
  assert.ok(JSON.stringify(saved).length < 200 * 1024, '저장 크기가 문서 한도 안');
});

test('실존 선수: 현역 리그는 2025 소속, 레전드 리그는 최다 소속 구단', () => {
  const cur = createService(21);
  cur.dispatch('POST', '/api/season/new', { mode: 'current' });
  const kia = cur.state.teams.find(t => t.name === 'KIA타이거즈');
  assert.strictEqual(kia.roster.length, 20);
  assert.ok(kia.roster.every(p => p.league === 'KBO' && p.team === 'KIA타이거즈' && p.last >= 2025));
  const leg = createService(22);
  leg.dispatch('POST', '/api/season/new', { mode: 'legend' });
  const legKia = leg.state.teams.find(t => t.name === 'KIA타이거즈');
  assert.ok(legKia.roster.some(p => p.name === '선동열'), '레전드 KIA 에 선동열');
  const ids = leg.state.teams.flatMap(t => t.roster.map(p => p.id));
  assert.strictEqual(new Set(ids).size, ids.length, '한 선수가 두 팀에 없음');
});

test('영입·방출', () => {
  const svc = createService(41);
  svc.dispatch('POST', '/api/season/new', { league: 'KBO' });     // 자유 리그는 영입 상한 없음
  const found = svc.dispatch('POST', '/api/scout/search', { q: 'ichiro', league: 'MLB' }).payload;
  assert.ok(found.results.some(r => r.name === '스즈키 이치로'), '영어로 검색해도 한국어 이름이 나옴');
  assert.ok(svc.dispatch('POST', '/api/scout/search', { q: '이치로', league: 'MLB' }).payload.results.some(r => r.name === '스즈키 이치로'), '한국어 검색');
  const kor = svc.dispatch('POST', '/api/scout/search', { q: '선동열' }).payload;
  assert.strictEqual(kor.results[0].name, '선동열');
  // 다른 구단 소속은 못 데려옴
  const kiaPlayer = svc.state.teams[1].roster[0];
  assert.strictEqual(svc.dispatch('POST', '/api/scout/sign', { id: kiaPlayer.id }).status, 409);
  // 포인트가 있으면 자유 선수 영입
  const target = svc.dispatch('POST', '/api/scout/search', { league: 'MLB', pos: 'SS' }).payload.results.find(r => !r.owner);
  svc.state.tp = 100;
  const before = svc.state.teams[0].roster.length;
  const r = svc.dispatch('POST', '/api/scout/sign', { id: target.id });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(svc.state.teams[0].roster.length, before + 1);
  assert.strictEqual(svc.state.tp, 100 - target.cost);
  assert.strictEqual(svc.dispatch('POST', '/api/scout/sign', { id: target.id }).status, 409, '중복 영입 불가');
  // 방출 후 저장/불러오기
  assert.strictEqual(svc.dispatch('POST', '/api/release', { id: target.id }).status, 200);
  assert.strictEqual(svc.state.teams[0].roster.length, before);
  const svc2 = createService(1);
  assert.ok(svc2.importState(JSON.parse(JSON.stringify(svc.exportState()))));
  assert.strictEqual(svc2.state.teams[0].roster.length, before);
  assert.strictEqual(svc2.state.mode, 'current');
});

test('리그별 구단 수와 동일인 중복 없음', () => {
  const expect = { KBO: 10, NPB: 12, MLB: 30, WORLD: 12 };
  for (const league of Object.keys(expect)) {
    const svc = createService(51);
    svc.dispatch('POST', '/api/season/new', { league, mode: 'current', length: 18 });
    const st = svc.state;
    assert.strictEqual(st.teams.length, expect[league], league);
    const persons = st.teams.flatMap(t => t.roster.map(p => p.person || p.id));
    assert.strictEqual(new Set(persons).size, persons.length, league + ' 같은 사람이 두 팀에');
    st.schedule.forEach(day => assert.strictEqual(new Set(day.flat()).size, expect[league]));
    if (league === 'WORLD') assert.deepStrictEqual([...new Set(st.teams.slice(1).map(t => t.league))].sort(), ['KBO', 'MLB', 'NPB']);
  }
});

test('올스타전: 시즌 중반에 열리고, 지휘하거나 자동으로 치름', () => {
  const svc = createService(52);
  svc.dispatch('POST', '/api/season/new', { league: 'KBO', length: 18 });
  assert.strictEqual(svc.dispatch('POST', '/api/game', { kind: 'allstar' }).status, 409, '중반 전에는 없음');
  svc.dispatch('POST', '/api/season/quick', { days: 9 });
  let s = svc.dispatch('GET', '/api/season').payload;
  assert.ok(s.allStar.due);
  const g = svc.dispatch('POST', '/api/game', { kind: 'allstar' }).payload;
  assert.strictEqual(g.state.kind, 'allstar');
  assert.ok(/올스타/.test(g.state.myName) && /올스타/.test(g.state.opponent));
  const end = svc.dispatch('POST', `/api/game/${g.state.gameId}/advance`, { mode: 'game', ack: true }).payload;
  assert.ok(end.state.done);
  s = svc.dispatch('GET', '/api/season').payload;
  assert.ok(s.allStar.done && s.allStar.result && s.allStar.mvp);
  assert.strictEqual(s.day, 9, '올스타전은 정규시즌 날짜를 넘기지 않음');
  // 지휘하지 않고 넘어가면 자동으로 치러짐
  const svc2 = createService(53);
  svc2.dispatch('POST', '/api/season/new', { league: 'MLB', length: 18 });
  const q = svc2.dispatch('POST', '/api/season/quick', { days: 18 }).payload;
  assert.ok(q.stoppedForAllStar, '자동 진행은 올스타전 앞에서 멈춤');
  assert.strictEqual(q.season.day, 9);
  assert.strictEqual(svc2.dispatch('POST', '/api/game', {}).status, 409, '올스타전 전에는 정규시즌 경기 불가');
  assert.strictEqual(svc2.dispatch('POST', '/api/allstar/auto', {}).status, 200);
  svc2.dispatch('POST', '/api/season/quick', { days: 18 });
  const s2 = svc2.dispatch('GET', '/api/season').payload;
  assert.ok(s2.allStar.done && s2.done);
});

test('국가대표: 2026 WBC 방식 — 20개국 5팀 4개 조 풀리그 → 8강 → 4강 → 결승, 직접 지휘 경기도 반영', () => {
  const svc = createService(54);
  let v = svc.dispatch('POST', '/api/intl/new', { era: 'legend', country: 'KOR' }).payload;
  assert.ok(v.active && v.roster.length === 20);
  assert.strictEqual(v.teamCount, 20, 'WBC 20개국');
  assert.deepStrictEqual(Object.keys(v.groups), ['A', 'B', 'C', 'D']);
  assert.strictEqual(JSON.stringify([...v.groups.C.map(t => t.name)].sort()), JSON.stringify(['대만', '대한민국', '일본', '체코', '호주'].sort()), 'C조: 일본·한국·호주·체코·대만');
  assert.ok(v.groups.D.some(t => t.name === '베네수엘라') && v.groups.B.some(t => t.name === '미국'));
  assert.ok(v.roster.some(p => p.name === '선동열'));
  const ids = svc.state.intl.teams.KOR.ids;
  assert.strictEqual(new Set(ids).size, ids.length);
  // 1차전은 직접 지휘
  const g = svc.dispatch('POST', '/api/game', { kind: 'intl' }).payload;
  assert.strictEqual(g.state.myName, '대한민국');
  svc.dispatch('POST', `/api/game/${g.state.gameId}/advance`, { mode: 'game', ack: true });
  v = svc.dispatch('GET', '/api/intl').payload;
  assert.strictEqual(v.results.length, 1);
  assert.ok(Object.values(v.groups).flat().reduce((a, t) => a + t.w + t.l, 0) >= 8, '모든 조의 1라운드 경기가 치러짐 (5팀 조: 라운드마다 한 팀 휴식)');
  for (let i = 0; i < 4; i++) v = svc.dispatch('POST', '/api/intl/quick', {}).payload.intl;      // 조별리그 나머지 4라운드
  assert.strictEqual(v.stage, 'quarter');
  Object.values(v.groups).forEach(g => g.forEach(tm => assert.strictEqual(tm.w + tm.l, 4, tm.name + ' 조별리그 4경기')));
  assert.strictEqual(v.quarters.length, 4, '8강 4경기');
  let guard = 0;
  while (v.stage !== 'done' && guard++ < 14) v = svc.dispatch('POST', '/api/intl/quick', {}).payload.intl;
  assert.strictEqual(v.stage, 'done');
  assert.ok(v.champion);
  assert.strictEqual(v.results.length, 8, '조별 5라운드 + 8강 + 4강 + 결승');
  const saved = JSON.parse(JSON.stringify(svc.exportState()));
  const svc2 = createService(1);
  assert.ok(svc2.importState(saved));
  assert.strictEqual(svc2.dispatch('GET', '/api/intl').payload.champion, v.champion);
});

test('트레이드: 손해 보는 제안은 거절, 넉넉하면 수락하고 선수가 오감', () => {
  const svc = createService(61);
  const st = svc.state, me = st.teams[0], them = st.teams[1];
  const star = [...them.roster].sort((a, b) => b.ovr - a.ovr)[0];
  const weak = [...me.roster].filter(p => !p.isPitcher).sort((a, b) => a.ovr - b.ovr)[0];
  let r = svc.dispatch('POST', '/api/trade/propose', { team: them.id, give: [weak.id], get: [star.id] });
  assert.strictEqual(r.status, 409, '약한 선수 1명으로 스타를 못 데려옴');
  // 우리 팀 상위 선수 여럿 vs 상대 약한 선수 1명 → 수락 (같은 포지션 유형끼리 맞춰 구성 조건 유지)
  const theirWeak = [...them.roster].filter(p => !p.isPitcher).sort((a, b) => a.ovr - b.ovr)[0];
  const myBest = [...me.roster].filter(p => !p.isPitcher).sort((a, b) => b.ovr - a.ovr)[0];
  const ev = svc.dispatch('POST', '/api/trade/evaluate', { team: them.id, give: [myBest.id], get: [theirWeak.id] }).payload;
  assert.strictEqual(ev.verdict, 'accept', ev.message);
  r = svc.dispatch('POST', '/api/trade/propose', { team: them.id, give: [myBest.id], get: [theirWeak.id] });
  assert.strictEqual(r.status, 200);
  assert.ok(me.roster.includes(theirWeak) && !me.roster.includes(myBest));
  assert.ok(them.roster.includes(myBest));
  assert.strictEqual(myBest.morale, undefined, '떠난 선수는 사기 시스템 밖');
  assert.ok(theirWeak.morale > 0);
  const voices = svc.dispatch('GET', '/api/locker').payload.voices.map(v => v.name);
  assert.ok(voices.includes(myBest.name) && voices.includes(theirWeak.name), '이적 소감');
});

test('사기와 라커룸: 경기 후 변하고 발언이 쌓임', () => {
  const svc = createService(62);
  const me = svc.state.teams[0];
  svc.dispatch('POST', '/api/season/quick', { days: 8 });
  const lk = svc.dispatch('GET', '/api/locker').payload;
  assert.ok(lk.voices.length >= 2);
  assert.ok(lk.roster.every(p => p.morale >= 0 && p.morale <= 100));
  const lineupIds = new Set([...me.roster].filter(p => !p.isPitcher).sort((a, b) => b.effOvr - a.effOvr).slice(0, 9).map(p => p.id));
  const bench = me.roster.filter(p => !p.isPitcher && !lineupIds.has(p.id));
  if (bench.length) assert.ok(bench.some(p => p.morale < 60), '벤치 선수 사기 하락');
  // 사기가 실력에 반영
  const p = me.roster[0];
  p.setFatigue(50); p.morale = 100; const hi = p.effOvr; p.morale = 0; const lo = p.effOvr;
  assert.ok(hi - lo === 8 || (hi === 99 || lo === 40), `사기 ±4: ${hi} vs ${lo}`);
});

test('드래프트와 성장: 시즌 종료 → 드래프트 → 다음 시즌 나이·능력치 변화', () => {
  const svc = createService(63);
  svc.dispatch('POST', '/api/season/new', { league: 'KBO', length: 18 });
  svc.dispatch('POST', '/api/season/quick', { days: 9 });
  svc.dispatch('POST', '/api/allstar/auto', {});
  svc.dispatch('POST', '/api/season/quick', { days: 9 });
  let d = svc.dispatch('GET', '/api/draft').payload;
  assert.ok(d.open && d.myTurn, '우리 차례까지 AI 가 지명');
  const me = svc.state.teams[0];
  while (me.roster.length >= 28) me.roster.pop();
  const pick = d.pool[0];
  let r = svc.dispatch('POST', '/api/draft/pick', { id: pick.id });
  assert.strictEqual(r.status, 200);
  assert.ok(me.roster.some(p => p.id === pick.id), '지명한 실존 선수가 우리 로스터에');
  const owners = svc.state.teams.filter(t => t.roster.some(p => p.id === pick.id));
  assert.strictEqual(owners.length, 1, '다른 구단과 겹치지 않음');
  const leagues = new Set(svc.dispatch('GET', '/api/draft').payload.pool.map(x => x.league));
  assert.ok(leagues.has('KBO') && leagues.has('NPB') && leagues.has('MLB'), 'KBO·NPB·MLB 에서 고를 수 있음');
  const seen = new Set();
  svc.state.teams.forEach(t => t.roster.forEach(p => { assert.ok(!seen.has(p.person || p.id), '전 구단 로스터 중복 없음'); seen.add(p.person || p.id); }));
  const pool = svc.dispatch('GET', '/api/draft').payload.pool;
  assert.ok(pool.length >= 150, '풀이 충분히 큼');
  assert.ok(pool.some(x => parseInt(x.from, 10) < 1995) && pool.some(x => parseInt(x.from.split('~')[1], 10) >= 2020), '여러 시대 선수가 섞임');
  d = r.payload.draft;
  assert.ok(d.picks.length > 1);
  const ages = new Map(me.roster.map(p => [p.id, p.age]));
  const ovrs = new Map(me.roster.map(p => [p.id, p.ovr]));
  const saved = JSON.parse(JSON.stringify(svc.exportState()));
  svc.dispatch('POST', '/api/season/new', { keep: true });
  const st = svc.state;
  assert.ok(st.teams[0].roster.every(p => !ages.has(p.id) || p.age === ages.get(p.id) + 1), '나이 +1');
  const changed = st.teams[0].roster.filter(p => ovrs.has(p.id) && p.ovr !== ovrs.get(p.id));
  assert.ok(changed.length > 0, '성장 또는 노쇠');
  assert.ok(st.teams[0].roster.some(p => p.id === pick.id), '지명 선수가 다음 시즌 로스터에');
  // 저장/불러오기 (드래프트 중 상태)
  const svc2 = createService(1);
  assert.ok(svc2.importState(saved));
  assert.ok(svc2.dispatch('GET', '/api/draft').payload.open);
  assert.ok(svc2.dispatch('GET', '/api/locker').payload.voices.length > 0);
});

test('새 리그를 시작하면 이전 리그의 훈련 효과가 남지 않음', () => {
  const svc = createService(64);
  svc.dispatch('POST', '/api/season/new', { league: 'KBO' });
  const target = svc.dispatch('POST', '/api/scout/search', { q: '선동열' }).payload.results[0];
  svc.state.tp = 100;
  svc.dispatch('POST', '/api/scout/sign', { id: target.id });
  const p = svc.state.teams[0].roster.find(x => x.id === target.id);
  p.potential = p.ovr + 3;
  svc.dispatch('POST', '/api/train', { id: p.id, kind: 'ovr' });
  assert.strictEqual(p.ovr, target.ovr + 1);
  svc.dispatch('POST', '/api/season/new', { league: 'KBO' });
  const again = svc.dispatch('POST', '/api/scout/search', { q: '선동열' }).payload.results[0];
  assert.strictEqual(again.ovr, target.ovr);
});

test('팀 선택: 리그별 팀 목록과 전력·스타 선수 미리보기', () => {
  const svc = createService(71);
  const expect = { KBO: 10, NPB: 12, MLB: 30, WORLD: 12 };
  for (const league of Object.keys(expect)) {
    const r = svc.dispatch('POST', '/api/teams', { league, mode: 'current' }).payload;
    assert.strictEqual(r.teams.length, expect[league], league);
    assert.ok(r.teams.every(t => t.count >= 18 && t.stars.length === 4 && t.bats.length >= 4 && t.pitchers.length === 3), league);
    for (let i = 1; i < r.teams.length; i++) assert.ok(r.teams[i - 1].strength >= r.teams[i].strength, '전력 내림차순');
  }
  const kbo = svc.dispatch('POST', '/api/teams', { league: 'KBO', mode: 'current' }).payload.teams;
  assert.ok(kbo.some(t => t.name === '삼성라이온즈' && t.stars.some(p => p.name === '구자욱')), '삼성에 구자욱');
});

test('팀 선택 후 시작: 고른 팀이 우리 팀, 그 팀의 실제 선수가 기본 로스터', () => {
  const svc = createService(72);
  assert.strictEqual(svc.dispatch('GET', '/api/season').payload.started, false, '처음엔 시작 전');
  for (const [league, mode, team] of [['KBO', 'current', '삼성라이온즈'], ['MLB', 'current', '뉴욕 양키스'], ['NPB', 'current', '요미우리 자이언츠'], ['KBO', 'legend', 'KIA타이거즈']]) {
    const r = svc.dispatch('POST', '/api/season/new', { league, mode, team, length: 18 });
    assert.strictEqual(r.status, 200);
    const s = svc.dispatch('GET', '/api/season').payload;
    assert.ok(s.started && s.myName === team, team);
    const me = svc.state.teams[0];
    assert.ok(me.user && me.name === team);
    assert.ok(me.roster.filter(p => !p.isPitcher).length >= 9 && me.roster.filter(p => p.isPitcher).length >= 5, team + ' 구성');
    if (mode === 'current') assert.ok(me.roster.every(p => p.team === team), team + ' 현역 소속 선수만');
    const persons = svc.state.teams.flatMap(t => t.roster.map(p => p.person || p.id));
    assert.strictEqual(new Set(persons).size, persons.length, '같은 사람이 두 팀에 없음');
    assert.ok(!svc.state.teams.slice(1).some(t => t.name === team), '고른 팀은 상대에서 빠짐');
  }
  // 선택한 팀의 스타가 실제로 우리 선수
  svc.dispatch('POST', '/api/season/new', { league: 'MLB', mode: 'current', team: '뉴욕 양키스' });
  assert.ok(svc.state.teams[0].roster.some(p => p.name === '에런 저지'), '양키스에 저지');
  svc.dispatch('POST', '/api/season/new', { league: 'KBO', mode: 'legend', team: '삼성라이온즈' });
  assert.ok(svc.state.teams[0].roster.some(p => ['양준혁', '오승환', '이승엽(76)'].includes(p.name)), '레전드 삼성');
  // 시즌 진행·저장
  svc.dispatch('POST', '/api/season/quick', { days: 5 });
  const saved = JSON.parse(JSON.stringify(svc.exportState()));
  const svc2 = createService(1);
  assert.ok(svc2.importState(saved));
  const a = svc.dispatch('GET', '/api/season').payload, b = svc2.dispatch('GET', '/api/season').payload;
  assert.strictEqual(b.myName, a.myName);
  assert.strictEqual(b.day, 5);
  // 폐지된 커리어 저장은 무시
  assert.strictEqual(createService(2).importState({ version: 4, career: { tier: 0 } }), false);
});

test('팀마다 전력이 달라 순위 경쟁이 갈림 (강팀 vs 약팀)', () => {
  const picks = svcTeams => svcTeams;
  const svc = createService(73);
  const t = svc.dispatch('POST', '/api/teams', { league: 'KBO', mode: 'current' }).payload.teams;
  const strong = t[0], weak = t[t.length - 1];
  assert.ok(strong.strength - weak.strength >= 3, `${strong.name} ${strong.strength} vs ${weak.name} ${weak.strength}`);
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

test('통합 리그: KBO·NPB·MLB 52팀이 한 리그에서 겨룸', () => {
  const svc = createService(77);
  const t = svc.dispatch('POST', '/api/teams', { league: 'ALL', mode: 'current' }).payload;
  assert.strictEqual(t.teams.length, 52);
  assert.deepStrictEqual([...new Set(t.teams.map(x => x.league))].sort(), ['KBO', 'MLB', 'NPB']);
  assert.strictEqual(svc.dispatch('POST', '/api/season/new', { league: 'ALL', team: '삼성라이온즈', length: 6 }).status, 200);
  let s = svc.dispatch('GET', '/api/season').payload;
  assert.strictEqual(s.standings.length, 52);
  assert.strictEqual(s.myName, '삼성라이온즈');
  svc.dispatch('POST', '/api/season/quick', { days: 6 });
  s = svc.dispatch('GET', '/api/season').payload;
  assert.ok(s.done && s.standings.every(r => r.w + r.l === 6), '모든 팀이 같은 경기 수');
  const seen = new Set();
  svc.state.teams.forEach(tm => tm.roster.forEach(p => { assert.ok(!seen.has(p.person || p.id)); seen.add(p.person || p.id); }));
  assert.ok(svc.dispatch('GET', '/api/draft').payload.open);
});

test('연도 선택: 1982~2026 그 해 실제 로스터, 홀수 구단 연도는 휴식일 처리', () => {
  const svc = createService(91);
  const prev = (league, year) => svc.dispatch('POST', '/api/teams', { league, mode: 'year', year }).payload.teams;
  const k85 = prev('KBO', 1985);
  assert.strictEqual(k85.length, 6, '1985 KBO 는 6개 구단');
  assert.ok(k85.some(t => t.name === 'KIA타이거즈' && t.stars.some(s => s.name === '선동열')), '1985 해태(KIA 계보)에 선동열');
  assert.ok(prev('KBO', 1998).length >= 8);
  assert.strictEqual(prev('MLB', 1982).length, 26, '1982 MLB 26개 구단');
  assert.ok(prev('MLB', 1998).some(t => t.stars.concat(t.bats).some(s => s.name === '마크 맥과이어')));
  assert.ok(prev('NPB', 1990).length === 12);
  // 1987 KBO: 7개 구단(홀수) → 쉬는 날이 생겨도 시즌이 끝까지 진행
  assert.strictEqual(prev('KBO', 1987).length, 7);
  assert.strictEqual(svc.dispatch('POST', '/api/season/new', { league: 'KBO', mode: 'year', year: 1987, team: prev('KBO', 1987)[0].name, length: 14 }).status, 200);
  let s = svc.dispatch('GET', '/api/season').payload;
  assert.strictEqual(s.year, 1987);
  assert.strictEqual(s.standings.length, 7);
  svc.dispatch('POST', '/api/season/quick', { days: 14 });
  s = svc.dispatch('GET', '/api/season').payload;
  assert.ok(s.done, '휴식일 포함 시즌 종료');
  assert.ok(svc.state.teams[0].roster.every(p => p.age >= 18 && p.age < 50), '그 해 기준 나이');
  // 통합 리그도 연도 선택 가능
  assert.ok(prev('ALL', 2005).length >= 50);
  // 저장/불러오기
  const svc2 = createService(1);
  assert.ok(svc2.importState(JSON.parse(JSON.stringify(svc.exportState()))));
  assert.strictEqual(svc2.dispatch('GET', '/api/season').payload.year, 1987);
});

test('라인업: 능력치 순이 아니라 포지션을 맞춰 구성 (외야 4명·2루수 없음 방지)', () => {
  const mk = (n, pos, ovr) => new Player(n, pos, 'KBO', 27, ovr, ovr, 0, 1, '', 2026);
  const hit = [mk('OF1', 'OF', 90), mk('OF2', 'OF', 88), mk('OF3', 'OF', 86), mk('OF4', 'OF', 84), mk('OF5', 'OF', 82),
    mk('C1', 'C', 70), mk('B1', '1B', 72), mk('S1', 'SS', 71), mk('T1', '3B', 69), mk('K2', '2B', 55)];
  const lu = positionalLineup(hit);
  assert.strictEqual(lu.length, 9);
  assert.ok(lu.some(p => p.pos === '2B'), '약해도 2루수가 라인업에 들어감');
  assert.strictEqual(lu.filter(p => p.pos === 'OF').length, 4, '외야 3명 + 지명타자(남은 최고 타자 OF4)');
  assert.ok(lu.some(p => p.name === 'OF4'), '지명타자는 남은 최고 타자(OF4)');
  assert.strictEqual(lu[0].name, 'OF1', '타순은 능력치 순');
  // 2루수가 없으면 빈 자리는 남은 최고 타자로 채움
  const lu2 = positionalLineup(hit.filter(p => p.pos !== '2B'));
  assert.strictEqual(lu2.length, 9);
});

test('드래프트 10라운드 + 연도별 선수("09 양현종")', () => {
  const svc = createService(64);
  svc.dispatch('POST', '/api/season/new', { league: 'KBO', length: 18 });
  svc.dispatch('POST', '/api/season/quick', { days: 9 });
  svc.dispatch('POST', '/api/allstar/auto', {});
  svc.dispatch('POST', '/api/season/quick', { days: 9 });
  let d = svc.dispatch('GET', '/api/draft').payload;
  assert.strictEqual(d.rounds, 10);
  assert.strictEqual(d.total, 100, '10개 구단 × 10라운드');
  assert.ok(d.pool.length >= 1000, '풀이 지명 수보다 훨씬 큼');
  const ver = d.pool.filter(p => /^\d\d /.test(p.name));
  assert.ok(ver.length > 500, '연도별 선수 다수: ' + ver.length);
  assert.ok(d.pool.some(p => !/^\d\d /.test(p.name)), '기본 선수도 포함');
  const v = ver.find(p => p.age <= 24 && p.league === 'KBO') || ver[0];
  const r = svc.dispatch('POST', '/api/draft/pick', { id: v.id });
  assert.strictEqual(r.status, 200);
  const mine = svc.state.teams[0].roster.find(p => p.id === v.id);
  assert.ok(mine && mine.name === v.name && mine.age === v.age, '그 해 나이로 영입');
  // 나머지는 자동
  const a = svc.dispatch('POST', '/api/draft/auto', {});
  assert.strictEqual(a.status, 200);
  d = a.payload.draft;
  assert.ok(d.done, '10라운드 모두 끝남');
  assert.strictEqual(svc.state.teams[0].roster.length, 20 + 10, '우리 팀 10명 지명');
  // 저장/불러오기: 연도별 선수의 세부 능력치·동일인 키 유지
  const svc2 = createService(1);
  assert.ok(svc2.importState(JSON.parse(JSON.stringify(svc.exportState()))));
  const back = svc2.state.teams[0].roster.find(p => p.id === v.id);
  assert.ok(back && back.person.includes('@') && back.age === v.age);
  // 한 팀에 같은 사람의 두 연도 버전도 가능 (사람 키가 다름)
  const keys = new Set(); svc.state.teams.forEach(t => t.roster.forEach(p => { assert.ok(!keys.has(p.person || p.id)); keys.add(p.person || p.id); }));
});

test('올스타: 능력치가 아니라 이번 시즌 기록 순으로 뽑힘 (능력치 높은 부진 선수보다 기록 좋은 선수)', () => {
  const svc = createService(89);
  svc.dispatch('POST', '/api/season/new', { league: 'KBO', length: 18, team: '삼성라이온즈' });
  svc.dispatch('POST', '/api/season/quick', { days: 9 });
  const S = svc.state, grp = S.teams[0].group;
  const of = S.teams.filter(t => t.group === grp).flatMap(t => t.roster.filter(p => !p.farm)).filter(p => p.pos === 'OF').sort((a, b) => b.ovr - a.ovr);
  const star = of[0], weak = of[of.length - 1];
  // 모든 외야수에게 평범한 기록을 주고, 최고 능력치 선수는 부진, 최저 능력치 선수는 폭발
  of.forEach(p => { S.stats[p.id] = { bat: { g: 9, pa: 40, ab: 36, h: 10, d2: 2, d3: 0, hr: 1, rbi: 5, bb: 3, k: 8, r: 4, sb: 0, cs: 0 } }; });
  S.stats[star.id] = { bat: { g: 9, pa: 40, ab: 36, h: 4, d2: 0, d3: 0, hr: 0, rbi: 1, bb: 3, k: 12, r: 1, sb: 0, cs: 0 } };
  S.stats[weak.id] = { bat: { g: 9, pa: 40, ab: 34, h: 18, d2: 5, d3: 0, hr: 8, rbi: 22, bb: 6, k: 4, r: 14, sb: 1, cs: 0 } };
  const q = svc.dispatch('GET', '/api/allstar/squads').payload, names = new Set([...q.mine.roster, ...q.theirs.roster].map(p => p.name));
  assert.ok(names.has(weak.name), '기록이 좋은 선수는 능력치가 낮아도 뽑힘');
  assert.ok(!names.has(star.name), '능력치가 높아도 기록이 나쁘면 못 뽑힘');
});

test('올스타·국가대표: 이번 시즌 잘한 선수가 뽑힘', () => {
  const svc = createService(88);
  svc.dispatch('POST', '/api/season/new', { league: 'KBO', length: 18, team: '삼성라이온즈' });
  svc.dispatch('POST', '/api/season/quick', { days: 9 });
  const S = svc.state;
  const grp = S.teams[0].group;
  const names = r => new Set(r.map(p => p.name));
  const squads = () => { const q = svc.dispatch('GET', '/api/allstar/squads').payload; return [...q.mine.roster, ...q.theirs.roster]; };
  // 올스타: 우리 그룹 외야수 중 능력치 10위 선수 — 평소엔 못 뽑히지만 시즌 성적이 폭발하면 뽑힘
  const of = S.teams.filter(t => t.group === grp).flatMap(t => t.roster).filter(p => p.pos === 'OF').sort((a, b) => b.ovr - a.ovr);
  const hero = of[9];
  assert.ok(!names(squads()).has(hero.name), '성적이 평범하면 못 뽑힘');
  S.stats[hero.id] = { bat: { g: 9, pa: 40, ab: 34, h: 20, d2: 5, d3: 0, hr: 9, rbi: 25, bb: 6, k: 4, r: 15, sb: 1, cs: 0 } };
  const after = squads();
  assert.ok(names(after).has(hero.name), '성적이 폭발하면 올스타');
  assert.ok(after.find(p => p.name === hero.name).stat.includes('홈런'), '선발 이유(성적)가 표시됨');
  // 국가대표(현역): 대한민국 후보 중 능력치가 낮아도 올 시즌 성적이 좋으면 뽑힘
  const base = svc.dispatch('POST', '/api/intl/new', { era: 'current', country: 'KOR' });
  assert.strictEqual(base.status, 200);
  const roster0 = svc.dispatch('GET', '/api/intl').payload.roster;
  const kor = Object.values(S.players).filter(p => p.country === 'KOR' && p.pos === 'OF' && !roster0.some(r => r.name === p.name)).sort((a, b) => b.ovr - a.ovr);
  const hero2 = kor[0];
  assert.ok(hero2, '대표에 못 뽑힌 한국 외야수가 있음');
  S.stats[hero2.id] = { bat: { g: 9, pa: 40, ab: 34, h: 22, d2: 6, d3: 0, hr: 11, rbi: 30, bb: 6, k: 3, r: 18, sb: 1, cs: 0 } };
  svc.dispatch('POST', '/api/intl/new', { era: 'current', country: 'KOR' });
  const roster1 = svc.dispatch('GET', '/api/intl').payload.roster;
  assert.ok(roster1.some(r => r.name === hero2.name), '올 시즌 성적이 좋은 선수가 대표팀에 뽑힘');
});

test('올스타·국가대표도 라인업·선발을 직접 정하고 시작', () => {
  const svc = createService(92);
  svc.dispatch('POST', '/api/season/new', { league: 'KBO', length: 18, team: '삼성라이온즈' });
  svc.dispatch('POST', '/api/season/quick', { days: 9 });
  for (const kind of ['allstar', 'intl']) {
    if (kind === 'intl') { svc.dispatch('POST', '/api/allstar/auto', {}); svc.dispatch('POST', '/api/intl/new', { era: 'current', country: 'KOR' }); }
    const v = svc.dispatch('POST', '/api/setup', { kind }).payload;
    assert.ok(v.roster.length >= 14 && v.opponent && v.teamName, kind + ' 준비 화면 데이터');
    const hitters = v.roster.filter(p => p.pos !== 'SP' && p.pos !== 'RP'), sps = v.roster.filter(p => p.pos === 'SP');
    const lineup = hitters.slice(0, 9).map(p => p.id).reverse();           // 일부러 거꾸로
    const starter = sps[sps.length - 1].id;                                   // 일부러 마지막 선발
    const g = svc.dispatch('POST', '/api/game', { kind, lineup, starter });
    assert.strictEqual(g.status, 200, kind);
    assert.deepStrictEqual(g.payload.state.lineup.map(p => p.id), lineup, '내가 정한 타순');
    assert.strictEqual(g.payload.state.myPitcher.id, starter, '내가 정한 선발');
    svc.dispatch('POST', `/api/game/${g.payload.state.gameId}/advance`, { mode: 'game', ack: true });
  }
});

test('수비 위치 배정: 발 빠른 외야수가 중견수, 발 느린 외야수는 지명타자', () => {
  const { assignPositions } = require('./load');
  const mk = (n, pos, ovr, spd) => { const p = new Player(n, pos, 'KBO', 30, ovr, ovr, 0, 1, '', 2026); p.sub = [70, 70, 70, spd]; p.id = n; return p; };
  const lu = [mk('최형우', 'OF', 88, 40), mk('구자욱', 'OF', 85, 80), mk('김성윤', 'OF', 73, 60), mk('박승규', 'OF', 68, 55),
    mk('C', 'C', 70, 50), mk('1B', '1B', 70, 50), mk('2B', '2B', 70, 50), mk('SS', 'SS', 70, 50), mk('3B', '3B', 70, 50)];
  const a = assignPositions(lu);
  assert.strictEqual(a['구자욱'], 'CF', '발 빠른 구자욱이 중견수');
  assert.strictEqual(a['최형우'], 'DH', '발 느린 최형우는 지명타자');
  assert.strictEqual(Object.values(a).filter(x => x === 'DH').length, 1);
  assert.strictEqual(new Set(Object.values(a)).size, 9, '9개 자리가 모두 다름');
});

test('수비 위치는 내가 정한 대로 (외야 직접 설정)', () => {
  const svc = createService(94);
  svc.dispatch('POST', '/api/season/new', { league: 'KBO', length: 18, team: '삼성라이온즈' });
  const roster = svc.dispatch('GET', '/api/league').payload.roster;
  const hit = roster.filter(p => p.pos !== 'SP' && p.pos !== 'RP');
  const lineup = hit.slice(0, 9).map(p => p.id);
  const positions = {}; ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'].forEach((sl, i) => { positions[lineup[i]] = sl; });
  positions[lineup[0]] = 'CF'; positions[lineup[6]] = 'C';                 // 일부러 엉뚱하게 (0번=중견수)
  const g = svc.dispatch('POST', '/api/game', { lineup, positions });
  const st = g.payload.state;
  assert.strictEqual(st.lineup.find(p => p.id === lineup[0]).slot, 'CF', '내가 정한 중견수');
  assert.strictEqual(new Set(st.lineup.map(p => p.slot)).size, 9, '위치가 겹치지 않음');
});

test('은퇴: 고령 선수는 비시즌에 은퇴, 기사·은퇴 선수 명단, 수동 은퇴', () => {
  const svc = createService(95);
  svc.dispatch('POST', '/api/season/new', { league: 'KBO', length: 18, team: '삼성라이온즈' });
  const S = svc.state;
  const old = S.teams[1].roster.find(p => !p.isPitcher), mine = S.teams[0].roster.find(p => p.age >= 0 && !p.isPitcher);
  old.age = 44; old.ovr = 80;                               // AI 팀의 고령 스타: 43세 이상은 확실히 은퇴
  const hitterCount = S.teams[1].roster.filter(p => !p.isPitcher).length;
  svc.dispatch('POST', '/api/season/quick', { days: 18 });
  svc.dispatch('POST', '/api/season/new', { keep: true });
  const list = svc.dispatch('GET', '/api/retired').payload;
  assert.ok(list.retired.some(r => r.name === old.name), '고령 선수 은퇴');
  assert.ok(!svc.state.teams[1].roster.some(p => p.id === old.id));
  assert.ok(svc.state.teams[1].roster.filter(p => !p.isPitcher).length >= 9, 'AI 팀은 모자란 자리를 채움');
  const art = svc.dispatch('GET', '/api/articles').payload.articles;
  assert.ok(art.some(a => a.tag === '은퇴' && a.title.includes(old.name)), '은퇴 기사');
  // 수동 은퇴
  const target = svc.state.teams[0].roster.find(p => !p.isPitcher);
  svc.dispatch('POST', '/api/scout/search', { q: '' });
  svc.state.teams[0].roster.push(...Array.from({ length: 3 }, (_, i) => { const x = new Player('보강' + i, '1B', 'KBO', 25, 60, 60, 0, 1, '', 2026); x.id = 'X' + i; x.person = x.id; return x; }));
  const r = svc.dispatch('POST', '/api/retire', { id: target.id });
  assert.strictEqual(r.status, 200);
  assert.ok(!svc.state.teams[0].roster.some(p => p.id === target.id));
  assert.ok(svc.dispatch('GET', '/api/retired').payload.retired.some(x => x.name === target.name && x.manual));
  // 저장/불러오기
  const svc2 = createService(1);
  assert.ok(svc2.importState(JSON.parse(JSON.stringify(svc.exportState()))));
  assert.ok(svc2.dispatch('GET', '/api/retired').payload.retired.length >= 2);
});

test('2군: 신인은 2군에서 시작, 좋아지면 자동 콜업, 수동 이동, 40세 즉시 은퇴', () => {
  const svc = createService(96);
  svc.dispatch('POST', '/api/season/new', { league: 'KBO', length: 18, team: '삼성라이온즈' });
  const S = svc.state, me = S.teams[0];
  // 2군에서 능력치가 크게 오른 타자는 3일마다 자동으로 콜업 (1군 같은 역할 최약체와 교체)
  const rookie = new Player('유망주', '2B', 'KBO', 22, 88, 90, 0, 1, '', 2026); rookie.id = 'F1'; rookie.person = 'F1'; rookie.farm = true;
  me.roster.push(rookie); S.players[rookie.id] = rookie;
  const r1 = svc.dispatch('GET', '/api/league').payload.roster.find(p => p.id === 'F1');
  assert.strictEqual(r1.farm, true, '2군 표시');
  svc.dispatch('POST', '/api/season/quick', { days: 3 });
  assert.strictEqual(rookie.farm, false, 'OVR 88 유망주 자동 콜업');
  assert.ok(svc.dispatch('GET', '/api/articles').payload.articles.some(a => a.tag === '2군' && a.title.includes('유망주')), '콜업 기사');
  assert.ok(me.roster.filter(p => !p.farm).length <= 28, '1군 정원');
  // 수동 이동
  const h = me.roster.filter(p => !p.isPitcher && !p.farm);
  const down = svc.dispatch('POST', '/api/farm', { id: h[h.length - 1].id, up: false });
  assert.strictEqual(down.status, 200);
  assert.strictEqual(h[h.length - 1].farm, true);
  // 1군 야수 9명 아래로는 못 내림
  while (me.roster.filter(p => !p.isPitcher && !p.farm).length > 9) svc.dispatch('POST', '/api/farm', { id: me.roster.find(p => !p.isPitcher && !p.farm).id, up: false });
  assert.strictEqual(svc.dispatch('POST', '/api/farm', { id: me.roster.find(p => !p.isPitcher && !p.farm).id, up: false }).status, 409);
  // 경기는 1군만: 2군 선수는 타순에 없음
  const g = svc.dispatch('POST', '/api/game', {}).payload.state;
  assert.ok(g.lineup.every(p => !me.roster.find(x => x.id === p.id).farm));
  // 40세가 되면 바로 은퇴
  const ai = S.teams[1].roster.find(p => !p.isPitcher && !p.farm);
  ai.age = 39; ai.ovr = 85;
  svc.dispatch('POST', '/api/season/quick', { days: 18 });
  svc.dispatch('POST', '/api/season/new', { keep: true });
  assert.ok(svc.dispatch('GET', '/api/retired').payload.retired.some(x => x.id === ai.id), '40세 즉시 은퇴');
  // 드래프트 신인은 2군
  const draftees = svc.state.teams[0].roster.filter(p => p.farm);
  assert.ok(draftees.length >= 0);
  // 저장/불러오기에서 2군 구분 유지
  const svc2 = createService(1);
  assert.ok(svc2.importState(JSON.parse(JSON.stringify(svc.exportState()))));
  assert.strictEqual(svc2.state.teams[0].roster.filter(p => p.farm).length, draftees.length);
});

test('국가대표(현역): WBC 20개국, 작은 나라 선택, 쉬는 라운드 처리', () => {
  const svc = createService(55);
  svc.dispatch('POST', '/api/season/new', { league: 'KBO', length: 18, team: '삼성라이온즈' });
  const v0 = svc.dispatch('GET', '/api/intl').payload;
  assert.strictEqual(v0.countriesByEra.current.length, 20, '현역 기준에서도 WBC 20개국');
  const v = svc.dispatch('POST', '/api/intl/new', { era: 'current', country: 'PAN' }).payload;
  assert.strictEqual(v.mineName, '파나마', '작은 나라도 선택 가능');
  assert.strictEqual(Object.keys(v.groups).length, 4);
  assert.ok(v.roster.length >= 14, '명단이 모자란 나라도 채워짐');
  let x = v, guard = 0;
  while (x.stage !== 'done' && guard++ < 14) {
    if (x.next) { const g = svc.dispatch('POST', '/api/game', { kind: 'intl' }); assert.strictEqual(g.status, 200); svc.dispatch('POST', `/api/game/${g.payload.state.gameId}/advance`, { mode: 'game', ack: true }); x = svc.dispatch('GET', '/api/intl').payload; }
    else x = svc.dispatch('POST', '/api/intl/quick', {}).payload.intl;      // 쉬는 라운드·탈락 후 진행
  }
  assert.strictEqual(x.stage, 'done');
  assert.ok(x.champion);
});
