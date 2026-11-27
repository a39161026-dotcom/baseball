// 시즌 모드 (옛날 야구9단처럼): 10개 구단 리그, 일정, 순위, 선수 시즌 기록, 훈련, 저장/불러오기
// dispatch(method, path, body) -> { status, payload }

// 구단 로스터 구성: 선발 5 + 불펜 4 + 포수 2 + 내야 4 + 외야 4 + 지명 1 = 20명
const TEAM_POS = ['SP', 'SP', 'SP', 'SP', 'SP', 'RP', 'RP', 'RP', 'RP', 'C', 'C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'OF', 'DH'];
const ROSTER_MAX = 28;
const CURRENT_YEAR = 2025;      // 데이터 마지막 시즌
const MY_TEAM = '나의 팀';

function createService(seed) {
  const rng = makeRng(seed);
  let S = null;                 // 시즌 상태
  const games = new Map();      // 진행 중인 경기
  let dirty = false;            // 저장이 필요한 변경이 있는지

  // ── 선수 DB ──
  const DB = buildAllPlayers();                 // KBO·NPB·MLB 실존 선수 전체
  const DB_BY_ID = new Map(DB.map(p => [p.id, p]));

  // 후보(OVR 내림차순)에서 포지션 틀에 맞춰 로스터를 채움. 모자라면 비슷한 역할로 보충
  function pickRoster(cands, used) {
    const sorted = [...cands].sort((a, b) => b.ovr - a.ovr);
    const roster = [];
    const take = p => { used.add(p.id); roster.push(p); };
    TEAM_POS.forEach(pos => {
      let p = sorted.find(x => !used.has(x.id) && x.pos === pos);
      if (!p && (pos === 'SP' || pos === 'RP')) p = sorted.find(x => !used.has(x.id) && x.isPitcher);
      if (!p && pos === 'OF') p = sorted.find(x => !used.has(x.id) && !x.isPitcher);
      if (!p && pos !== 'SP' && pos !== 'RP') p = sorted.find(x => !used.has(x.id) && !x.isPitcher);
      if (p) take(p);
    });
    return roster;
  }

  // ── 시즌 생성 ──
  // mode: 'current' = 2025 실제 소속 / 'legend' = 역대 최다 소속 구단
  // level: 'weak' | 'mid' | 'strong' — 상대 구단 평균 전력을 기준으로 우리 팀 강도를 정함
  function newSeason({ length = 36, level = 'mid', difficulty = 'NORMAL', keep = false, mode = 'current' } = {}) {
    let teams;
    if (keep && S) {
      teams = S.teams;                       // 다음 시즌: 선수·능력치 유지, 기록 초기화
      teams.forEach(t => { t.w = 0; t.l = 0; t.rs = 0; t.ra = 0; t.streak = ''; });
      teams.forEach(t => t.roster.forEach(p => { p.age++; p.setFatigue(0); }));
      mode = S.mode || mode;
    } else {
      DB.forEach(p => { p.setFatigue(0); });
      const used = new Set();
      const aiNames = KBO_TEAMS.slice(0, 9);
      const ai = aiNames.map((name, i) => {
        const cands = DB.filter(p => p.league === 'KBO' &&
          (mode === 'legend' ? p.most === name : (p.team === name && p.last >= CURRENT_YEAR)));
        return { id: i + 1, name, user: false, roster: pickRoster(cands, used) };
      });
      // 우리 팀: 나머지 선수(3개 리그 전체) 중, 상대 구단 평균 대비 강도 범위에서 무작위 구성
      const aiAvg = ai.reduce((a, t) => a + t.roster.reduce((x, p) => x + p.ovr, 0) / t.roster.length, 0) / ai.length;
      const [lo, hi] = { weak: [-9, -2], mid: [-3, 4], strong: [4, 11] }[level] || [-3, 4];
      const free = DB.filter(p => !used.has(p.id));
      const mine = [];
      [...TEAM_POS, 'SP', 'RP', 'OF', 'C'].forEach(pos => {
        const fits = x => !used.has(x.id) && x.ovr >= aiAvg + lo && x.ovr <= aiAvg + hi;
        let c = free.filter(x => fits(x) && x.pos === pos);
        if (!c.length) c = free.filter(x => fits(x) && x.isPitcher === (pos === 'SP' || pos === 'RP'));
        if (!c.length) return;
        const p = c[rng.randrange(c.length)];
        used.add(p.id); mine.push(p);
      });
      teams = [{ id: 0, name: MY_TEAM, user: true, roster: mine }, ...ai];
      teams.forEach(t => { t.w = 0; t.l = 0; t.rs = 0; t.ra = 0; t.streak = ''; });
    }
    const players = {};
    teams.forEach(t => t.roster.forEach(p => { players[p.id] = p; }));
    S = {
      version: 2, mode, year: keep && S ? S.year + 1 : 2026, length, difficulty, day: 0,
      teams, players, schedule: makeSchedule(teams.length, length),
      stats: {}, tp: keep && S ? S.tp : 10, recent: [], news: [], done: false, champion: null,
    };
    teams.forEach(t => updateDailyCondition(t.roster, rng));
    dirty = true;
  }

  // 원형 리그 방식: 하루 5경기, 모든 팀이 매일 1경기
  function makeSchedule(n, length) {
    const ids = [...Array(n).keys()], days = [];
    for (let d = 0; d < length; d++) {
      const round = d % (n - 1);
      const rot = [ids[0], ...ids.slice(1).map((_, i) => ids[1 + ((i + round) % (n - 1))])];
      const day = [];
      for (let i = 0; i < n / 2; i++) {
        const a = rot[i], b = rot[n - 1 - i];
        day.push(d % 2 === 0 ? [a, b] : [b, a]);
      }
      days.push(day);
    }
    return days;
  }

  const team = id => S.teams[id];
  const myTeam = () => S.teams[0];
  function todayMatch() {
    if (S.done) return null;
    const m = S.schedule[S.day].find(([a, b]) => a === 0 || b === 0);
    return m[0] === 0 ? m[1] : m[0];
  }

  // ── 라인업/선발 ──
  const hitters = t => t.roster.filter(p => !p.isPitcher);
  const autoLineup = t => [...hitters(t)].sort((a, b) => b.effOvr - a.effOvr).slice(0, 9);
  function pickStarter(t) {
    const sps = t.roster.filter(p => p.pos === 'SP').sort((a, b) => a.fatigue - b.fatigue);
    if (sps.length && sps[0].fatigue <= 55) return sps[0];
    return [...t.roster.filter(p => p.isPitcher)].sort((a, b) => a.fatigue - b.fatigue)[0];
  }

  function buildGame(homeT, awayT, { lineup, starter, difficulty } = {}) {
    // 엔진에서는 항상 "mine"=먼저 공격(초), "theirs"=나중 공격(말). 사용자 팀은 언제나 mine.
    const gs = new GameState(homeT.name, awayT.name);
    gs.mine.lineup = lineup || autoLineup(homeT);
    gs.mine.roster = [...homeT.roster];
    gs.mine.pitcher = starter || pickStarter(homeT);
    gs.theirs.lineup = autoLineup(awayT);
    gs.theirs.roster = [...awayT.roster];
    gs.theirs.pitcher = pickStarter(awayT);
    return new GameEngine(gs, { seed: rng.randrange(2 ** 31), difficulty: difficulty || 'NORMAL' });
  }

  // ── 경기 결과 반영 ──
  function batStat(id) {
    return S.stats[id] && S.stats[id].bat || ((S.stats[id] = S.stats[id] || {}).bat = { g: 0, pa: 0, ab: 0, h: 0, d2: 0, d3: 0, hr: 0, rbi: 0, bb: 0, k: 0, r: 0 });
  }
  function pitStat(id) {
    return S.stats[id] && S.stats[id].pit || ((S.stats[id] = S.stats[id] || {}).pit = { g: 0, gs: 0, outs: 0, h: 0, r: 0, bb: 0, k: 0, w: 0, l: 0, pitches: 0 });
  }

  function recordGame(engine, tA, tB) {
    const gs = engine.gs;
    const sides = [[gs.mine, tA], [gs.theirs, tB]];
    // 타자 기록
    engine.bat.forEach((b, id) => {
      const s = batStat(id);
      s.g++;
      ['pa', 'ab', 'h', 'd2', 'd3', 'hr', 'rbi', 'bb', 'k', 'r'].forEach(k => { s[k] += b[k]; });
    });
    // 투수 기록 + 승패 투수
    const aWin = gs.mine.score > gs.theirs.score;
    sides.forEach(([ts], idx) => {
      ts.pitcherLines.forEach((l, i) => {
        const s = pitStat(l.pitcher.id);
        s.g++; if (i === 0) s.gs++;
        s.outs += l.outs; s.h += l.hits; s.r += l.runs; s.bb += l.walks; s.k += l.strikeouts; s.pitches += l.pitches;
      });
      const won = idx === 0 ? aWin : !aWin;
      const lines = ts.pitcherLines;
      let dec;
      if (won) dec = lines[0].outs >= 15 ? lines[0] : [...lines].sort((a, b) => b.outs - a.outs)[0];
      else dec = [...lines].sort((a, b) => b.runs - a.runs)[0];
      if (won) pitStat(dec.pitcher.id).w++; else pitStat(dec.pitcher.id).l++;
    });
    // 팀 성적
    tA.rs += gs.mine.score; tA.ra += gs.theirs.score;
    tB.rs += gs.theirs.score; tB.ra += gs.mine.score;
    const [win, lose] = aWin ? [tA, tB] : [tB, tA];
    win.w++; lose.l++;
    win.streak = win.streak.startsWith('W') ? 'W' + (Number(win.streak.slice(1)) + 1) : 'W1';
    lose.streak = lose.streak.startsWith('L') ? 'L' + (Number(lose.streak.slice(1)) + 1) : 'L1';
    // 피로도
    applyPostGameFatigue(gs.mine, rng);
    applyPostGameFatigue(gs.theirs, rng);
  }

  // 사용자 경기가 끝나면 그날 나머지 경기를 모두 진행하고 다음 날로
  function finishDay(userEngine) {
    const opp = team(todayMatch());
    const mine = myTeam(), gs = userEngine.gs;
    recordGame(userEngine, mine, opp);
    const win = gs.mine.score > gs.theirs.score;
    S.recent.push({ day: S.day + 1, opponent: opp.name, result: win ? '승' : '패', score: `${gs.mine.score}:${gs.theirs.score}` });
    S.recent = S.recent.slice(-10);
    S.tp += win ? 3 : 2;                       // 훈련 포인트
    const news = [];
    S.schedule[S.day].forEach(([a, b]) => {
      if (a === 0 || b === 0) return;
      const e = buildGame(team(a), team(b));
      e.autoMine = true;
      e.run(MODE.GAME);
      recordGame(e, team(a), team(b));
      news.push(`${team(a).name} ${e.gs.mine.score} : ${e.gs.theirs.score} ${team(b).name}`);
    });
    S.news = news;
    S.teams.forEach(t => updateDailyCondition(t.roster, rng));
    S.day++;
    if (S.day >= S.length) {
      S.done = true;
      S.champion = standings()[0].name;
    }
    dirty = true;
  }

  // ── 조회 ──
  function standings() {
    const rows = S.teams.map(t => ({ id: t.id, name: t.name, user: t.user, w: t.w, l: t.l, rs: t.rs, ra: t.ra, streak: t.streak,
      pct: t.w + t.l ? t.w / (t.w + t.l) : 0 }));
    rows.sort((a, b) => b.pct - a.pct || (b.rs - b.ra) - (a.rs - a.ra));
    const top = rows[0];
    rows.forEach((r, i) => { r.rank = i + 1; r.gb = ((top.w - r.w) + (r.l - top.l)) / 2; });
    return rows;
  }

  function teamOfPlayer(id) { return S.teams.find(t => t.roster.some(p => p.id === id)); }

  function batRow(p) {
    const s = (S.stats[p.id] || {}).bat;
    if (!s) return null;
    const avg = s.ab ? s.h / s.ab : 0;
    const obp = s.pa ? (s.h + s.bb) / s.pa : 0;
    const slg = s.ab ? (s.h + s.d2 + 2 * s.d3 + 3 * s.hr) / s.ab : 0;
    return { id: p.id, name: p.name, pos: p.pos, team: (teamOfPlayer(p.id) || {}).name, ...s, avg, ops: obp + slg };
  }
  function pitRow(p) {
    const s = (S.stats[p.id] || {}).pit;
    if (!s) return null;
    const ip = s.outs / 3;
    return { id: p.id, name: p.name, pos: p.pos, team: (teamOfPlayer(p.id) || {}).name, ...s,
      ip: `${Math.floor(s.outs / 3)}.${s.outs % 3}`, era: ip ? (s.r * 9) / ip : null };
  }

  function statsView() {
    const gamesPlayed = Math.max(1, S.day);
    const allP = Object.values(S.players);
    const bats = allP.map(batRow).filter(Boolean);
    const pits = allP.map(pitRow).filter(Boolean);
    const qualBat = bats.filter(b => b.pa >= gamesPlayed * 2.5);
    const qualPit = pits.filter(p => p.outs >= gamesPlayed * 2.4);
    const top = (arr, key, desc = true, n = 5) => [...arr].sort((a, b) => desc ? b[key] - a[key] : a[key] - b[key]).slice(0, n);
    return {
      leaders: {
        avg: top(qualBat, 'avg'), hr: top(bats, 'hr'), rbi: top(bats, 'rbi'), ops: top(qualBat, 'ops'),
        era: top(qualPit.filter(p => p.era !== null), 'era', false), k: top(pits, 'k'), w: top(pits, 'w'),
      },
      myBatters: hitters(myTeam()).map(p => batRow(p) || { id: p.id, name: p.name, pos: p.pos, g: 0, pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0, r: 0, d2: 0, d3: 0, avg: 0, ops: 0 }),
      myPitchers: myTeam().roster.filter(p => p.isPitcher).map(p => pitRow(p) || { id: p.id, name: p.name, pos: p.pos, g: 0, gs: 0, ip: '0.0', era: null, k: 0, w: 0, l: 0, bb: 0, h: 0 }),
    };
  }

  function seasonView() {
    const oppId = todayMatch();
    return {
      year: S.year, mode: S.mode, day: S.day, length: S.length, done: S.done, champion: S.champion, tp: S.tp, difficulty: S.difficulty,
      today: oppId === null ? null : { opponent: team(oppId).name, oppStrength: teamStrength(team(oppId)) },
      myStrength: teamStrength(myTeam()),
      standings: standings(), recent: S.recent.slice(-5).reverse(), news: S.news,
    };
  }

  const teamStrength = t => Math.round(t.roster.reduce((s, p) => s + p.effOvr, 0) / t.roster.length);

  function leagueView() {
    const m = myTeam();
    return {
      teamName: MY_TEAM, record: { wins: m.w, losses: m.l },
      roster: m.roster.map(p => ({ ...p.toDict(), potential: p.potential, age: p.age })),
      recent: S.recent.slice(-5), opponents: [], difficulties: Object.entries(DIFFICULTY).map(([id, v]) => ({ id, label: v[1] })),
      tp: S.tp,
    };
  }

  // ── 경기 상태 직렬화 (경기 화면용) ──
  const pdict = (p, l) => {
    const d = p.toDict();
    if (l) Object.assign(d, { pitches: l.pitches, inn: l.inningsText, hits: l.hits, runs: l.runs, walks: l.walks, ks: l.strikeouts });
    d.posLabel = POS_LABEL[p.pos] || p.pos;
    return d;
  };
  const ls = (t, cols) => [...t.runsByInning, ...Array(cols - t.runsByInning.length).fill(null)];
  function stateDict(g) {
    const { engine: e } = g, gs = e.gs, { mine, theirs } = gs;
    const cols = Math.max(9, mine.runsByInning.length, theirs.runsByInning.length);
    const curSlot = gs.top ? mine.currentSlot : -1;
    const batter = gs.offense().currentBatter();
    const needs = e.needsDecision();
    const d = {
      gameId: g.id, opponent: gs.opponent, myName: mine.name, inning: gs.inning, top: gs.top,
      outs: gs.outs, balls: gs.balls, strikes: gs.strikes, runners: gs.runners.map(r => (r ? r.name : null)),
      score: { mine: mine.score, theirs: theirs.score }, hits: { mine: mine.hits, theirs: theirs.hits },
      innings: cols, linescore: { mine: ls(mine, cols), theirs: ls(theirs, cols) },
      pitchTotal: gs.pitchTotal, done: gs.done, difficulty: e.difficulty,
      lineup: mine.lineup.map((p, i) => ({ ...pdict(p), current: i === curSlot })),
      batter: batter ? pdict(batter) : null,
      myPitcher: mine.pitcher ? pdict(mine.pitcher, mine.currentLine()) : null,
      oppPitcher: theirs.pitcher ? pdict(theirs.pitcher, theirs.currentLine()) : null,
      needsDecision: needs, decisionKind: needs ? (gs.top ? 'offense' : 'defense') : null,
      stealable: e.stealableBases(), canBunt: e.canBunt(), canIbb: e.canIbb(),
      bench: gs.top && !gs.done ? mine.bench().map(p => pdict(p)) : [],
      bullpen: !gs.top && !gs.done ? mine.bullpen().map(p => pdict(p)) : [],
      pitchCall: e.pitchCall, pitchCalls: Object.entries(PITCH_CALLS).map(([id, label]) => ({ id, label })),
      record: { wins: myTeam().w, losses: myTeam().l }, defending: gs.defense().name,
      day: S.day, length: S.length,
    };
    if (gs.done) {
      d.box = { mine: mine.pitcherLines.map(l => pdict(l.pitcher, l)), theirs: theirs.pitcherLines.map(l => pdict(l.pitcher, l)) };
      d.batBox = mine.lineup.map(p => ({ name: p.name, pos: p.pos, ...(e.bat.get(p.id) || { pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0, r: 0 }) }));
    }
    return d;
  }
  const linesOut = lines => lines.map(([kind, text]) => ({ kind, text }));

  // ── 요청 처리 ──
  function newGame(body) {
    if (S.done) return [409, { error: '시즌이 끝났습니다. 새 시즌을 시작하세요.' }];
    const m = myTeam(), opp = team(todayMatch());
    let lineup = null;
    if (body.lineup && body.lineup.length) {
      lineup = body.lineup.map(id => m.roster.find(p => p.id === id));
      if (lineup.length !== 9 || lineup.some(p => !p || p.isPitcher)) return [400, { error: '타순은 야수 9명이어야 합니다.' }];
    }
    const starter = body.starter ? m.roster.find(p => p.id === body.starter && p.isPitcher) : null;
    games.clear();                                   // 하루에 진행 중인 경기는 하나
    const engine = buildGame(m, opp, { lineup, starter, difficulty: S.difficulty });
    const g = { id: newId() + newId(), engine, finished: false };
    games.set(g.id, g);
    return [200, { state: stateDict(g), lines: linesOut(engine.drainQueue()) }];
  }

  function complete(g) {
    if (g.finished) return;
    g.finished = true;
    finishDay(g.engine);
  }

  function advance(id, body) {
    const g = games.get(id);
    if (!g) return [404, { error: '경기를 찾을 수 없습니다.' }];
    const e = g.engine;
    const mode = { pitch: MODE.PITCH, atbat: MODE.AT_BAT, inning: MODE.HALF, game: MODE.GAME }[body.mode] || MODE.PITCH;
    const stop = !!body.stopAtDecision;
    if (body.ack) e.ackDecision();
    if (mode === MODE.GAME) e.autoMine = true;       // 끝까지 맡기면 코치가 투수 운영
    if (e.gs.done) return [200, { state: stateDict(g), lines: [], paused: false }];
    if (stop && e.needsDecision()) return [200, { state: stateDict(g), lines: [], paused: true }];
    const res = e.run(mode, stop);
    const lines = e.drainQueue();
    if (res.gameOver) complete(g);
    return [200, { state: stateDict(g), lines: linesOut([...lines, ...res.lines]), paused: false, gameOver: res.gameOver }];
  }

  function order(id, body) {
    const g = games.get(id);
    if (!g) return [404, { error: '경기를 찾을 수 없습니다.' }];
    const e = g.engine, gs = e.gs;
    const find = pid => gs.mine.roster.find(p => p.id === pid) || null;
    let ok;
    switch (body.type) {
      case 'bunt': ok = e.requestBunt(); break;
      case 'steal': ok = e.requestSteal(Number(body.base)); break;
      case 'ibb': ok = e.requestIbb(); break;
      case 'pinch_hit': { const s = find(body.id); ok = !!s && e.requestPinchHit(s); break; }
      case 'pinch_run': { const s = find(body.id); ok = !!s && e.requestPinchRun(Number(body.base), s); break; }
      case 'pitcher': { const n = find(body.id); ok = !!n && e.requestPitcherChange(n); break; }
      case 'pitch_call': ok = e.setPitchCall(body.call); break;
      default: return [400, { error: '알 수 없는 지시입니다.' }];
    }
    const lines = e.drainQueue();
    if (!ok) return [409, { error: '지금은 이 지시를 낼 수 없습니다.', state: stateDict(g) }];
    return [200, { state: stateDict(g), lines: linesOut(lines) }];
  }

  // 내 경기를 자동으로 진행 (여러 날)
  function quick(days) {
    const results = [];
    for (let i = 0; i < days && !S.done; i++) {
      const e = buildGame(myTeam(), team(todayMatch()), { difficulty: S.difficulty });
      e.autoMine = true;
      e.run(MODE.GAME);
      const r = { opponent: e.gs.opponent, score: `${e.gs.mine.score}:${e.gs.theirs.score}`, result: e.gs.mine.score > e.gs.theirs.score ? '승' : '패' };
      finishDay(e);
      results.push(r);
    }
    return [200, { results, season: seasonView() }];
  }

  // 훈련: 능력치 +1 (3 포인트, 잠재력까지) / 휴식: 피로 -20 (1 포인트)
  function train(body) {
    const p = myTeam().roster.find(x => x.id === body.id);
    if (!p) return [404, { error: '선수를 찾을 수 없습니다.' }];
    if (body.kind === 'ovr') {
      if (S.tp < 3) return [409, { error: '훈련 포인트가 부족합니다 (3 필요).' }];
      if (p.ovr >= p.potential) return [409, { error: `${p.name} 선수는 잠재력 한계(${p.potential})에 도달했습니다.` }];
      S.tp -= 3; p.ovr++;
      p.setFatigue(p.fatigue + 5);
    } else if (body.kind === 'rest') {
      if (S.tp < 1) return [409, { error: '훈련 포인트가 부족합니다 (1 필요).' }];
      if (p.fatigue === 0) return [409, { error: `${p.name} 선수는 이미 피로가 없습니다.` }];
      S.tp -= 1; p.setFatigue(p.fatigue - 20);
    } else return [400, { error: '알 수 없는 훈련입니다.' }];
    dirty = true;
    return [200, { player: { ...p.toDict(), potential: p.potential }, tp: S.tp }];
  }

  // ── 영입 / 방출 ──
  const signCost = p => Math.max(2, Math.round((p.ovr - 60) * 0.8));
  function ownerOf(id) {
    const t = S.teams.find(x => x.roster.some(p => p.id === id));
    return t ? t.name : null;
  }
  function scoutSearch(body) {
    const q = String(body.q || '').trim().toLowerCase();
    const league = body.league || '';
    const pos = body.pos || '';
    const res = [];
    for (const base of DB) {
      const p = S.players[base.id] || base;      // 팀에 있는 선수는 현재(훈련 반영) 상태로
      if (league && p.league !== league) continue;
      if (pos === 'P' ? !p.isPitcher : pos === 'H' ? p.isPitcher : pos && p.pos !== pos) continue;
      if (q && !p.name.toLowerCase().includes(q)) continue;
      res.push(p);
    }
    res.sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
    const total = res.length;
    return [200, {
      total, tp: S.tp, rosterSize: myTeam().roster.length, rosterMax: ROSTER_MAX,
      results: res.slice(0, Math.min(60, Number(body.limit) || 40)).map(p => ({
        id: p.id, name: p.name, pos: p.pos, league: p.league, ovr: p.ovr, potential: p.potential,
        team: p.team, first: p.first, last: p.last, owner: ownerOf(p.id), cost: signCost(p),
      })),
    }];
  }
  function sign(body) {
    const base = DB_BY_ID.get(body.id);
    if (!base) return [404, { error: '선수를 찾을 수 없습니다.' }];
    const owner = ownerOf(base.id);
    if (owner === MY_TEAM) return [409, { error: `${base.name} 선수는 이미 우리 팀입니다.` }];
    if (owner) return [409, { error: `${base.name} 선수는 ${owner} 소속이라 데려올 수 없습니다.` }];
    const cost = signCost(base);
    if (S.tp < cost) return [409, { error: `훈련 포인트가 부족합니다 (${cost} 필요, 보유 ${S.tp}).` }];
    if (myTeam().roster.length >= ROSTER_MAX) return [409, { error: `로스터가 가득 찼습니다 (${ROSTER_MAX}명). 훈련 탭에서 선수를 방출하세요.` }];
    S.tp -= cost;
    base.setFatigue(0);
    myTeam().roster.push(base);
    S.players[base.id] = base;
    dirty = true;
    return [200, { player: base.toDict(), tp: S.tp, cost }];
  }
  function release(body) {
    const m = myTeam();
    const p = m.roster.find(x => x.id === body.id);
    if (!p) return [404, { error: '우리 팀 선수가 아닙니다.' }];
    const rest = m.roster.filter(x => x !== p);
    if (rest.filter(x => !x.isPitcher).length < 9) return [409, { error: '야수가 9명보다 적어지면 경기를 할 수 없습니다.' }];
    if (rest.filter(x => x.isPitcher).length < 5) return [409, { error: '투수가 5명보다 적어지면 선발 로테이션이 돌지 않습니다.' }];
    m.roster = rest;
    delete S.players[p.id];       // 기록(stats)은 남겨 둠
    dirty = true;
    return [200, { released: p.name }];
  }

  // ── 저장 / 불러오기 ──
  function exportState() {
    const pl = Object.values(S.players).map(p => [p.id, p.name, p.pos, p.league, p.age, p.ovr, p.potential, p.salary, p.contract, p.team, p.era, p.fatigue, p.first || 0, p.last || 0, p.most || '']);
    const teams = S.teams.map(t => ({ id: t.id, name: t.name, user: t.user, w: t.w, l: t.l, rs: t.rs, ra: t.ra, streak: t.streak, roster: t.roster.map(p => p.id) }));
    return { version: 2, mode: S.mode, year: S.year, length: S.length, difficulty: S.difficulty, day: S.day, tp: S.tp, done: S.done, champion: S.champion,
      recent: S.recent, news: S.news, schedule: S.schedule, stats: S.stats, players: pl, teams };
  }
  function importState(o) {
    if (!o || (o.version !== 1 && o.version !== 2)) return false;
    const players = {};
    o.players.forEach(([id, name, pos, league, age, ovr, pot, sal, con, tm, era, fat, first, last, most]) => {
      const p = new Player(name, pos, league, age, ovr, pot, sal, con, tm, era);
      p.id = id; p.fatigue = fat; p.first = first || 0; p.last = last || 0; p.most = most || '';
      players[id] = p;
    });
    const teams = o.teams.map(t => ({ ...t, roster: t.roster.map(id => players[id]).filter(Boolean) }));
    S = { version: 2, mode: o.mode || 'current', year: o.year, length: o.length, difficulty: o.difficulty, day: o.day, tp: o.tp, done: o.done, champion: o.champion,
      recent: o.recent || [], news: o.news || [], schedule: o.schedule, stats: o.stats || {}, players, teams };
    games.clear();
    dirty = false;
    return true;
  }

  function dispatch(method, path, body = {}) {
    const parts = path.split('?')[0].split('/').filter(Boolean);
    const key = method + ' ' + parts.join('/');
    let res;
    if (key === 'GET api/season') res = [200, seasonView()];
    else if (key === 'POST api/season/new') {
      newSeason({ length: Number(body.length || 36), level: ['weak', 'mid', 'strong'].includes(body.level) ? body.level : 'mid',
        difficulty: DIFFICULTY[body.difficulty] ? body.difficulty : 'NORMAL', keep: !!body.keep,
        mode: body.mode === 'legend' ? 'legend' : 'current' });
      res = [200, seasonView()];
    } else if (key === 'POST api/season/quick') res = quick(clamp(Number(body.days || 1), 1, 200));
    else if (key === 'GET api/stats') res = [200, statsView()];
    else if (key === 'POST api/train') res = train(body);
    else if (key === 'POST api/scout/search') res = scoutSearch(body);
    else if (key === 'POST api/scout/sign') res = sign(body);
    else if (key === 'POST api/release') res = release(body);
    else if (key === 'GET api/league') res = [200, leagueView()];
    else if (key === 'POST api/game') res = newGame(body);
    else if (parts[1] === 'game' && parts.length === 4 && method === 'POST' && parts[3] === 'advance') res = advance(parts[2], body);
    else if (parts[1] === 'game' && parts.length === 4 && method === 'POST' && parts[3] === 'order') res = order(parts[2], body);
    else if (parts[1] === 'game' && parts.length === 3 && method === 'GET') {
      const g = games.get(parts[2]);
      res = g ? [200, { state: stateDict(g), lines: [] }] : [404, { error: '경기를 찾을 수 없습니다.' }];
    } else res = [404, { error: 'not found' }];
    return { status: res[0], payload: res[1] };
  }

  newSeason();
  return {
    dispatch, exportState, importState,
    isDirty: () => dirty, markSaved: () => { dirty = false; },
    get state() { return S; },
  };
}

if (typeof module !== 'undefined') {
  module.exports = { createService };
}
