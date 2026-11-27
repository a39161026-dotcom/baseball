// 시즌 모드 (옛날 야구9단처럼): 10개 구단 리그, 일정, 순위, 선수 시즌 기록, 훈련, 저장/불러오기
// dispatch(method, path, body) -> { status, payload }

// 구단 로스터 구성: 선발 5 + 불펜 4 + 포수 2 + 내야 4 + 외야 4 + 지명 1 = 20명
const TEAM_POS = ['SP', 'SP', 'SP', 'SP', 'SP', 'RP', 'RP', 'RP', 'RP', 'C', 'C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'OF', 'DH'];
const ROSTER_MAX = 28;
const LEAGUE_KEYS = ['KBO', 'NPB', 'MLB', 'WORLD', 'ALL'];
const LEAGUE_LABEL = { KBO: 'KBO', NPB: 'NPB', MLB: 'MLB', WORLD: '월드', ALL: '통합' };
// 국가대표 대회 (WBC 방식): 8개국, 2개 조
const INTL_GROUPS = { A: ['KOR', 'JPN', 'CUB', 'MEX'], B: ['USA', 'DOM', 'VEN', 'PUR'] };
const pk = p => p.person || p.id;           // 동일인 키

function createService(seed) {
  const rng = makeRng(seed);
  let S = null;                 // 시즌 상태
  const games = new Map();      // 진행 중인 경기
  let dirty = false;            // 저장이 필요한 변경이 있는지

  // ── 선수 DB ──
  const DB = buildAllPlayers();                 // KBO·NPB·MLB 실존 선수 전체
  const DB_BY_ID = new Map(DB.map(p => [p.id, p]));

  // 후보에서 포지션 틀에 맞춰 로스터를 채움. 모자라면 비슷한 역할로 보충.
  // used 는 동일인 키(person) 집합 — 같은 사람이 두 팀(또는 한 팀에 두 번) 들어가지 않게 함
  // score 를 주면 그 점수 순, 없으면 OVR 순
  function pickRoster(cands, used, score) {
    const val = score || (x => x.ovr);
    const sorted = [...cands].sort((a, b) => val(b) - val(a));
    const roster = [];
    const free = x => !used.has(pk(x));
    const take = p => { used.add(pk(p)); roster.push(p); };
    TEAM_POS.forEach(pos => {
      let p = sorted.find(x => free(x) && x.pos === pos);
      if (!p && (pos === 'SP' || pos === 'RP')) p = sorted.find(x => free(x) && x.isPitcher);
      if (!p && pos !== 'SP' && pos !== 'RP') p = sorted.find(x => free(x) && !x.isPitcher);
      if (p) take(p);
    });
    return roster;
  }

  const avgOvr = r => r.reduce((a, p) => a + p.ovr, 0) / Math.max(1, r.length);

  // 리그의 모든 구단 정의 (후보 선수 포함)
  // mode: 'current' = 마지막 시즌 소속 / 'legend' = 역대 최다 소속 구단(전신 포함)
  function leagueDefs(league, mode) {
    const fromLeague = lg => LEAGUES[lg].teams.map(t => {
      const cands = DB.filter(p => p.league === lg &&
        (mode === 'legend' ? p.most === t.name : (p.team === t.name && p.last >= LEAGUES[lg].last)));
      return { name: t.name, group: t.group, league: lg, cands };
    });
    if (league === 'ALL') return ['KBO', 'NPB', 'MLB'].flatMap(fromLeague).map(d => ({ ...d, group: d.league }));   // KBO·NPB·MLB 52팀이 한 리그
    if (league !== 'WORLD') return fromLeague(league);
    // 월드 리그: 세 리그 강팀 혼합 (KBO 3, NPB 4, MLB 4 + 선택 팀 포함 12팀 → 고를 수 있는 후보는 상위 팀들)
    const strongest = (lg, n) => fromLeague(lg)
      .map(d => ({ ...d, power: avgOvr([...d.cands].sort((a, b) => b.ovr - a.ovr).slice(0, 20)) }))
      .sort((a, b) => b.power - a.power).slice(0, n);
    return [...strongest('KBO', 3), ...strongest('NPB', 4), ...strongest('MLB', 5)]
      .map(d => ({ ...d, group: d.league === 'MLB' ? '아메리카' : '아시아' }));
  }

  // 팀 선택 화면용 요약: 전력(상위 20명 평균), 스타 선수, 주전 라인업
  function teamPreview(league, mode) {
    return leagueDefs(league, mode).map(d => {
      const roster = pickRoster(d.cands, new Set());
      const byOvr = [...roster].sort((a, b) => b.ovr - a.ovr);
      const pit = byOvr.filter(p => p.isPitcher), bat = byOvr.filter(p => !p.isPitcher);
      const row = p => ({ name: p.name, pos: p.pos, ovr: p.ovr });
      return { name: d.name, group: d.group, league: d.league, strength: Math.round(avgOvr(roster)), count: roster.length,
        stars: byOvr.slice(0, 4).map(row), bats: bat.slice(0, 5).map(row), pitchers: pit.slice(0, 3).map(row) };
    }).sort((a, b) => b.strength - a.strength);
  }

  // 선택한 팀을 첫 번째(우리 팀)로, 나머지를 AI 구단으로 구성. 우리 팀부터 뽑아 선수가 겹치지 않게 함
  function buildLeagueTeams(league, mode, myName) {
    const defs = leagueDefs(league, mode);
    let mine = defs.find(d => d.name === myName) || defs[0];
    const used = new Set();
    const ordered = [mine, ...defs.filter(d => d !== mine)];
    return ordered.map((d, i) => ({ id: i, name: d.name, group: d.group, league: d.league, user: i === 0, roster: pickRoster(d.cands, used) }));
  }

  // ── 시즌 생성 ──
  // league: KBO | NPB | MLB | WORLD,  team: 우리가 맡을 팀 이름
  // keep: 다음 시즌 (선수·능력치 유지, 나이·성장 반영)
  function newSeason({ length = 36, difficulty = 'NORMAL', keep = false, mode = 'current', league = 'KBO', team = null, started = true } = {}) {
    let teams;
    let devReport = null, carry = null;
    if (keep && S) {
      if (S.draft) { while (S.draft.pick < S.draft.order.length * S.draft.rounds && S.draft.pool.length && myTeam().roster.length < ROSTER_MAX) draftPick({ auto: true }); }
      devReport = ageAndDevelop();             // 나이 +1, 어린 선수 성장 / 노장 하락
      carry = { voices: S.voices || [], trades: S.trades || [] };
      teams = S.teams;
      teams.forEach(t => { t.w = 0; t.l = 0; t.rs = 0; t.ra = 0; t.streak = ''; });
      teams.forEach(t => t.roster.forEach(p => { p.setFatigue(0); }));
      mode = S.mode || mode;
      league = S.league || league;
    } else {
      // 새 시즌: 이전에 훈련·노쇠로 바뀐 능력치를 원래 기록 값으로 되돌림
      const fresh = buildAllPlayers();
      DB.length = 0; DB.push(...fresh);
      DB_BY_ID.clear(); fresh.forEach(p => DB_BY_ID.set(p.id, p));
      teams = buildLeagueTeams(league, mode, team);
      teams.forEach(t => { t.w = 0; t.l = 0; t.rs = 0; t.ra = 0; t.streak = ''; });
    }
    const players = {};
    teams.forEach(t => t.roster.forEach(p => { players[p.id] = p; }));
    S = {
      version: 5, started, league, mode, year: keep && S ? S.year + 1 : LEAGUES.KBO.last + 1, length, difficulty, day: 0,
      teams, players, schedule: makeSchedule(teams.length, length),
      stats: {}, tp: keep && S ? S.tp : 10, recent: [], news: [], done: false, champion: null,
      allStar: { day: length >= 18 ? Math.floor(length / 2) : -1, done: false, result: null },
      intl: S && S.intl || null, voices: carry ? carry.voices : [], trades: carry ? carry.trades : [],
      draft: null, devReport, offers: [], offerDay: 0,
    };
    if (!keep) {
      teams.forEach(t => t.roster.forEach(p => { p.ageSet = false; delete p.morale; initAge(p); p.ageSet = true; }));
      myTeam().roster.forEach(joinMyTeam);
      const cap = [...myTeam().roster].sort((a, b) => b.ovr - a.ovr)[0];
      if (cap) voice(cap, `${myTeam().name}의 새 시즌이네요. 주장으로서 팀을 잘 이끌어 보겠습니다!`, 'happy');
    }
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
    return S.stats[id] && S.stats[id].bat || ((S.stats[id] = S.stats[id] || {}).bat = { g: 0, pa: 0, ab: 0, h: 0, d2: 0, d3: 0, hr: 0, rbi: 0, bb: 0, k: 0, r: 0, sb: 0, cs: 0 });
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
      ['pa', 'ab', 'h', 'd2', 'd3', 'hr', 'rbi', 'bb', 'k', 'r', 'sb', 'cs'].forEach(k => { s[k] = (s[k] || 0) + (b[k] || 0); });
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
    afterMyGame(userEngine);
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
    if (S.day < S.length && S.day % 4 === 0 && S.offerDay !== S.day) genOffers();
    if (S.day >= S.length) {
      S.done = true;
      S.champion = standings()[0].name;
      openDraft();                           // 시즌이 끝나면 신인 드래프트 개막
    }
    dirty = true;
  }

  // ── 조회 ──
  function standings() {
    const rows = S.teams.map(t => ({ id: t.id, name: t.name, league: t.league, user: t.user, w: t.w, l: t.l, rs: t.rs, ra: t.ra, streak: t.streak,
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
        avg: top(qualBat, 'avg'), hr: top(bats, 'hr'), rbi: top(bats, 'rbi'), ops: top(qualBat, 'ops'), sb: top(bats, 'sb'),
        era: top(qualPit.filter(p => p.era !== null), 'era', false), k: top(pits, 'k'), w: top(pits, 'w'),
      },
      myBatters: hitters(myTeam()).map(p => batRow(p) || { id: p.id, name: p.name, pos: p.pos, g: 0, pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0, r: 0, d2: 0, d3: 0, sb: 0, cs: 0, avg: 0, ops: 0 }),
      myPitchers: myTeam().roster.filter(p => p.isPitcher).map(p => pitRow(p) || { id: p.id, name: p.name, pos: p.pos, g: 0, gs: 0, ip: '0.0', era: null, k: 0, w: 0, l: 0, bb: 0, h: 0 }),
    };
  }

  function seasonView() {
    const oppId = todayMatch();
    return {
      year: S.year, mode: S.mode, league: S.league, day: S.day, length: S.length,
      leagueLabel: LEAGUE_LABEL[S.league], started: S.started !== false, myName: myTeam().name, myGroup: myTeam().group,
      allStar: { ...S.allStar, due: allStarDue() }, done: S.done, champion: S.champion, tp: S.tp, difficulty: S.difficulty,
      today: oppId === null ? null : { opponent: team(oppId).name, oppStrength: teamStrength(team(oppId)) },
      myStrength: teamStrength(myTeam()),
      standings: standings(), recent: S.recent.slice(-5).reverse(), news: S.news,
      offerCount: (S.offers || []).length,
      voices: (S.voices || []).slice(-4).reverse(), draftOpen: !!S.draft && S.draft.pick < S.draft.order.length * S.draft.rounds,
      devReport: S.devReport || null,
    };
  }

  const teamStrength = t => Math.round(t.roster.reduce((s, p) => s + p.effOvr, 0) / t.roster.length);

  function leagueView() {
    const m = myTeam();
    return {
      teamName: m.name, record: { wins: m.w, losses: m.l },
      roster: m.roster.map(p => { joinMyTeam(p); return { ...p.toDict(), trainCost: trainCost(p), mood: moodOf(p.morale) }; }),
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
  // 수비 위치별 선수 이름 (경기 화면 '주루보기'용)
  function defenseMap(t) {
    const m = { P: t.pitcher ? t.pitcher.name : '' }, used = new Set();
    const lineup = t.lineup.filter(p => !p.isPitcher), cor = ['C', '1B', '2B', '3B', 'SS'];
    cor.forEach(pos => { const p = lineup.find(x => x.pos === pos && !used.has(x)); if (p) { used.add(p); m[pos] = p.name; } });
    const of = lineup.filter(x => x.pos === 'OF');
    ['LF', 'CF', 'RF'].forEach(pos => { const p = of.shift(); if (p) { used.add(p); m[pos] = p.name; } });
    const rest = lineup.filter(x => !used.has(x));
    [...cor, 'LF', 'CF', 'RF'].forEach(pos => { if (!m[pos] && rest.length) m[pos] = rest.shift().name; });
    return m;
  }
  const upNext = (t, n) => t.lineup.length ? [1, 2, 3].slice(0, n).map(k => ({ no: (t.currentSlot + k) % t.lineup.length + 1, name: t.lineup[(t.currentSlot + k) % t.lineup.length].name })) : [];

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
      plate: e.plate, defense: defenseMap(gs.defense()), upNext: upNext(gs.offense(), 3), batterNo: gs.offense().currentSlot + 1,
      myPitcher: mine.pitcher ? pdict(mine.pitcher, mine.currentLine()) : null,
      oppPitcher: theirs.pitcher ? pdict(theirs.pitcher, theirs.currentLine()) : null,
      needsDecision: needs, decisionKind: needs ? (gs.top ? 'offense' : 'defense') : null,
      stealable: e.stealableBases(), canBunt: e.canBunt(), canIbb: e.canIbb(),
      bench: gs.top && !gs.done ? mine.bench().map(p => pdict(p)) : [],
      bullpen: !gs.top && !gs.done ? mine.bullpen().map(p => pdict(p)) : [],
      pitchCall: e.pitchCall, pitchCalls: Object.entries(PITCH_CALLS).map(([id, label]) => ({ id, label })),
      record: { wins: myTeam().w, losses: myTeam().l }, defending: gs.defense().name,
      day: S.day, length: S.length, kind: g.kind || 'season', title: g.title || '',
    };
    if (gs.done && g.kind === 'allstar' && S.allStar.done) d.extra = S.allStar.mvp ? [`MVP: ${S.allStar.mvp}`] : [];
    if (gs.done && g.kind === 'intl' && S.intl) {
      const last = S.intl.results[S.intl.results.length - 1];
      d.extra = (last ? last.games : []).concat(S.intl.champion ? [`🏆 우승: ${COUNTRY_NAME[S.intl.champion]}`] : []);
    }
    if (gs.done) {
      d.box = { mine: mine.pitcherLines.map(l => pdict(l.pitcher, l)), theirs: theirs.pitcherLines.map(l => pdict(l.pitcher, l)) };
      d.batBox = mine.lineup.map(p => ({ name: p.name, pos: p.pos, ...(e.bat.get(p.id) || { pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0, r: 0 }) }));
    }
    return d;
  }
  const linesOut = lines => lines.map(([kind, text]) => ({ kind, text }));

  // ── 요청 처리 ──
  function newGame(body) {
    const kind = body.kind || 'season';
    if (kind === 'allstar' || kind === 'intl') {
      let engine, title;
      if (kind === 'allstar') {
        if (!allStarDue()) return [409, { error: '지금은 올스타전이 없습니다.' }];
        const sq = allStarSquads();
        engine = buildGame(sq.mine, sq.theirs);
        title = '⭐ 올스타전';
      } else {
        const I = S.intl;
        const opp = I && I.stage !== 'done' ? intlUserMatch() : null;
        if (!opp) return [409, { error: '지휘할 국가대표 경기가 없습니다.' }];
        engine = buildGame(intlTeamObj(I.mine), intlTeamObj(opp));
        title = `🌏 국가대표 ${intlStageLabel(I)}`;
      }
      games.clear();
      const g = { id: newId() + newId(), engine, finished: false, kind, title };
      games.set(g.id, g);
      return [200, { state: stateDict(g), lines: linesOut(engine.drainQueue()) }];
    }
    if (S.done) return [409, { error: '시즌이 끝났습니다. 새 시즌을 시작하세요.' }];
    if (allStarDue()) return [409, { error: '올스타전 휴식기입니다. 홈에서 올스타전을 지휘하거나 자동으로 치르세요.' }];
    const m = myTeam(), opp = team(todayMatch());
    let lineup = null;
    if (body.lineup && body.lineup.length) {
      lineup = body.lineup.map(id => m.roster.find(p => p.id === id));
      if (lineup.length !== 9 || lineup.some(p => !p || p.isPitcher)) return [400, { error: '타순은 야수 9명이어야 합니다.' }];
    }
    const starter = body.starter ? m.roster.find(p => p.id === body.starter && p.isPitcher) : null;
    games.clear();                                   // 하루에 진행 중인 경기는 하나
    const engine = buildGame(m, opp, { lineup, starter, difficulty: S.difficulty });
    const g = { id: newId() + newId(), engine, finished: false, kind: 'season', title: `${S.day + 1}일차 정규시즌` };
    games.set(g.id, g);
    return [200, { state: stateDict(g), lines: linesOut(engine.drainQueue()) }];
  }

  function complete(g) {
    if (g.finished) return;
    g.finished = true;
    if (g.kind === 'allstar') recordAllStar(g.engine);
    else if (g.kind === 'intl') intlFinishRound(g.engine);
    else finishDay(g.engine);
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
    let stoppedForAllStar = false;
    for (let i = 0; i < days && !S.done; i++) {
      if (allStarDue()) { stoppedForAllStar = true; break; }     // 올스타전 앞에서 멈춤
      const e = buildGame(myTeam(), team(todayMatch()), { difficulty: S.difficulty });
      e.autoMine = true;
      e.run(MODE.GAME);
      const r = { opponent: e.gs.opponent, score: `${e.gs.mine.score}:${e.gs.theirs.score}`, result: e.gs.mine.score > e.gs.theirs.score ? '승' : '패' };
      finishDay(e);
      results.push(r);
    }
    return [200, { results, season: seasonView(), stoppedForAllStar }];
  }

  // ── 올스타전 ──
  const allStarDue = () => !!S.allStar && !S.allStar.done && S.allStar.day >= 0 && S.day >= S.allStar.day && !S.done;
  // 팬 투표 점수: OVR + 이번 시즌 성적 보너스(±6)
  function fanScore(p) {
    const st = S.stats[p.id] || {};
    let v = p.ovr;
    if (p.isPitcher && st.pit && st.pit.outs >= 9) v += clamp((4.0 - st.pit.r * 27 / st.pit.outs) * 2, -6, 6);
    if (!p.isPitcher && st.bat && st.bat.pa >= 20) {
      const b = st.bat;
      const ops = (b.h + b.bb) / b.pa + (b.h + b.d2 + 2 * b.d3 + 3 * b.hr) / Math.max(1, b.ab);
      v += clamp((ops - 0.7) * 20, -6, 6);
    }
    return v;
  }
  function allStarSquads() {
    const myG = myTeam().group;
    const other = S.teams.map(t => t.group).find(g => g !== myG) || myG;
    const used = new Set();
    const squad = g => pickRoster(S.teams.filter(t => t.group === g).flatMap(t => t.roster), used, fanScore).map(clonePlayer);
    return { mine: { name: `${myG} 올스타`, roster: squad(myG) }, theirs: { name: `${other} 올스타`, roster: squad(other) } };
  }
  function recordAllStar(e) {
    const gs = e.gs, win = gs.mine.score > gs.theirs.score;
    const side = win ? gs.mine : gs.theirs;
    const mvp = [...side.lineup].sort((a, b) => {
      const s = p => { const x = e.bat.get(p.id) || {}; return (x.hr || 0) * 4 + (x.h || 0) * 2 + (x.rbi || 0) * 2 + (x.r || 0); };
      return s(b) - s(a);
    })[0];
    S.allStar = { ...S.allStar, done: true, result: `${gs.mine.name} ${gs.mine.score} : ${gs.theirs.score} ${gs.theirs.name}`, mvp: mvp ? mvp.name : null, win };
    if (win) S.tp += 3;
    dirty = true;
  }
  function autoAllStar() {
    const sq = allStarSquads();
    const e = buildGame(sq.mine, sq.theirs);
    e.autoMine = true;
    e.run(MODE.GAME);
    recordAllStar(e);
  }

  // ── 국가대표 대회 (조별리그 → 4강 → 결승) ──
  const RR = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
  function buildNation(code, era) {
    const cands = DB.filter(p => p.country === code && (era === 'legend' || p.last >= LEAGUES[p.league].last - 2));
    const best = new Map();                 // 동일인은 가장 높은 능력치 한 명
    cands.forEach(p => { const k = pk(p); if (!best.has(k) || best.get(k).ovr < p.ovr) best.set(k, p); });
    return pickRoster([...best.values()], new Set()).map(p => p.id);
  }
  function newIntl({ era = 'current', country = 'KOR' } = {}) {
    const codes = [...INTL_GROUPS.A, ...INTL_GROUPS.B];
    if (!codes.includes(country)) country = 'KOR';
    const teams = {};
    codes.forEach(c => { teams[c] = { code: c, name: COUNTRY_NAME[c], ids: buildNation(c, era), w: 0, l: 0, rs: 0, ra: 0, sp: 0 }; });
    S.intl = { era, mine: country, teams, stage: 'group', round: 0, semis: null, final: null, results: [], champion: null };
    dirty = true;
  }
  function intlMatches() {
    const I = S.intl;
    if (!I) return [];
    if (I.stage === 'group') return ['A', 'B'].flatMap(g => RR[I.round].map(([i, j]) => [INTL_GROUPS[g][i], INTL_GROUPS[g][j]]));
    if (I.stage === 'semi') return I.semis;
    if (I.stage === 'final') return [I.final];
    return [];
  }
  const intlStageLabel = I => I.stage === 'group' ? `조별리그 ${I.round + 1}차전` : I.stage === 'semi' ? '4강' : I.stage === 'final' ? '결승' : '대회 종료';
  function intlTeamObj(code) {
    const t = S.intl.teams[code];
    const roster = t.ids.map(id => DB_BY_ID.get(id)).filter(Boolean).map(clonePlayer);
    const sps = roster.filter(p => p.pos === 'SP');                 // 선발 로테이션
    sps.forEach((p, i) => p.setFatigue(i === t.sp % Math.max(1, sps.length) ? 0 : 30));
    return { name: t.name, roster };
  }
  function intlUserMatch() {
    const I = S.intl;
    const m = intlMatches().find(([a, b]) => a === I.mine || b === I.mine);
    return m ? (m[0] === I.mine ? m[1] : m[0]) : null;
  }
  function intlGroupTable(g) {
    return INTL_GROUPS[g].map(c => S.intl.teams[c])
      .map(t => ({ code: t.code, name: t.name, w: t.w, l: t.l, rs: t.rs, ra: t.ra, mine: t.code === S.intl.mine }))
      .sort((a, b) => b.w - a.w || (b.rs - b.ra) - (a.rs - a.ra) || b.rs - a.rs);
  }
  // 이번 라운드 경기를 모두 치르고 다음 단계로 (userEngine 이 있으면 그 경기 결과를 사용)
  function intlFinishRound(userEngine) {
    const I = S.intl;
    const games = [], winners = [];
    intlMatches().forEach(([a, b]) => {
      let e, A = a, B = b;
      if (userEngine && (a === I.mine || b === I.mine)) { e = userEngine; A = I.mine; B = a === I.mine ? b : a; }
      else { e = buildGame(intlTeamObj(a), intlTeamObj(b)); e.autoMine = true; e.run(MODE.GAME); }
      const ta = I.teams[A], tb = I.teams[B], sa = e.gs.mine.score, sb = e.gs.theirs.score;
      ta.rs += sa; ta.ra += sb; tb.rs += sb; tb.ra += sa; ta.sp++; tb.sp++;
      if (sa > sb) { ta.w++; tb.l++; winners.push(A); } else { tb.w++; ta.l++; winners.push(B); }
      if (A === I.mine) S.tp += sa > sb ? 2 : 1;
      games.push(`${ta.name} ${sa} : ${sb} ${tb.name}`);
    });
    I.results.push({ stage: intlStageLabel(I), games });
    if (I.stage === 'group') {
      I.round++;
      if (I.round >= 3) {
        const A = intlGroupTable('A'), B = intlGroupTable('B');
        I.semis = [[A[0].code, B[1].code], [B[0].code, A[1].code]];
        I.stage = 'semi';
      }
    } else if (I.stage === 'semi') {
      I.final = winners;
      I.stage = 'final';
    } else if (I.stage === 'final') {
      I.champion = winners[0];
      I.stage = 'done';
    }
    dirty = true;
  }
  function intlView() {
    const I = S.intl;
    if (!I) return { active: false, countries: [...INTL_GROUPS.A, ...INTL_GROUPS.B].map(c => ({ code: c, name: COUNTRY_NAME[c] })) };
    const opp = I.stage === 'done' ? null : intlUserMatch();
    const roster = I.teams[I.mine].ids.map(id => DB_BY_ID.get(id)).filter(Boolean)
      .map(p => ({ name: p.name, pos: p.pos, ovr: p.ovr, league: p.league }));
    return {
      active: true, era: I.era, mine: I.mine, mineName: COUNTRY_NAME[I.mine], stage: I.stage, stageLabel: intlStageLabel(I),
      groups: { A: intlGroupTable('A'), B: intlGroupTable('B') },
      semis: I.semis && I.semis.map(m => m.map(c => COUNTRY_NAME[c])), final: I.final && I.final.map(c => COUNTRY_NAME[c]),
      champion: I.champion && COUNTRY_NAME[I.champion], results: I.results.slice().reverse(),
      next: opp ? { opponent: COUNTRY_NAME[opp], label: intlStageLabel(I) } : null,
      eliminated: I.stage !== 'done' && !opp, roster,
      countries: [...INTL_GROUPS.A, ...INTL_GROUPS.B].map(c => ({ code: c, name: COUNTRY_NAME[c] })),
    };
  }
  function intlQuick() {
    const I = S.intl;
    if (!I || I.stage === 'done') return [409, { error: '진행 중인 국가대표 대회가 없습니다.' }];
    const opp = intlUserMatch();
    let mine = null;
    if (opp) {
      const e = buildGame(intlTeamObj(I.mine), intlTeamObj(opp));
      e.autoMine = true;
      e.run(MODE.GAME);
      mine = `${COUNTRY_NAME[I.mine]} ${e.gs.mine.score} : ${e.gs.theirs.score} ${COUNTRY_NAME[opp]}`;
      intlFinishRound(e);
    } else intlFinishRound(null);
    return [200, { result: mine, intl: intlView() }];
  }

  // ══ 구단 운영: 나이·사기·라커룸·성장/노쇠·트레이드·드래프트 ══

  // 나이: 현역 선수는 실제 나이, 은퇴 선수(레전드)는 전성기 나이로 시작
  function initAge(p) {
    if (!p.birthYear) return;
    const lg = LEAGUES[p.league];
    p.age = lg && p.last >= lg.last - 1 ? S.year - p.birthYear : Math.max(20, (p.era || 0) - p.birthYear || p.age);
  }
  function joinMyTeam(p) {
    if (p.morale === undefined) p.morale = 60;
    if (!p.ageSet) { initAge(p); p.ageSet = true; }
  }

  // ── 라커룸 (선수 의견) ──
  const say = (rngPick, ...xs) => xs[rng.randrange(xs.length)];
  function voice(p, text, mood = 'neutral') {
    S.voices = S.voices || [];
    S.voices.push({ day: S.day, year: S.year, name: p.name, pos: p.pos, text, mood });
    if (S.voices.length > 60) S.voices = S.voices.slice(-60);
  }
  const moodOf = m => m >= 75 ? '😄' : m >= 55 ? '🙂' : m >= 35 ? '😐' : m >= 20 ? '😠' : '😡';

  // 경기 후 사기 변화와 선수 발언 (우리 팀)
  function afterMyGame(engine) {
    const gs = engine.gs, me = myTeam();
    const win = gs.mine.score > gs.theirs.score;
    const played = new Set(gs.mine.lineup.map(p => p.id));
    gs.mine.pitcherLines.forEach(l => played.add(l.pitcher.id));
    let said = 0;
    const talk = (p, text, mood) => { if (said < 3) { voice(p, text, mood); said++; } };
    me.roster.forEach(p => {
      joinMyTeam(p);
      let d = 0;
      if (played.has(p.id)) d += win ? 2 : -1;
      else if (!p.isPitcher) d -= 2;                        // 벤치 야수는 출전 기회가 없어 불만
      p.morale = clamp(p.morale + d, 0, 100);
    });
    // 오늘의 활약
    const score = id => { const b = engine.bat.get(id) || {}; return (b.hr || 0) * 4 + (b.h || 0) * 2 + (b.rbi || 0) * 2 + (b.r || 0); };
    const star = [...gs.mine.lineup].sort((a, b) => score(b.id) - score(a.id))[0];
    if (star && score(star.id) >= 6) {
      const b = engine.bat.get(star.id);
      star.morale = clamp(star.morale + 4, 0, 100);
      talk(star, say(0,
        `오늘 ${b.h}안타${b.hr ? ` ${b.hr}홈런` : ''}! 감독님이 믿고 내보내 주셔서 감사합니다.`,
        `타석에서 공이 잘 보였어요. ${win ? '이겨서 더 기쁩니다!' : '그래도 져서 아쉽네요.'}`,
        `${b.rbi}타점, 팀에 보탬이 돼서 다행입니다.`), 'happy');
    }
    const sp = gs.mine.pitcherLines[0];
    if (sp && sp.outs >= 18 && sp.runs <= 2) {
      sp.pitcher.morale = clamp(sp.pitcher.morale + 4, 0, 100);
      talk(sp.pitcher, say(0, `${sp.inningsText}이닝 ${sp.runs}실점, 포수 리드가 좋았습니다.`, '오늘은 공이 손에 착 감겼어요. 다음 등판도 자신 있습니다.'), 'happy');
    }
    // 불만·요청
    const benchSad = me.roster.filter(p => !p.isPitcher && !played.has(p.id)).sort((a, b) => a.morale - b.morale)[0];
    if (benchSad && benchSad.morale < 25 && (benchSad.tradeAskDay === undefined || S.day - benchSad.tradeAskDay >= 10)) {
      benchSad.tradeAskDay = S.day;
      talk(benchSad, '감독님, 저는 여기서 기회가 없는 것 같습니다. 트레이드를 요청합니다.', 'angry');
    } else if (benchSad && benchSad.morale < 40 && rng.random() < 0.35) {
      talk(benchSad, say(0, '저도 경기에 나가고 싶습니다. 준비는 돼 있어요.', '벤치에만 있으니 감각이 떨어지는 것 같아요.'), 'sad');
    }
    const tired = me.roster.filter(p => p.isPitcher && p.fatigue > 75).sort((a, b) => b.fatigue - a.fatigue)[0];
    if (tired && rng.random() < 0.4) talk(tired, '어깨가 많이 무겁습니다. 며칠 쉬게 해 주시면 좋겠어요.', 'sad');
    // 어린 선수 실전 성장 (24세 이하, 출전 시 4%)
    me.roster.forEach(p => {
      if (played.has(p.id) && p.age <= 24 && p.ovr < p.potential && rng.random() < 0.04) {
        p.ovr++;
        talk(p, `경기를 뛰면서 확실히 늘고 있는 게 느껴져요! (능력치 ${p.ovr})`, 'happy');
      }
    });
    if (!win && me.streak && me.streak.startsWith('L') && Number(me.streak.slice(1)) >= 4 && said < 3) {
      const cap = [...me.roster].sort((a, b) => b.ovr - a.ovr)[0];
      talk(cap, `${me.streak.slice(1)}연패라 분위기가 무겁네요. 선수들끼리 미팅 한번 하겠습니다.`, 'sad');
    }
  }

  // ── 성장과 노쇠 (시즌이 넘어갈 때) ──
  function ageAndDevelop() {
    const report = [];
    S.teams.forEach(t => t.roster.forEach(p => {
      if (t.user) joinMyTeam(p);
      p.age++;
      const before = p.ovr;
      if (p.age <= 26 && p.ovr < p.potential) p.ovr = Math.min(p.potential, p.ovr + 1 + rng.randrange(3));
      else if (p.age >= 32) p.ovr = Math.max(40, p.ovr - (1 + rng.randrange(2) + Math.floor((p.age - 32) / 3)));
      else if (p.age >= 30 && rng.random() < 0.3) p.ovr = Math.max(40, p.ovr - 1);
      p.potential = Math.max(p.potential, p.ovr);
      if (t.user && p.ovr !== before) report.push({ p, d: p.ovr - before });
    }));
    report.sort((a, b) => b.d - a.d);
    report.slice(0, 2).filter(r => r.d > 0).forEach(r => voice(r.p, `비시즌에 열심히 했습니다! 능력치가 ${r.d} 올랐어요 (${r.p.ovr}).`, 'happy'));
    report.slice(-2).filter(r => r.d < 0).forEach(r => voice(r.p, `몸이 예전 같지 않네요… (${r.p.age}세, 능력치 ${r.p.ovr}) 그래도 경험으로 버티겠습니다.`, 'sad'));
    return report.map(r => ({ name: r.p.name, age: r.p.age, ovr: r.p.ovr, d: r.d }));
  }

  // ── 트레이드 ──
  // 가치: 능력치가 높을수록 급격히 비싸짐(스타 1명 > 평범한 선수 여럿), 젊은 유망주는 잠재력 가산, 노장은 감가
  function tradeValue(p) {
    const base = Math.pow(Math.max(1, p.ovr - 50), 1.5) / 10;
    const youth = p.age <= 25 ? Math.max(0, p.potential - p.ovr) * 0.4 : 0;
    const old = p.age >= 32 ? (p.age - 31) * 1.2 : 0;
    return Math.max(0.5, Math.round((base + youth - old) * 10) / 10);
  }
  const rosterOk = r => r.filter(p => !p.isPitcher).length >= 9 && r.filter(p => p.isPitcher).length >= 5 && r.length <= ROSTER_MAX;
  function tradeEval(body) {
    const t = S.teams.find(x => x.id === Number(body.team) && !x.user);
    if (!t) return { error: '상대 구단을 고르세요.' };
    const me = myTeam();
    const give = (body.give || []).map(id => me.roster.find(p => p.id === id)).filter(Boolean);
    const get = (body.get || []).map(id => t.roster.find(p => p.id === id)).filter(Boolean);
    if (!give.length || !get.length) return { t, give, get, error: '주고받을 선수를 한 명 이상씩 고르세요.' };
    const gv = give.reduce((a, p) => a + tradeValue(p), 0), tv = get.reduce((a, p) => a + tradeValue(p), 0);
    const myAfter = me.roster.filter(p => !give.includes(p)).concat(get);
    const theirAfter = t.roster.filter(p => !get.includes(p)).concat(give);
    let verdict, message;
    if (!rosterOk(myAfter)) { verdict = 'invalid'; message = `거래 후 우리 팀이 야수 9명·투수 5명·최대 ${ROSTER_MAX}명 조건을 못 맞춥니다.`; }
    else if (!rosterOk(theirAfter)) { verdict = 'invalid'; message = `${t.name}: 그러면 저희 선수단 구성이 안 됩니다 (야수 9명·투수 5명 필요).`; }
    else if (gv >= tv * 1.05) { verdict = 'accept'; message = `${t.name}: 좋습니다. 그 조건이면 거래하죠.`; }
    else if (gv >= tv * 0.85) { verdict = 'close'; message = `${t.name}: 조금만 더 얹어 주시면 생각해 보겠습니다. (가치 ${gv.toFixed(1)} vs ${tv.toFixed(1)})`; }
    else { verdict = 'reject'; message = `${t.name}: ${get.length === 1 ? get[0].name + ' 선수는' : '그 선수들은'} 그 조건으로 내줄 수 없습니다.`; }
    return { t, give, get, gv, tv, verdict, message };
  }
  function tradeView(body) {
    const r = tradeEval(body);
    return [200, { giveValue: r.gv || 0, getValue: r.tv || 0, verdict: r.verdict || 'none', message: r.error || r.message }];
  }
  function tradePropose(body) {
    const r = tradeEval(body);
    if (r.error) return [400, { error: r.error }];
    if (r.verdict !== 'accept') return [409, { error: r.message, verdict: r.verdict }];
    const me = myTeam(), t = r.t;
    me.roster = me.roster.filter(p => !r.give.includes(p)).concat(r.get);
    t.roster = t.roster.filter(p => !r.get.includes(p)).concat(r.give);
    r.give.forEach(p => {
      voice(p, p.morale !== undefined && p.morale < 35 ? `${t.name}에서 새 출발합니다. 기회 주셔서 감사했습니다.` : `정든 팀을 떠나 아쉽네요. ${t.name}에서도 잘하겠습니다.`, p.morale < 35 ? 'neutral' : 'sad');
      delete p.morale; delete p.ageSet;              // AI 구단 선수는 사기 시스템 밖
    });
    r.get.forEach(p => { joinMyTeam(p); p.morale = 65; voice(p, say(0, '새 팀에서 최선을 다하겠습니다!', '불러 주셔서 감사합니다. 바로 보여드릴게요.'), 'happy'); });
    S.trades = (S.trades || []).concat([{ day: S.day, team: t.name, give: r.give.map(p => p.name), get: r.get.map(p => p.name) }]).slice(-20);
    dirty = true;
    return [200, { message: r.message, give: r.give.map(p => p.name), get: r.get.map(p => p.name) }];
  }
  function tradeRoster(body) {
    const t = S.teams.find(x => x.id === Number(body.team) && !x.user);
    const row = p => ({ ...p.toDict(), value: tradeValue(p) });
    return [200, {
      teams: S.teams.filter(x => !x.user).map(x => ({ id: x.id, name: x.name })),
      theirs: t ? [...t.roster].sort((a, b) => b.ovr - a.ovr).map(row) : [],
      mine: [...myTeam().roster].sort((a, b) => b.ovr - a.ovr).map(row),
      history: (S.trades || []).slice().reverse(),
    }];
  }

  // ── AI 트레이드 제안 ──
  // AI 구단이 우리 핵심 선수(젊거나 잠재력 큰 선수)를 원하고, 대신 그보다 능력치가 높은 노장(즉시전력)을 내놓음.
  // 제안은 언제나 평가에서 AI 가 수락할 만한(우리에게 손해일 수 있는) 조건이라, 받아들일지는 감독이 판단
  function genOffers() {
    const me = myTeam();
    const targets = [...me.roster].sort((a, b) => tradeValue(b) - tradeValue(a)).slice(0, 8);
    const teams = S.teams.filter(t => !t.user).map(t => [rng.random(), t]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const offers = [], usedGive = new Set();
    for (const t of teams) {
      if (offers.length >= 3) break;
      const tgt = targets[rng.randrange(targets.length)];
      if (usedGive.has(tgt.id)) continue;
      const tv = tradeValue(tgt);
      const cand = t.roster.filter(p => tradeValue(p) * 1.05 <= tv && pk(p) !== pk(tgt) && p.isPitcher === tgt.isPitcher)
        .sort((a, b) => b.ovr - a.ovr)[0];
      if (!cand || cand.ovr < tgt.ovr - 4) continue;
      const ev = tradeEval({ team: t.id, give: [tgt.id], get: [cand.id] });
      if (ev.verdict !== 'accept') continue;
      usedGive.add(tgt.id);
      offers.push({ id: newId(), team: t.id, give: [tgt.id], get: [cand.id], day: S.day });
    }
    S.offers = offers;
    S.offerDay = S.day;
    if (offers.length) voice(me.roster[0], `감독님, 다른 구단에서 트레이드 제안이 ${offers.length}건 들어왔다고 합니다. 운영 탭에서 확인해 보세요.`, 'neutral');
  }
  function offersView() {
    const me = myTeam();
    const row = p => ({ ...p.toDict(), value: tradeValue(p) });
    const live = (S.offers || []).filter(o => {
      const t = team(o.team);
      return t && o.give.every(id => me.roster.some(p => p.id === id)) && o.get.every(id => t.roster.some(p => p.id === id))
        && tradeEval({ team: o.team, give: o.give, get: o.get }).verdict === 'accept';
    });
    S.offers = live;
    return live.map(o => {
      const t = team(o.team), give = me.roster.find(p => p.id === o.give[0]), get = t.roster.find(p => p.id === o.get[0]);
      return { id: o.id, team: t.name, give: row(give), get: row(get),
        message: `${t.name}: ${give.name} 선수를 데려오고 싶습니다. 대신 ${get.name}(${get.age}세, OVR ${get.ovr})을 드리겠습니다.` };
    });
  }
  function offerAct(body, accept) {
    const o = (S.offers || []).find(x => x.id === body.id);
    if (!o) return [404, { error: '이미 사라진 제안입니다.' }];
    if (!accept) { S.offers = S.offers.filter(x => x !== o); dirty = true; return [200, { declined: true }]; }
    const r = tradePropose({ team: o.team, give: o.give, get: o.get });
    if (r[0] === 200) S.offers = S.offers.filter(x => x !== o);
    return r;
  }

  // ── 드래프트 (시즌 종료 후) ──
  // 풀: KBO·NPB·MLB 실존 선수 중 어느 구단에도 속하지 않은 젊은 선수 (우리 팀·AI 팀 로스터와 겹치지 않음)
  const DRAFT_CAP = { KBO: 80, NPB: 100, MLB: 160 };
  function draftCandidates() {
    const owned = new Set();
    S.teams.forEach(t => t.roster.forEach(p => owned.add(pk(p))));
    const val = p => p.potential * 0.7 + p.ovr * 0.3;
    const seen = new Set(), rows = [];
    ['KBO', 'NPB', 'MLB'].forEach(lg => {
      const list = DB.filter(p => p.league === lg && p.birthYear && !owned.has(pk(p)) && p.last >= S.year - 2 && S.year - p.birthYear <= 27)
        .sort((a, b) => val(b) - val(a));
      let n = 0;
      for (const p of list) {
        if (n >= DRAFT_CAP[lg]) break;
        if (seen.has(pk(p))) continue;             // 리그를 오간 같은 사람은 한 번만
        seen.add(pk(p)); n++;
        rows.push([p.id, p.name, p.pos, lg, S.year - p.birthYear, p.ovr, p.potential, p.team || '']);
      }
    });
    return rows;
  }
  const rowValue = r => r[6] * 0.7 + r[5] * 0.3;
  function draftView() {
    const D = S.draft;
    if (!D) return { open: false };
    const total = D.order.length * D.rounds;
    const cur = D.pick < total ? D.order[D.pick % D.order.length] : null;
    return {
      open: true, done: D.pick >= total, round: Math.floor(D.pick / D.order.length) + 1, rounds: D.rounds,
      pickNo: D.pick + 1, total, myTurn: cur === 0, current: cur === null ? null : team(cur).name,
      myPicks: D.order.map((t, i) => i).filter(i => D.order[i] === 0).map(i => i + 1),
      pool: D.pool.map(([id, name, pos, lg, age, ovr, pot, from]) => ({ id, name, pos, league: lg, age, ovr, potential: pot, from }))
        .sort((a, b) => (b.potential * 0.7 + b.ovr * 0.3) - (a.potential * 0.7 + a.ovr * 0.3)),
      picks: D.picks.slice().reverse(), rosterSize: myTeam().roster.length, rosterMax: ROSTER_MAX,
    };
  }
  function openDraft() {
    if (!S.done || S.draft) return;
    const order = standings().slice().reverse().map(r => r.id);       // 꼴찌부터
    const rounds = 2;
    S.draft = { order, rounds, pick: 0, pool: draftCandidates(), picks: [] };
    runAiPicks();
  }
  function takeProspect(teamId, poolIdx) {
    const D = S.draft, row = D.pool.splice(poolIdx, 1)[0], t = team(teamId);
    const p = DB_BY_ID.get(row[0]);
    p.setFatigue(0); initAge(p);
    t.roster.push(p);
    S.players[p.id] = p;
    if (!t.user && t.roster.length > ROSTER_MAX) {             // AI 구단은 넘치면 가장 약한 노장 정리
      const cut = [...t.roster].filter(x => x !== p).sort((a, b) => tradeValue(a) - tradeValue(b))[0];
      t.roster = t.roster.filter(x => x !== cut);
    }
    D.picks.push({ no: D.pick + 1, team: t.name, name: p.name, pos: p.pos, ovr: p.ovr, potential: p.potential, league: p.league, mine: t.user });
    D.pick++;
    return p;
  }
  function runAiPicks() {
    const D = S.draft, total = D.order.length * D.rounds;
    while (D.pick < total && D.order[D.pick % D.order.length] !== 0 && D.pool.length) {
      const tid = D.order[D.pick % D.order.length], lg = team(tid).league;
      const rank = rows => rows.map((r, i) => [rowValue(r), i]).sort((a, b) => b[0] - a[0])[0];
      const same = D.pool.map((r, i) => [r, i]).filter(([r]) => r[3] === lg);        // AI 구단은 자기 리그 선수를 우선 지명
      const best = same.length ? same[rank(same.map(x => x[0]))[1]][1] : rank(D.pool)[1];
      takeProspect(tid, best);
    }
    dirty = true;
  }
  function draftPick(body) {
    const D = S.draft;
    if (!D) return [409, { error: '드래프트는 시즌이 끝나야 열립니다.' }];
    if (D.pick >= D.order.length * D.rounds) return [409, { error: '드래프트가 끝났습니다.' }];
    if (D.order[D.pick % D.order.length] !== 0) return [409, { error: '우리 차례가 아닙니다.' }];
    if (myTeam().roster.length >= ROSTER_MAX) return [409, { error: `로스터가 가득 찼습니다 (${ROSTER_MAX}명). 훈련 탭에서 선수를 방출하세요.` }];
    let idx = D.pool.findIndex(r => r[0] === body.id);
    if (body.auto) idx = D.pool.map((r, i) => [rowValue(r), i]).sort((a, b) => b[0] - a[0])[0][1];
    if (idx < 0) return [404, { error: '이미 지명됐거나 없는 선수입니다.' }];
    const p = takeProspect(0, idx);
    joinMyTeam(p); p.morale = 70;
    voice(p, say(0, '지명해 주셔서 감사합니다! 꼭 1군에서 뵙겠습니다.', `${S.year + 1} 시즌, 기대에 부응하겠습니다!`), 'happy');
    runAiPicks();
    return [200, { picked: p.name, draft: draftView() }];
  }

  // 훈련: 능력치 +1 (3 포인트, 잠재력까지) / 휴식: 피로 -20 (1 포인트)
  function train(body) {
    const p = myTeam().roster.find(x => x.id === body.id);
    if (!p) return [404, { error: '선수를 찾을 수 없습니다.' }];
    joinMyTeam(p);
    if (body.kind === 'ovr') {
      const cost = trainCost(p);
      if (S.tp < cost) return [409, { error: `훈련 포인트가 부족합니다 (${cost} 필요).` }];
      if (p.ovr >= p.potential) return [409, { error: `${p.name} 선수는 잠재력 한계(${p.potential})에 도달했습니다.` }];
      S.tp -= cost; p.ovr++;
      p.setFatigue(p.fatigue + 5);
      p.morale = clamp(p.morale + 3, 0, 100);
      if (p.ovr === p.potential) voice(p, `이제 제 한계까지 왔네요 (${p.ovr}). 여기서부턴 경기로 보여드리겠습니다.`, 'neutral');
    } else if (body.kind === 'rest') {
      if (S.tp < 1) return [409, { error: '훈련 포인트가 부족합니다 (1 필요).' }];
      if (p.fatigue === 0) return [409, { error: `${p.name} 선수는 이미 피로가 없습니다.` }];
      S.tp -= 1; p.setFatigue(p.fatigue - 20);
      p.morale = clamp(p.morale + 5, 0, 100);
    } else return [400, { error: '알 수 없는 훈련입니다.' }];
    dirty = true;
    return [200, { player: { ...p.toDict(), potential: p.potential }, tp: S.tp }];
  }

  const trainCost = p => (p.age <= 24 ? 2 : 3);       // 어린 선수는 빨리 큼

  // ── 영입 / 방출 ──
  const signCost = p => Math.max(2, Math.round((p.ovr - 60) * 0.8));
  function ownerOf(id) {
    const base = DB_BY_ID.get(id) || S.players[id];
    const key = base ? pk(base) : id;
    const t = S.teams.find(x => x.roster.some(p => p.id === id || pk(p) === key));
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
        team: p.team, first: p.first, last: p.last, owner: ownerOf(p.id), cost: signCost(p), country: p.country,
        sub: p.sub || null, ownerMine: ownerOf(p.id) === myTeam().name,
      })),
    }];
  }
  function sign(body) {
    const base = DB_BY_ID.get(body.id);
    if (!base) return [404, { error: '선수를 찾을 수 없습니다.' }];
    const owner = ownerOf(base.id);
    if (owner === myTeam().name) return [409, { error: `${base.name} 선수는 이미 우리 팀입니다.` }];
    if (owner) return [409, { error: `${base.name} 선수는 ${owner} 소속이라 데려올 수 없습니다.` }];
    const cost = signCost(base);
    if (S.tp < cost) return [409, { error: `훈련 포인트가 부족합니다 (${cost} 필요, 보유 ${S.tp}).` }];
    if (myTeam().roster.length >= ROSTER_MAX) return [409, { error: `로스터가 가득 찼습니다 (${ROSTER_MAX}명). 훈련 탭에서 선수를 방출하세요.` }];
    S.tp -= cost;
    base.setFatigue(0);
    joinMyTeam(base);
    voice(base, '불러 주셔서 감사합니다. 바로 보여드리겠습니다!', 'happy');
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
    delete p.morale; delete p.ageSet;
    dirty = true;
    return [200, { released: p.name }];
  }

  // ── 저장 / 불러오기 ──
  function exportState() {
    const pl = Object.values(S.players).map(p => [p.id, p.name, p.pos, p.league, p.age, p.ovr, p.potential, p.salary, p.contract, p.team, p.era, p.fatigue, p.first || 0, p.last || 0, p.most || '',
      p.morale === undefined ? null : p.morale, p.birthYear || 0, p.rookie ? 1 : 0, p.ageSet ? 1 : 0]);
    const teams = S.teams.map(t => ({ id: t.id, name: t.name, user: t.user, group: t.group, league: t.league, w: t.w, l: t.l, rs: t.rs, ra: t.ra, streak: t.streak, roster: t.roster.map(p => p.id) }));
    return { version: 5, started: S.started !== false, league: S.league, allStar: S.allStar, intl: S.intl, voices: S.voices || [], trades: S.trades || [], draft: S.draft || null, offers: S.offers || [], offerDay: S.offerDay || 0,
      devReport: S.devReport || null, mode: S.mode, year: S.year, length: S.length, difficulty: S.difficulty, day: S.day, tp: S.tp, done: S.done, champion: S.champion,
      recent: S.recent, news: S.news, schedule: S.schedule, stats: S.stats, players: pl, teams };
  }
  function importState(o) {
    if (!o || ![1, 2, 3, 4, 5].includes(o.version) || o.career) return false;   // 폐지된 '커리어' 저장은 무시
    const players = {};
    o.players.forEach(([id, name, pos, league, age, ovr, pot, sal, con, tm, era, fat, first, last, most, morale, by, rookie, ageSet]) => {
      const p = new Player(name, pos, league, age, ovr, pot, sal, con, tm, era);
      p.id = id; p.fatigue = fat; p.first = first || 0; p.last = last || 0; p.most = most || '';
      if (morale !== null && morale !== undefined) p.morale = morale;
      p.birthYear = by || 0; p.rookie = !!rookie; p.ageSet = !!ageSet;
      players[id] = p;
    });
    // 동일인 키·국가는 선수 DB 에서 다시 붙임
    Object.values(players).forEach(p => {
      const b = DB_BY_ID.get(p.id);
      if (b) { p.person = b.person; p.country = b.country; p.sub = b.sub; if (!p.birthYear) p.birthYear = b.birthYear; } else { p.person = p.id; p.sub = null; }
    });
    const teams = o.teams.map(t => ({ group: '', league: o.league || 'KBO', ...t, roster: t.roster.map(id => players[id]).filter(Boolean) }));
    S = { version: 4, league: o.league || 'KBO', allStar: o.allStar || { day: -1, done: true, result: null }, intl: o.intl || null,
      voices: o.voices || [], trades: o.trades || [], draft: o.draft && o.draft.pool.every(r => DB_BY_ID.has(r[0])) ? o.draft : null,   // 옛 가상 신인 드래프트 저장은 버림
      devReport: o.devReport || null, offers: o.offers || [], offerDay: o.offerDay || 0,
      mode: o.mode || 'current', year: o.year, length: o.length, difficulty: o.difficulty, day: o.day, tp: o.tp, done: o.done, champion: o.champion,
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
    else if (key === 'POST api/teams') {
      const lg = LEAGUE_KEYS.includes(body.league) ? body.league : 'KBO';
      res = [200, { league: lg, teams: teamPreview(lg, body.mode === 'legend' ? 'legend' : 'current') }];
    }
    else if (key === 'POST api/season/new') {
      newSeason({ length: Number(body.length || 36), team: body.team || null,
        difficulty: DIFFICULTY[body.difficulty] ? body.difficulty : 'NORMAL', keep: !!body.keep,
        mode: body.mode === 'legend' ? 'legend' : 'current', league: LEAGUE_KEYS.includes(body.league) ? body.league : 'KBO' });
      res = [200, seasonView()];
    } else if (key === 'POST api/season/quick') res = quick(clamp(Number(body.days || 1), 1, 200));
    else if (key === 'GET api/stats') res = [200, statsView()];
    else if (key === 'POST api/allstar/auto') {
      if (!allStarDue()) res = [409, { error: '지금은 올스타전이 없습니다.' }];
      else { autoAllStar(); res = [200, { allStar: S.allStar }]; }
    }
    else if (key === 'GET api/intl') res = [200, intlView()];
    else if (key === 'POST api/trade/roster') res = tradeRoster(body);
    else if (key === 'POST api/trade/evaluate') res = tradeView(body);
    else if (key === 'POST api/trade/propose') res = tradePropose(body);
    else if (key === 'GET api/trade/offers') res = [200, { offers: offersView() }];
    else if (key === 'POST api/trade/accept') res = offerAct(body, true);
    else if (key === 'POST api/trade/decline') res = offerAct(body, false);
    else if (key === 'GET api/draft') res = [200, draftView()];
    else if (key === 'POST api/draft/pick') res = draftPick(body);
    else if (key === 'GET api/locker') res = [200, { voices: (S.voices || []).slice().reverse(),
      roster: myTeam().roster.map(p => { joinMyTeam(p); return { name: p.name, pos: p.pos, morale: p.morale, mood: moodOf(p.morale), age: p.age }; })
        .sort((a, b) => a.morale - b.morale) }];
    else if (key === 'POST api/intl/new') { newIntl({ era: body.era === 'legend' ? 'legend' : 'current', country: body.country }); res = [200, intlView()]; }
    else if (key === 'POST api/intl/quick') res = intlQuick();
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

  newSeason({ league: 'KBO', started: false });      // 기본값. 사용자가 팀을 고르면(api/season/new) 시작
  return {
    dispatch, exportState, importState,
    isDirty: () => dirty, markSaved: () => { dirty = false; },
    get state() { return S; },
  };
}

if (typeof module !== 'undefined') {
  module.exports = { createService };
}
