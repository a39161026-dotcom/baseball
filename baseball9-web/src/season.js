// 시즌 모드 (옛날 야구9단처럼): 10개 구단 리그, 일정, 순위, 선수 시즌 기록, 훈련, 저장/불러오기
// dispatch(method, path, body) -> { status, payload }

// 구단 로스터 구성: 선발 5 + 불펜 4 + 포수 2 + 내야 4 + 외야 4 + 지명 1 = 20명
const TEAM_POS = ['SP', 'SP', 'SP', 'SP', 'SP', 'RP', 'RP', 'RP', 'RP', 'C', 'C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'OF', 'DH'];
const ROSTER_MAX = 40;
const FIRST_MAX = 28;            // 1군 정원 (나머지는 2군)            // 1군 + 2군(드래프트 10라운드를 받을 수 있는 크기)
const LEAGUE_KEYS = ['KBO', 'NPB', 'MLB', 'WORLD', 'ALL'];
const LEAGUE_LABEL = { KBO: 'KBO', NPB: 'NPB', MLB: 'MLB', WORLD: '월드', ALL: '통합' };
// 국가대표 대회 (WBC 방식): 8개국, 2개 조
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
  // 시즌 선택 모드: SEASONS(선수별 [연도, 팀, 그 해 능력치])로 그 해의 실제 구단 로스터를 만듦
  let YEAR_IDX = null;
  function yearIndex() {
    if (YEAR_IDX) return YEAR_IDX;
    const idx = new Map();                      // 연도 → 리그 → 팀 이름 → [[선수 id, 그 해 능력치]]
    for (const id in SEASONS) {
      const base = DB_BY_ID.get(id);
      if (!base) continue;
      for (const [y, t, o] of SEASONS[id]) {
        let L = idx.get(y); if (!L) idx.set(y, L = {});
        const lg = L[base.league] || (L[base.league] = {}), nm = SEASON_TEAMS[t];
        (lg[nm] || (lg[nm] = [])).push([id, o]);
      }
    }
    return YEAR_IDX = idx;
  }
  function yearPlayer(id, ovr, year, teamName) {
    const base = DB_BY_ID.get(id), p = clonePlayer(base);
    const age = base.birthYear ? year - base.birthYear : 28;
    Object.assign(p, { ovr, age, team: teamName, potential: age <= 25 ? Math.min(97, ovr + 2 * (26 - age)) : ovr });
    return p;
  }
  function yearTeams(lg, year) {
    const L = (yearIndex().get(year) || {})[lg] || {};
    return Object.keys(L).filter(n => L[n].length >= 12).sort().map((name, i) => {
      const known = LEAGUES[lg].teams.find(t => t.name === name);
      return { name, group: known ? known.group : LEAGUES[lg].groups[i % 2], league: lg, cands: L[name].map(([id, o]) => yearPlayer(id, o, year, name)) };
    });
  }
  const validYear = y => Math.max(1982, Math.min(LEAGUES.KBO.last, Math.round(Number(y)) || LEAGUES.KBO.last));

  function leagueDefs(league, mode, year) {
    const fromLeague = lg => mode === 'year' ? yearTeams(lg, validYear(year)) : LEAGUES[lg].teams.map(t => {
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
  function teamPreview(league, mode, year) {
    return leagueDefs(league, mode, year).map(d => {
      const roster = pickRoster(d.cands, new Set());
      const byOvr = [...roster].sort((a, b) => b.ovr - a.ovr);
      const pit = byOvr.filter(p => p.isPitcher), bat = byOvr.filter(p => !p.isPitcher);
      const row = p => ({ name: p.name, pos: p.pos, ovr: p.ovr });
      return { name: d.name, group: d.group, league: d.league, strength: Math.round(avgOvr(roster)), count: roster.length,
        stars: byOvr.slice(0, 4).map(row), bats: bat.slice(0, 5).map(row), pitchers: pit.slice(0, 3).map(row) };
    }).sort((a, b) => b.strength - a.strength);
  }

  // 선택한 팀을 첫 번째(우리 팀)로, 나머지를 AI 구단으로 구성. 우리 팀부터 뽑아 선수가 겹치지 않게 함
  function buildLeagueTeams(league, mode, myName, year) {
    const defs = leagueDefs(league, mode, year);
    let mine = defs.find(d => d.name === myName) || defs[0];
    const used = new Set();
    const ordered = [mine, ...defs.filter(d => d !== mine)];
    return ordered.map((d, i) => ({ id: i, name: d.name, group: d.group, league: d.league, user: i === 0, roster: pickRoster(d.cands, used) }));
  }

  // ── 시즌 생성 ──
  // league: KBO | NPB | MLB | WORLD,  team: 우리가 맡을 팀 이름
  // keep: 다음 시즌 (선수·능력치 유지, 나이·성장 반영)
  function newSeason({ length = 36, difficulty = 'NORMAL', keep = false, mode = 'current', league = 'KBO', team = null, started = true, year = null } = {}) {
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
      teams = buildLeagueTeams(league, mode, team, year);
      teams.forEach(t => { t.w = 0; t.l = 0; t.rs = 0; t.ra = 0; t.streak = ''; });
    }
    const players = {};
    teams.forEach(t => t.roster.forEach(p => { players[p.id] = p; }));
    S = {
      version: 5, started, league, mode, year: keep && S ? S.year + 1 : mode === 'year' ? validYear(year) : LEAGUES.KBO.last + 1, length, difficulty, day: 0,
      teams, players, schedule: makeSchedule(teams.length, length),
      stats: {}, tp: keep && S ? S.tp : 10, recent: [], news: [], done: false, champion: null,
      allStar: { day: length >= 18 ? Math.floor(length / 2) : -1, done: false, result: null },
      intl: S && S.intl || null, voices: carry ? carry.voices : [], trades: carry ? carry.trades : [],
      draft: null, devReport, offers: [], offerDay: 0, articles: keep && S ? (S.articles || []) : [], history: [], retired: keep && S ? (S.retired || []) : [],
    };
    prevLeader = null;
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
  function makeSchedule(teamCount, length) {
    const n = teamCount + (teamCount % 2);             // 구단 수가 홀수면 가상의 상대(번호 teamCount)를 넣어 쉬는 날을 만듦
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
  const isGhost = id => id >= S.teams.length;
  const isBye = () => !S.done && isGhost(todayMatch());      // 우리 팀 휴식일 (구단 수가 홀수인 연도)

  // ── 라인업/선발 ──
  const firstTeam = t => t.roster.filter(p => !p.farm);               // 1군만 경기에 나감
  const hitters = t => firstTeam(t).filter(p => !p.isPitcher);
  const autoLineup = t => positionalLineup(hitters(t));            // 포지션을 맞춘 라인업
  function pickStarter(t) {
    const sps = firstTeam(t).filter(p => p.pos === 'SP').sort((a, b) => a.fatigue - b.fatigue);
    if (sps.length && sps[0].fatigue <= 55) return sps[0];
    return [...firstTeam(t).filter(p => p.isPitcher)].sort((a, b) => a.fatigue - b.fatigue)[0];
  }

  function buildGame(homeT, awayT, { lineup, starter, difficulty } = {}) {
    // 엔진에서는 항상 "mine"=먼저 공격(초), "theirs"=나중 공격(말). 사용자 팀은 언제나 mine.
    const gs = new GameState(homeT.name, awayT.name);
    gs.mine.lineup = lineup || autoLineup(homeT);
    gs.mine.roster = firstTeam(homeT);
    gs.mine.pitcher = starter || pickStarter(homeT);
    gs.theirs.lineup = autoLineup(awayT);
    gs.theirs.roster = firstTeam(awayT);
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
  // ── 기사 (경기·리그 소식을 신문 기사처럼) ──
  const hasBatchim = w => { const c = String(w).trim().slice(-1).charCodeAt(0); return c >= 0xAC00 && c <= 0xD7A3 ? (c - 0xAC00) % 28 !== 0 : false; };
  const scoreJosa = (n) => ([0, 3, 6].includes(Number(n) % 10) ? '으로' : '로');         // 4-1로 / 3-0으로
  const josa = (w, a, b) => `${w}${hasBatchim(w) ? a : b}`;                          // 이/가, 은/는, 을/를
  const shortTeam = n => String(n).replace(/(타이거즈|라이온즈|트윈스|베어스|위즈|랜더스|자이언츠|이글스|다이노스|히어로즈)$/, '');
  function pushArticle(a) {
    S.articles = S.articles || [];
    S.articles.unshift({ day: S.day + 1, year: S.year, ...a });
    if (S.articles.length > 80) S.articles.length = 80;
  }
  const batScore = x => (x.hr || 0) * 4 + (x.h || 0) * 2 + (x.rbi || 0) * 2 + (x.r || 0);
  const batLine = x => `${x.ab || 0}타수 ${x.h || 0}안타` + (x.hr ? ` ${x.hr}홈런` : '') + (x.rbi ? ` ${x.rbi}타점` : '');
  function streakOf() {                       // 우리 팀의 현재 연승/연패 (최근 경기 기준)
    const r = S.recent || [];
    let n = 0;
    for (let i = r.length - 1; i >= 0 && r[i].result === r[r.length - 1].result; i--) n++;
    return { n, win: r.length ? r[r.length - 1].result === '승' : true };
  }
  function gameArticle(e, opp, win) {
    const gs = e.gs, me = myTeam(), my = gs.mine.score, op = gs.theirs.score, diff = Math.abs(my - op);
    const A = shortTeam(me.name), B = shortTeam(opp.name), st = streakOf();
    const lineup = gs.mine.lineup, stat = p => e.bat.get(p.id) || {};
    const hero = [...lineup].sort((a, b) => batScore(stat(b)) - batScore(stat(a)))[0];
    const foe = [...gs.theirs.lineup].sort((a, b) => batScore(stat(b)) - batScore(stat(a)))[0];
    const sp = gs.mine.pitcherLines[0], osp = gs.theirs.pitcherLines[0];
    let title;
    if (win) {
      title = st.n >= 3 ? `${A} ${st.n}연승 질주… ${josa(B, '을', '를')} 제압` : diff >= 6 ? `${A}, ${B}에 ${my}-${op} 대승`
        : diff === 1 ? `${A}, ${B} 1점차 진땀승` : `${A}, ${josa(B, '을', '를')} 꺾고 승리`;
    } else {
      title = st.n >= 3 ? `${A} ${st.n}연패 수렁… ${josa(B, '에게', '에게')} 무릎` : diff >= 6 ? `${A}, ${B}에 ${my}-${op} 완패`
        : diff === 1 ? `${A}, ${B}에 1점차 석패` : `${A}, ${B}에 덜미`;
    }
    const sub = hero && batScore(stat(hero)) > 0 ? `${hero.name} ${batLine(stat(hero))}` : (sp ? `선발 ${sp.pitcher.name} ${sp.inningsText}이닝 ${sp.runs}실점` : '');
    const rank = standings().find(r => r.user);
    const parts = [`${josa(A, '이', '가')} ${S.day + 1}일차 경기에서 ${josa(B, '을', '를')} ${my}-${op}${scoreJosa(op)} ${win ? '꺾었다' : '졌다'}.`];
    if (hero && batScore(stat(hero)) > 0) parts.push(`${josa(hero.name, '은', '는')} ${batLine(stat(hero))}으로 팀 타선을 이끌었다.`);
    if (sp) parts.push(`선발 ${sp.pitcher.name}${hasBatchim(sp.pitcher.name) ? '은' : '는'} ${sp.inningsText}이닝 ${sp.hits}피안타 ${sp.strikeouts}탈삼진 ${sp.runs}실점을 기록했다.`);
    if (!win && foe && batScore(stat(foe)) > 0) parts.push(`${B}에서는 ${foe.name}이(가) ${batLine(stat(foe))}으로 맹활약했다.`);
    if (osp && win) parts.push(`${B} 선발 ${osp.pitcher.name}${hasBatchim(osp.pitcher.name) ? '은' : '는'} ${osp.inningsText}이닝 ${osp.runs}실점${osp.runs >= 4 ? '으로 무너졌다' : '으로 호투했지만 타선 지원을 받지 못했다'}.`);
    parts.push(`이로써 ${A}${hasBatchim(A) ? '은' : '는'} ${me.w}승 ${me.l}패로 ${rank ? rank.rank : '-'}위를 기록했다.${st.n >= 2 ? ` (${st.n}${st.win ? '연승' : '연패'} 중)` : ''}`);
    pushArticle({ tag: '우리 팀', title, sub, body: parts.join(' ') });
  }
  let prevLeader = null;
  function leagueArticles(results) {         // results: [{a, b, sa, sb}] 오늘 다른 구장 결과
    if (results.length) {
      const big = [...results].sort((x, y) => Math.abs(y.sa - y.sb) + (y.sa + y.sb) * 0.1 - Math.abs(x.sa - x.sb) - (x.sa + x.sb) * 0.1)[0];
      const w = big.sa > big.sb ? big.a : big.b, l = w === big.a ? big.b : big.a, hi = Math.max(big.sa, big.sb), lo = Math.min(big.sa, big.sb);
      pushArticle({ tag: '리그', title: hi + lo >= 14 ? `${shortTeam(w)}, ${shortTeam(l)}와 ${hi}-${lo} 난타전 끝에 승리` : `${shortTeam(w)}, ${shortTeam(l)}에 ${hi}-${lo} 승리`,
        sub: `${S.day + 1}일차 리그 소식`, body: `${josa(shortTeam(w), '이', '가')} ${josa(shortTeam(l), '을', '를')} ${hi}-${lo}${scoreJosa(lo)} 꺾었다.` });
    }
    const top = standings()[0];
    if (prevLeader && top.name !== prevLeader && S.day >= 2) pushArticle({ tag: '순위', title: `${shortTeam(top.name)}, 선두 탈환`, sub: `${top.w}승 ${top.l}패`, body: `${josa(shortTeam(top.name), '이', '가')} ${top.w}승 ${top.l}패로 단독 선두에 올랐다. 이전 선두는 ${shortTeam(prevLeader)}.` });
    prevLeader = top.name;
    if ((S.day + 1) % 5 === 0) {              // 5일마다 개인 기록 소식
      const bats = Object.values(S.players).map(batRow).filter(b => b && b.pa >= 15);
      const hr = [...bats].sort((a, b) => b.hr - a.hr || b.h - a.h)[0];
      if (hr && hr.hr > 0) pushArticle({ tag: '기록', title: `${hr.name}, ${hr.hr}홈런으로 홈런 선두`, sub: `${hr.team} · 타율 ${hr.avg.toFixed(3).replace(/^0/, '')}`, body: `${hr.team}의 ${hr.name}${hasBatchim(hr.name) ? '이' : '가'} 시즌 ${hr.hr}홈런 ${hr.rbi}타점을 기록하며 홈런 부문 선두를 달리고 있다. 타율은 ${hr.avg.toFixed(3).replace(/^0/, '')}.` });
    }
  }

  function finishDay(userEngine) {
    let userWin = null, userOpp = null;
    if (userEngine) {
      const opp = team(todayMatch());
      const mine = myTeam(), gs = userEngine.gs;
      recordGame(userEngine, mine, opp);
      afterMyGame(userEngine);
      const win = gs.mine.score > gs.theirs.score;
      S.recent.push({ day: S.day + 1, opponent: opp.name, result: win ? '승' : '패', score: `${gs.mine.score}:${gs.theirs.score}` });
      S.recent = S.recent.slice(-10);
      S.tp += win ? 3 : 2;                       // 훈련 포인트
      userWin = win; userOpp = opp;
      (S.history = S.history || []).push({ day: S.day, opp: opp.name, home: S.schedule[S.day].some(([a, b]) => a === 0), result: win ? '승' : '패', score: `${gs.mine.score}:${gs.theirs.score}` });
    } else { S.tp += 1; (S.history = S.history || []).push({ day: S.day, bye: true }); }                            // 휴식일
    const news = [], others = [];
    S.schedule[S.day].forEach(([a, b]) => {
      if (a === 0 || b === 0 || isGhost(a) || isGhost(b)) return;
      const e = buildGame(team(a), team(b));
      e.autoMine = true;
      e.run(MODE.GAME);
      recordGame(e, team(a), team(b));
      news.push(`${team(a).name} ${e.gs.mine.score} : ${e.gs.theirs.score} ${team(b).name}`);
      others.push({ a: team(a).name, b: team(b).name, sa: e.gs.mine.score, sb: e.gs.theirs.score });
    });
    S.news = news;
    if (userEngine) gameArticle(userEngine, userOpp, userWin);
    leagueArticles(others);
    S.teams.forEach(t => updateDailyCondition(t.roster, rng));
    if ((S.day + 1) % 3 === 0) S.teams.forEach(t => { growFarm(t); manageFarm(t); });
    S.day++;
    if (S.day < S.length && S.day % 4 === 0 && S.offerDay !== S.day) genOffers();
    if (S.day >= S.length) {
      S.done = true;
      S.champion = standings()[0].name;
      pushArticle({ tag: '시즌', title: `${shortTeam(S.champion)}, ${S.year} 시즌 우승`, sub: `${S.length}경기 대장정 마무리`, body: `${josa(S.champion, '이', '가')} ${S.year} 시즌 정상에 올랐다. 우리 팀 ${myTeam().name}은(는) ${standings().find(r => r.user).rank}위로 시즌을 마쳤다.` });
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
      today: oppId === null ? null : isGhost(oppId) ? { opponent: '휴식일', oppStrength: 0, bye: true } : { opponent: team(oppId).name, oppStrength: teamStrength(team(oppId)) },
      myStrength: teamStrength(myTeam()),
      standings: standings(), recent: S.recent.slice(-5).reverse(), news: S.news,
      offerCount: (S.offers || []).length,
      latestNews: (S.articles || []).slice(0, 3),
      voices: (S.voices || []).slice(-4).reverse(), draftOpen: !!S.draft && S.draft.pick < S.draft.order.length * S.draft.rounds,
      devReport: S.devReport || null,
    };
  }

  const teamStrength = t => { const f = firstTeam(t); return Math.round(f.reduce((s, p) => s + p.effOvr, 0) / Math.max(1, f.length)); };

  function leagueView() {
    const m = myTeam();
    return {
      teamName: m.name, record: { wins: m.w, losses: m.l },
      roster: m.roster.map(p => { joinMyTeam(p); const row = p.isPitcher ? pitRow(p) : batRow(p); return { ...p.toDict(), trainCost: trainCost(p), mood: moodOf(p.morale), stat: row || null, season: statLine(p) }; }),
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
  function defenseMap(t, override) {
    const m = { P: t.pitcher ? t.pitcher.name : '' }, slots = resolvePositions(t.lineup.filter(p => !p.isPitcher), override);
    t.lineup.forEach(p => { if (slots[p.id] && slots[p.id] !== 'DH') m[slots[p.id]] = p.name; });
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
      lineup: mine.lineup.map((p, i) => ({ ...pdict(p), slot: resolvePositions(mine.lineup, g.positions)[p.id] || p.pos, current: i === curSlot, ab: (e.bat.get(p.id) || {}).ab || 0, h: (e.bat.get(p.id) || {}).h || 0, hr: (e.bat.get(p.id) || {}).hr || 0, rbi: (e.bat.get(p.id) || {}).rbi || 0 })),
      cardB: batter ? { ...pdict(batter), season: statLine(batter), today: e.bat.get(batter.id) || {}, side: gs.top ? 'mine' : 'theirs' } : null,
      cardP: gs.defense().pitcher ? { ...pdict(gs.defense().pitcher, gs.defense().currentLine()), season: statLine(gs.defense().pitcher), side: gs.top ? 'theirs' : 'mine' } : null,
      batter: batter ? pdict(batter) : null,
      plate: e.plate, defense: defenseMap(gs.defense(), gs.defense() === mine ? g.positions : null), upNext: upNext(gs.offense(), 3), batterNo: gs.offense().currentSlot + 1,
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
      const side = t => { const ids = new Set(t.roster.map(p => p.id)), o = { r: t.score, h: 0, hr: 0, bb: 0, k: 0, sb: 0 };
        e.bat.forEach((b, id) => { if (ids.has(id)) { o.h += b.h || 0; o.hr += b.hr || 0; o.bb += b.bb || 0; o.k += b.k || 0; o.sb += b.sb || 0; } }); return o; };
      d.summary = { mine: side(mine), theirs: side(theirs), myName: mine.name, oppName: theirs.name };
    }
    if (gs.done) {
      d.box = { mine: mine.pitcherLines.map(l => pdict(l.pitcher, l)), theirs: theirs.pitcherLines.map(l => pdict(l.pitcher, l)) };
      d.batBox = mine.lineup.map(p => ({ name: p.name, pos: p.pos, ...(e.bat.get(p.id) || { pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0, r: 0 }) }));
    }
    return d;
  }
  const linesOut = lines => lines.map(([kind, text]) => ({ kind, text }));

  // ── 요청 처리 ──
  // 올스타·국가대표 경기도 일반 경기처럼 라인업·선발을 직접 정할 수 있게: 화면용 선수 행 / 선택한 id 로 구성
  const setupRows = ps => ps.map(p => ({ ...p.toDict(), mood: p.morale === undefined ? '' : moodOf(p.morale), stat: (p.isPitcher ? pitRow(p) : batRow(p)) || null, season: statLine(p) }));
  const cleanPositions = pos => { const o = {}; if (pos && typeof pos === 'object') Object.keys(pos).forEach(id => { if (POS_SLOTS.includes(pos[id])) o[id] = pos[id]; }); return o; };
  function lineupFrom(team, body) {
    let lineup = null;
    if (body.lineup && body.lineup.length === 9) { const l = body.lineup.map(id => team.roster.find(p => p.id === id)); if (l.every(p => p && !p.isPitcher)) lineup = l; }
    return { lineup, starter: body.starter ? team.roster.find(p => p.id === body.starter && p.isPitcher) || null : null };
  }
  function setupView(kind) {
    if (kind === 'allstar') {
      if (!allStarDue()) return [409, { error: '지금은 올스타전이 없습니다.' }];
      const sq = allStarSquads();
      return [200, { kind, title: '⭐ 올스타전', teamName: sq.mine.name, opponent: sq.theirs.name, roster: setupRows(sq.mine.roster) }];
    }
    const I = S.intl, opp = I && I.stage !== 'done' ? intlUserMatch() : null;
    if (!opp) return [409, { error: '지휘할 국가대표 경기가 없습니다.' }];
    const t = intlTeamObj(I.mine);
    return [200, { kind: 'intl', title: `🌏 국가대표 ${intlStageLabel(I)}`, teamName: t.name, opponent: COUNTRY_NAME[opp], roster: setupRows(t.roster) }];
  }
  function newGame(body) {
    const kind = body.kind || 'season';
    if (kind === 'allstar' || kind === 'intl') {
      let engine, title;
      if (kind === 'allstar') {
        if (!allStarDue()) return [409, { error: '지금은 올스타전이 없습니다.' }];
        const sq = allStarSquads();
        engine = buildGame(sq.mine, sq.theirs, lineupFrom(sq.mine, body));
        title = '⭐ 올스타전';
      } else {
        const I = S.intl;
        const opp = I && I.stage !== 'done' ? intlUserMatch() : null;
        if (!opp) return [409, { error: '지휘할 국가대표 경기가 없습니다.' }];
        const mineT = intlTeamObj(I.mine);
        engine = buildGame(mineT, intlTeamObj(opp), lineupFrom(mineT, body));
        title = `🌏 국가대표 ${intlStageLabel(I)}`;
      }
      games.clear();
      const g = { id: newId() + newId(), engine, finished: false, kind, title, positions: cleanPositions(body.positions) };
      games.set(g.id, g);
      return [200, { state: stateDict(g), lines: linesOut(engine.drainQueue()) }];
    }
    if (S.done) return [409, { error: '시즌이 끝났습니다. 새 시즌을 시작하세요.' }];
    if (allStarDue()) return [409, { error: '올스타전 휴식기입니다. 홈에서 올스타전을 지휘하거나 자동으로 치르세요.' }];
    if (isBye()) return [409, { error: '오늘은 우리 팀 휴식일입니다. 홈에서 오늘 경기 자동 / 7일 자동 진행으로 넘겨 주세요.' }];
    const m = myTeam(), opp = team(todayMatch());
    let lineup = null;
    if (body.lineup && body.lineup.length) {
      lineup = body.lineup.map(id => m.roster.find(p => p.id === id));
      if (lineup.length !== 9 || lineup.some(p => !p || p.isPitcher)) return [400, { error: '타순은 야수 9명이어야 합니다.' }];
    }
    const starter = body.starter ? m.roster.find(p => p.id === body.starter && p.isPitcher) : null;
    games.clear();                                   // 하루에 진행 중인 경기는 하나
    const engine = buildGame(m, opp, { lineup, starter, difficulty: S.difficulty });
    const g = { id: newId() + newId(), engine, finished: false, kind: 'season', title: `${S.day + 1}일차 정규시즌`, positions: cleanPositions(body.positions) };
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
      if (isBye()) { finishDay(null); continue; }
      const e = buildGame(myTeam(), team(todayMatch()), { difficulty: S.difficulty });
      e.autoMine = true;
      e.run(MODE.GAME);
      const r = { opponent: e.gs.opponent, score: `${e.gs.mine.score}:${e.gs.theirs.score}`, result: e.gs.mine.score > e.gs.theirs.score ? '승' : '패' };
      finishDay(e);
      results.push(r);
    }
    return [200, { results, season: seasonView(), stoppedForAllStar }];
  }

  // 우리 팀 경기 일정 (일차별 상대·장소·결과)
  function scheduleView() {
    const hist = new Map((S.history || []).map(h => [h.day, h]));
    const rows = S.schedule.map((day, d) => {
      const m = day.find(([a, b]) => a === 0 || b === 0), oppId = m[0] === 0 ? m[1] : m[0], h = hist.get(d);
      if (isGhost(oppId)) return { day: d + 1, bye: true, done: d < S.day };
      const opp = team(oppId);
      return { day: d + 1, opp: opp.name, league: opp.league, home: m[0] === 0, strength: teamStrength(opp), result: h && h.result || null, score: h && h.score || null, done: d < S.day, today: d === S.day && !S.done };
    });
    return { rows, allStarDay: S.allStar && S.allStar.day >= 0 ? S.allStar.day + 1 : 0 };
  }

  // ── 올스타전 ──
  const allStarDue = () => !!S.allStar && !S.allStar.done && S.allStar.day >= 0 && S.day >= S.allStar.day && !S.done;
  // 올스타·국가대표 선발 기준 = 내가 진행한 이번 시즌 기록. 기록이 충분한 선수는 기록 순으로 뽑고(능력치는 보지 않음),
  // 기록이 모자란 선수(출전·등판이 거의 없거나 다른 리그 선수)는 그 뒤에서 능력치 순으로만 고려
  function perfScore(p) {
    const st = S.stats[p.id] || {};
    if (p.isPitcher) {
      const t = st.pit;
      if (!t || t.outs < Math.max(9, S.day * 1.5)) return null;
      const ip = t.outs / 3, era = (t.r * 9 + 4.5 * 6) / (ip + 6);          // 표본이 적으면 평균 평균자책(4.5)쪽으로 보정
      return (5 - era) * 20 + t.k * 0.3 + t.w * 2;
    }
    const b = st.bat;
    if (!b || b.pa < Math.max(10, S.day * 1.5)) return null;
    const ops = (b.h + b.bb) / b.pa + (b.h + b.d2 + 2 * b.d3 + 3 * b.hr) / Math.max(1, b.ab);
    return ((ops * b.pa + 0.72 * 20) / (b.pa + 20)) * 100 + b.hr * 0.8 + b.rbi * 0.3 + b.sb * 0.3;
  }
  const fanScore = p => { const v = perfScore(p); return v === null ? p.ovr : 1000 + v; };       // 기록이 있는 선수가 항상 먼저
  // 선발 이유로 보여 줄 이번 시즌 성적 한 줄
  function statLine(p) {
    const st = S.stats[p.id] || {};
    if (p.isPitcher && st.pit && st.pit.outs >= 3) {
      const ip = st.pit.outs / 3;
      return `평균자책 ${(st.pit.r * 9 / ip).toFixed(2)} · ${st.pit.w}승 ${st.pit.l}패 · ${st.pit.k}삼진 (${Math.floor(st.pit.outs / 3)}.${st.pit.outs % 3}이닝)`;
    }
    if (!p.isPitcher && st.bat && st.bat.pa >= 5) {
      const b = st.bat, ops = (b.h + b.bb) / b.pa + (b.h + b.d2 + 2 * b.d3 + 3 * b.hr) / Math.max(1, b.ab);
      return `타율 ${(b.ab ? b.h / b.ab : 0).toFixed(3).replace(/^0/, '')} · ${b.hr}홈런 · ${b.rbi}타점 · OPS ${ops.toFixed(3).replace(/^0/, '')}`;
    }
    return '';
  }
  const squadRows = ps => ps.map(p => ({ name: p.name, pos: p.pos, ovr: p.ovr, league: p.league, team: p.team, score: perfScore(p) === null ? null : Math.round(perfScore(p) * 10) / 10, stat: statLine(p) }));
  function allStarSquads() {
    const myG = myTeam().group;
    const other = S.teams.map(t => t.group).find(g => g !== myG) || myG;
    const used = new Set();
    const squad = g => pickRoster(S.teams.filter(t => t.group === g).flatMap(t => firstTeam(t)), used, fanScore).map(clonePlayer);
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
    pushArticle({ tag: '올스타', title: `올스타전 ${win ? gs.mine.name : gs.theirs.name} 승리`, sub: mvp ? `MVP ${mvp.name}` : '', body: `${gs.mine.name} ${gs.mine.score} : ${gs.theirs.score} ${gs.theirs.name}. ${mvp ? 'MVP는 ' + mvp.name + ' 선수가 차지했다.' : ''}` });
    dirty = true;
  }
  function autoAllStar() {
    const sq = allStarSquads();
    const e = buildGame(sq.mine, sq.theirs);
    e.autoMine = true;
    e.run(MODE.GAME);
    recordAllStar(e);
  }

  // ── 국가대표 대회: 선수가 충분한 모든 나라가 참가 (조별리그 → 8강 → 4강 → 결승) ──
  const INTL_WINDOW = 5;                       // 현역 대표: 최근 6시즌 안에 뛴 선수
  const GROUP_LETTERS = 'ABCD';
  const inEraNation = (p, era) => era === 'legend' ? true : S.mode === 'year' ? p.first <= S.year && p.last >= S.year : p.last >= LEAGUES[p.league].last - INTL_WINDOW;
  function buildNation(code, era) {
    const cands = DB.filter(p => p.country === code && inEraNation(p, era));
    const score = era === 'legend' ? (p => p.ovr) : fanScore;          // 현역 대표: 이번 시즌 기록 순 (기록이 없는 선수는 능력치로 뒤에서 채움). 역대 드림팀은 통산 능력치
    const best = new Map();                 // 동일인은 가장 높은 점수 한 명
    cands.forEach(p => { const k = pk(p); if (!best.has(k) || score(best.get(k)) < score(p)) best.set(k, p); });
    return pickRoster([...best.values()], new Set(), score).map(p => p.id);
  }
  // 선수 명단을 꾸릴 수 있는(야수 9·투수 5 이상) 나라 목록
  function intlEligible(era) {
    const cnt = {};
    DB.forEach(p => { if (p.country && COUNTRY_NAME[p.country] && inEraNation(p, era)) { const c = cnt[p.country] = cnt[p.country] || { h: 0, p: 0 }; p.isPitcher ? c.p++ : c.h++; } });
    return Object.keys(cnt).filter(c => cnt[c].h >= 9 && cnt[c].p >= 5);
  }
  function roundRobin(codes) {                 // 조 안 풀리그: 3라운드 (3팀 조는 라운드마다 한 팀이 쉼)
    const n = codes.length, arr = n % 2 ? [...codes, null] : [...codes], rounds = [];
    for (let r = 0; r < arr.length - 1; r++) {
      const m = [];
      for (let i = 0; i < arr.length / 2; i++) { const x = arr[i], y = arr[arr.length - 1 - i]; if (x && y) m.push([x, y]); }
      rounds.push(m);
      arr.splice(1, 0, arr.pop());
    }
    while (rounds.length < 3) rounds.push([]);
    return rounds;
  }
  function newIntl({ era = 'current', country = 'KOR' } = {}) {
    const teams = {};
    intlEligible(era).forEach(c => {
      const ids = buildNation(c, era);
      const pl = ids.map(id => DB_BY_ID.get(id)).filter(Boolean);
      if (pl.filter(p => !p.isPitcher).length < 9 || pl.filter(p => p.isPitcher).length < 5) return;
      teams[c] = { code: c, name: COUNTRY_NAME[c], ids, w: 0, l: 0, rs: 0, ra: 0, sp: 0, power: pl.reduce((a, p) => a + p.ovr, 0) / pl.length };
    });
    const codes = Object.keys(teams).sort((a, b) => teams[b].power - teams[a].power);
    if (!teams[country]) country = teams.KOR ? 'KOR' : codes[0];
    const G = Math.max(2, Math.min(4, Math.ceil(codes.length / 4)));
    const groups = {};
    for (let g = 0; g < G; g++) groups[GROUP_LETTERS[g]] = [];
    codes.forEach((c, k) => { const row = Math.floor(k / G), g = row % 2 === 0 ? k % G : G - 1 - (k % G); groups[GROUP_LETTERS[g]].push(c); });      // 전력순 뱀 배치
    const rounds = [0, 1, 2].map(r => Object.keys(groups).flatMap(g => roundRobin(groups[g])[r]));
    S.intl = { era, mine: country, teams, groups, rounds, stage: 'group', round: 0, qf: null, semis: null, final: null, results: [], champion: null };
    dirty = true;
  }
  function intlMatches() {
    const I = S.intl;
    if (!I) return [];
    if (I.stage === 'group') return I.rounds[I.round] || [];
    if (I.stage === 'quarter') return I.qf;
    if (I.stage === 'semi') return I.semis;
    if (I.stage === 'final') return [I.final];
    return [];
  }
  const intlStageLabel = I => I.stage === 'group' ? `조별리그 ${I.round + 1}차전` : I.stage === 'quarter' ? '8강' : I.stage === 'semi' ? '4강' : I.stage === 'final' ? '결승' : '대회 종료';
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
  const intlCmp = (a, b) => b.w - a.w || (b.rs - b.ra) - (a.rs - a.ra) || b.rs - a.rs;
  function intlGroupTable(g) {
    return S.intl.groups[g].map(c => S.intl.teams[c])
      .map(t => ({ code: t.code, name: t.name, w: t.w, l: t.l, rs: t.rs, ra: t.ra, mine: t.code === S.intl.mine }))
      .sort(intlCmp);
  }
  function intlQualifiers() {                  // 조 순위 → 8강(또는 4강) 진출팀을 시드 순으로
    const I = S.intl, K = Object.keys(I.groups).length >= 3 ? 8 : 4;
    const rows = [];
    Object.keys(I.groups).forEach(g => intlGroupTable(g).forEach((t, rank) => rows.push({ ...t, rank })));
    return rows.sort((a, b) => a.rank - b.rank || intlCmp(a, b)).slice(0, K).map(t => t.code);
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
        const q = intlQualifiers();
        if (q.length === 8) { I.qf = [[q[0], q[7]], [q[3], q[4]], [q[1], q[6]], [q[2], q[5]]]; I.stage = 'quarter'; }
        else { I.semis = [[q[0], q[3]], [q[1], q[2]]]; I.stage = 'semi'; }
      }
    } else if (I.stage === 'quarter') {
      I.semis = [[winners[0], winners[1]], [winners[2], winners[3]]];
      I.stage = 'semi';
    } else if (I.stage === 'semi') {
      I.final = winners;
      I.stage = 'final';
    } else if (I.stage === 'final') {
      I.champion = winners[0];
      I.stage = 'done';
      pushArticle({ tag: '국가대표', title: `${COUNTRY_NAME[I.champion]}, 국가대표 대회 우승`, sub: `${Object.keys(I.teams).length}개국 참가`, body: `${Object.keys(I.teams).length}개국이 겨룬 국가대표 대회에서 ${COUNTRY_NAME[I.champion]}${hasBatchim(COUNTRY_NAME[I.champion]) ? '이' : '가'} 우승했다. 우리 대표팀은 ${COUNTRY_NAME[I.mine]}.` });
    }
    dirty = true;
  }
  const intlCountryList = era => { const list = intlEligible(era).map(c => ({ code: c, name: COUNTRY_NAME[c] })); return list.sort((a, b) => a.name.localeCompare(b.name, 'ko')); };
  function intlView() {
    const I = S.intl;
    const byEra = { current: intlCountryList('current'), legend: intlCountryList('legend') };
    if (!I) return { active: false, countries: byEra.current, countriesByEra: byEra };
    const opp = I.stage === 'done' ? null : intlUserMatch();
    const roster = I.teams[I.mine].ids.map(id => DB_BY_ID.get(id)).filter(Boolean)
      .map(p => ({ name: p.name, pos: p.pos, ovr: p.ovr, league: p.league, team: p.team, stat: statLine(p), score: I.era === 'legend' || perfScore(p) === null ? null : Math.round(perfScore(p) * 10) / 10 }));
    const names = m => m.map(c => COUNTRY_NAME[c]);
    const groups = {};
    Object.keys(I.groups).forEach(g => { groups[g] = intlGroupTable(g); });
    return {
      active: true, era: I.era, mine: I.mine, mineName: COUNTRY_NAME[I.mine], stage: I.stage, stageLabel: intlStageLabel(I), teamCount: Object.keys(I.teams).length,
      groups, quarters: I.qf && I.qf.map(names),
      semis: I.semis && I.semis.map(names), final: I.final && names(I.final),
      champion: I.champion && COUNTRY_NAME[I.champion], results: I.results.slice().reverse(),
      next: opp ? { opponent: COUNTRY_NAME[opp], label: intlStageLabel(I) } : null,
      bye: I.stage === 'group' && !opp, eliminated: I.stage !== 'done' && I.stage !== 'group' && !opp, roster,
      countries: byEra[I.era], countriesByEra: byEra,
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
    if (S.mode === 'year') { p.age = Math.max(18, S.year - p.birthYear); return; }
    const lg = LEAGUES[p.league];
    p.age = lg && p.last >= lg.last - 1 ? S.year - p.birthYear : Math.max(18, (p.era || 0) - p.birthYear || p.age);
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
  // ── 2군 ──
  // 1군은 최대 28명 (야수 9·투수 5 이상). 신인(드래프트)은 2군에서 시작하고, 2군에서 성장해 1군 선수보다 충분히 좋아지면 자동으로 콜업
  const farmOf = t => t.roster.filter(p => p.farm);
  function promote(t, p, why) { p.farm = false; if (t.user) { pushArticle({ tag: '2군', title: `${p.name}, 1군 콜업`, sub: `${p.pos} · ${p.age}세 · OVR ${p.ovr}`, body: `${t.name}${hasBatchim(t.name) ? '은' : '는'} ${p.name} 선수를 1군으로 불러올렸다. ${why || ''}`.trim() }); voice(p, '1군에 올라왔습니다! 기회를 꼭 살리겠습니다.', 'happy'); } }
  function demote(t, p) { p.farm = true; if (t.user) pushArticle({ tag: '2군', title: `${p.name}, 2군행`, sub: `${p.pos} · ${p.age}세 · OVR ${p.ovr}`, body: `${t.name}${hasBatchim(t.name) ? '은' : '는'} ${p.name} 선수를 2군으로 내렸다.` }); }
  function manageFarm(t) {                       // 구단별 1군/2군 정리: 정원 초과는 약한 선수부터 2군, 좋아진 2군 선수는 콜업
    const minOk = (list, pit) => list.filter(p => p.isPitcher === pit).length;
    let first = firstTeam(t);
    [[false, 9], [true, 5]].forEach(([pit, min]) => {       // 1군 최소 인원(야수 9·투수 5) 보장
      while (firstTeam(t).filter(p => p.isPitcher === pit).length < min) {
        const c = farmOf(t).filter(p => p.isPitcher === pit).sort((a, b) => b.ovr - a.ovr)[0];
        if (!c) break; promote(t, c, '1군 인원이 모자라 올라왔다.');
      }
    });
    first = firstTeam(t);
    while (first.length > FIRST_MAX) {            // 정원 초과 → 가장 약한 선수를 2군으로 (최소 인원 유지)
      const w = [...first].sort((a, b) => a.effOvr - b.effOvr).find(p => minOk(first, p.isPitcher) > (p.isPitcher ? 5 : 9));
      if (!w) break; demote(t, w); first = firstTeam(t);
    }
    farmOf(t).sort((a, b) => b.ovr - a.ovr).forEach(c => {
      first = firstTeam(t);
      const w = [...first.filter(p => p.isPitcher === c.isPitcher)].sort((a, b) => a.ovr - b.ovr)[0];      // 같은 역할의 가장 약한 1군 선수
      if (first.length < FIRST_MAX) { if (!w || c.ovr >= w.ovr - 2) promote(t, c, '1군 정원에 여유가 있어 실력을 인정받아 올라왔다.'); return; }
      if (w && c.ovr >= w.ovr + 3) { demote(t, w); promote(t, c, `${w.name} 선수보다 능력치가 앞서 1군으로 올라왔다.`); }
    });
  }
  function growFarm(t) {                          // 2군 선수는 꾸준히 훈련해 성장 (젊을수록 빠름)
    farmOf(t).forEach(p => { if (p.age <= 28 && p.ovr < p.potential && rng.random() < (p.age <= 24 ? 0.5 : 0.25)) p.ovr += 1; });
  }

  // ── 은퇴 ──
  // 비시즌에 나이가 많고 능력치가 떨어진 선수는 은퇴 (35세부터 확률적, 40세는 바로 은퇴). 우리 팀은 최소 인원(야수 9·투수 5)이 남도록 보류.
  const retireChance = p => p.age < 35 ? 0 : p.age >= 40 ? 1 : clamp((p.age - 34) * 0.12 + Math.max(0, 68 - p.ovr) * 0.01, 0, 0.9);
  function retirePlayer(t, p, manual) {
    const years = p.first && p.first <= S.year ? Math.max(1, S.year - p.first + 1) : null;
    t.roster = t.roster.filter(x => x !== p);
    delete S.players[p.id];
    (S.retired = S.retired || []).unshift({ id: p.id, name: p.name, pos: p.pos, age: p.age, ovr: p.ovr, year: S.year, team: t.name, league: p.league, years, user: !!t.user, manual: !!manual });
    if (S.retired.length > 200) S.retired.length = 200;
    if (t.user || p.ovr >= 75) pushArticle({ tag: '은퇴', title: `${p.name}, ${manual ? '현역 은퇴 결정' : '현역 은퇴 선언'}${years ? `… ${years}시즌 마침표` : ''}`, sub: `${t.name} · ${p.age}세 · 마지막 능력치 ${p.ovr}`,
      body: `${t.name}${hasBatchim(t.name) ? '의' : '의'} ${p.name}${hasBatchim(p.name) ? '이' : '가'} ${S.year} 시즌을 끝으로 유니폼을 벗는다. ${p.age}세의 ${p.pos} ${p.name}${hasBatchim(p.name) ? '은' : '는'} ${years ? years + '시즌 동안 ' : ''}그라운드를 누볐다. 팬들은 그의 마지막 시즌에 박수를 보냈다.` });
  }
  function refillRoster(t) {                 // AI 구단: 은퇴로 모자란 자리를 아무 구단에도 없는 선수로 채움
    const owned = new Set((S.retired || []).map(r => r.id));              // 은퇴한 선수는 다시 뽑지 않음
    S.teams.forEach(x => x.roster.forEach(p => owned.add(pk(p))));
    const need = pitcher => (pitcher ? 9 - t.roster.filter(p => p.isPitcher).length : 11 - t.roster.filter(p => !p.isPitcher).length);
    [true, false].forEach(pit => {
      let n = need(pit);
      if (n <= 0) return;
      const pool = DB.filter(p => p.isPitcher === pit && !owned.has(pk(p)) && !owned.has(p.id) && p.last >= LEAGUES[p.league].last - 1 && p.birthYear).sort((a, b) => b.ovr - a.ovr);
      for (const p of pool) { if (n <= 0) break; if (p.league !== t.league) continue; owned.add(pk(p)); initAge(p); p.age++; t.roster.push(p); S.players[p.id] = p; n--; }       // 이미 한 살 먹은 다른 선수들과 맞춤
    });
  }
  function retireSeason() {
    const out = [];
    S.teams.forEach(t => {
      [...t.roster].filter(p => p.age >= 35 && (p.age >= 40 || rng.random() < retireChance(p))).forEach(p => {
        const rest = t.roster.filter(x => x !== p);
        if (t.user && (rest.filter(x => !x.isPitcher).length < 9 || rest.filter(x => x.isPitcher).length < 5)) return;     // 우리 팀 인원 부족: 은퇴 보류
        if (t.user) voice(p, `${S.year} 시즌을 끝으로 은퇴하려 합니다. 그동안 감사했습니다, 감독님.`, 'sad');
        retirePlayer(t, p, false);
        out.push({ name: p.name, team: t.name, age: p.age, user: !!t.user });
      });
      if (!t.user) refillRoster(t);
      manageFarm(t);
    });
    return out;
  }
  function farmMove(body) {                        // 1군 ↔ 2군 수동 이동
    const m = myTeam(), p = m.roster.find(x => x.id === body.id);
    if (!p) return [404, { error: '우리 팀 선수가 아닙니다.' }];
    if (body.up) {
      if (!p.farm) return [409, { error: '이미 1군입니다.' }];
      if (firstTeam(m).length >= FIRST_MAX) return [409, { error: `1군은 최대 ${FIRST_MAX}명입니다. 먼저 1군 선수를 2군으로 내려 주세요.` }];
      p.farm = false;
    } else {
      if (p.farm) return [409, { error: '이미 2군입니다.' }];
      const f = firstTeam(m);
      if (f.filter(x => x.isPitcher === p.isPitcher).length <= (p.isPitcher ? 5 : 9)) return [409, { error: `1군에는 ${p.isPitcher ? '투수 5명' : '야수 9명'} 이상이 있어야 합니다.` }];
      p.farm = true;
    }
    dirty = true;
    return [200, { moved: p.name, farm: p.farm }];
  }
  function retireNow(body) {
    const m = myTeam(), p = m.roster.find(x => x.id === body.id);
    if (!p) return [404, { error: '우리 팀 선수가 아닙니다.' }];
    const rest = m.roster.filter(x => x !== p);
    if (rest.filter(x => !x.isPitcher).length < 9) return [409, { error: '야수가 9명보다 적어지면 경기를 할 수 없습니다.' }];
    if (rest.filter(x => x.isPitcher).length < 5) return [409, { error: '투수가 5명보다 적어지면 선발 로테이션이 돌지 않습니다.' }];
    retirePlayer(m, p, true);
    dirty = true;
    return [200, { retired: p.name }];
  }

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
    S.retiredLast = retireSeason();
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
    r.get.forEach(p => { p.farm = false; }); r.give.forEach(p => { p.farm = false; });
    manageFarm(myTeam()); manageFarm(t);
    pushArticle({ tag: '트레이드', title: `${shortTeam(myTeam().name)}·${shortTeam(t.name)} 트레이드 단행`, sub: `${r.give.map(p => p.name).join(', ')} ↔ ${r.get.map(p => p.name).join(', ')}`, body: `${myTeam().name}${hasBatchim(myTeam().name) ? '이' : '가'} ${t.name}와 선수를 맞바꿨다. ${r.give.map(p => p.name).join(', ')} 선수를 보내고 ${r.get.map(p => p.name).join(', ')} 선수를 받았다.` });
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

  // ── 드래프트 (시즌 종료 후, 10라운드) ──
  // 풀: ① 연도별 선수 — 같은 선수의 시즌마다 따로 한 명씩 ('09 양현종', '17 양현종': 그 해 나이·능력치)
  //     ② 기본 선수(마지막 시즌 기준) 중 어느 구단에도 속하지 않은 선수. 모두 KBO·NPB·MLB 역대 실존 선수를 무작위로 뽑음
  const DRAFT_ROUNDS = 10;
  const DRAFT_SIZE = { KBO: [80, 320], NPB: [100, 400], MLB: [140, 560] };       // 리그별 [기본 선수, 연도별 선수] 수
  const DRAFT_BANDS = [[85, 99, 0.12], [70, 84, 0.33], [55, 69, 0.55]];            // [최소 OVR, 최대 OVR, 비율]
  const yy = y => String(y % 100).padStart(2, '0');
  function seasonVersion(base, year, ovr, teamName) {
    const p = clonePlayer(base), age = base.birthYear ? Math.max(18, year - base.birthYear) : base.age;
    Object.assign(p, { id: `${base.id}@${year}`, person: `${pk(base)}@${year}`, name: `${yy(year)} ${base.name}`, ovr, age, era: year, first: year, last: year,
      team: teamName, potential: age <= 25 ? Math.min(97, ovr + 2 * (26 - age)) : ovr });
    return p;
  }
  function draftCandidates() {
    const owned = new Set(), ownedIds = new Set();
    S.teams.forEach(t => t.roster.forEach(p => { owned.add(pk(p)); ownedIds.add(p.id); }));
    const shuffle = arr => arr.map(x => [rng.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const rows = [], seenBase = new Set();
    const bands = (list, n, ovrOf, push) => DRAFT_BANDS.forEach(([lo, hi, share]) => {
      let k = 0; const quota = Math.round(n * share);
      for (const x of list) { if (k >= quota) break; const o = ovrOf(x); if (o >= lo && o <= hi && push(x)) k++; }
    });
    // ① 연도별 선수 (1982~)
    const vers = { KBO: [], NPB: [], MLB: [] };
    for (const id in SEASONS) {
      const base = DB_BY_ID.get(id);
      if (!base) continue;
      for (const [y, t, o] of SEASONS[id]) if (y < base.last || !(base.last >= LEAGUES[base.league].last - 1)) vers[base.league].push([id, y, t, o]);   // 현역의 마지막 해는 기본 선수와 같으므로 제외
    }
    ['KBO', 'NPB', 'MLB'].forEach(lg => {
      const perPerson = new Map();
      bands(shuffle(vers[lg]), DRAFT_SIZE[lg][1], x => x[3], ([id, y, t, o]) => {
        const base = DB_BY_ID.get(id), key = pk(base);
        if ((perPerson.get(key) || 0) >= 2 || ownedIds.has(`${id}@${y}`)) return false;      // 한 사람의 연도 버전은 풀에 최대 2개
        perPerson.set(key, (perPerson.get(key) || 0) + 1);
        const v = seasonVersion(base, y, o, SEASON_TEAMS[t]);
        rows.push([v.id, v.name, v.pos, lg, v.age, v.ovr, v.potential, `${y}년 ${SEASON_TEAMS[t]}`, id, y, SEASON_TEAMS[t], base.en || '']);
        return true;
      });
    });
    // ② 기본 선수 (어느 구단에도 없는 선수)
    const baseShuffled = shuffle(DB);
    ['KBO', 'NPB', 'MLB'].forEach(lg => {
      bands(baseShuffled.filter(p => p.league === lg && !owned.has(pk(p))), DRAFT_SIZE[lg][0], p => p.ovr, p => {
        if (seenBase.has(pk(p))) return false;              // 리그를 오간 같은 사람은 한 번만
        seenBase.add(pk(p));
        const active = p.last >= LEAGUES[lg].last - 1 && p.birthYear;
        rows.push([p.id, p.name, p.pos, lg, active ? S.year - p.birthYear : p.age, p.ovr, p.potential, `${p.first}~${p.last} ${p.team || ''}`.trim(), p.id, 0, '', p.en || '']);
        return true;
      });
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
      pool: D.pool.map(([id, name, pos, lg, age, ovr, pot, from, , , , en]) => ({ id, name, pos, league: lg, age, ovr, potential: pot, from, en }))
        .sort((a, b) => (b.potential * 0.7 + b.ovr * 0.3) - (a.potential * 0.7 + a.ovr * 0.3)),
      picks: D.picks.slice().reverse(), rosterSize: myTeam().roster.length, rosterMax: ROSTER_MAX,
    };
  }
  function openDraft() {
    if (!S.done || S.draft) return;
    const order = standings().slice().reverse().map(r => r.id);       // 꼴찌부터
    const rounds = DRAFT_ROUNDS;
    S.draft = { order, rounds, pick: 0, pool: draftCandidates(), picks: [] };
    runAiPicks();
  }
  function takeProspect(teamId, poolIdx) {
    const D = S.draft, row = D.pool.splice(poolIdx, 1)[0], t = team(teamId);
    const p = row[9] ? seasonVersion(DB_BY_ID.get(row[8]), row[9], row[5], row[10]) : DB_BY_ID.get(row[0]);
    p.setFatigue(0); initAge(p); p.farm = true;                    // 드래프트 신인은 2군에서 시작
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
    if (body.skip) {                                           // 이번 지명권 포기
      D.picks.push({ no: D.pick + 1, team: myTeam().name, name: '(지명 포기)', pos: '-', ovr: 0, potential: 0, mine: true });
      D.pick++;
      runAiPicks();
      return [200, { picked: '포기', draft: draftView() }];
    }
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

  // 남은 우리 지명권을 모두 자동으로 (가장 가치 높은 선수부터). 로스터가 가득 차면 멈춤
  function draftAutoAll() {
    const D = S.draft;
    if (!D) return [409, { error: '드래프트는 시즌이 끝나야 열립니다.' }];
    let n = 0;
    while (D.pick < D.order.length * D.rounds && D.pool.length) {
      if (D.order[D.pick % D.order.length] !== 0) runAiPicks();
      if (D.pick >= D.order.length * D.rounds || D.order[D.pick % D.order.length] !== 0) break;
      if (draftPick({ auto: true })[0] !== 200) break;
      n++;
    }
    return [200, { picked: n, draft: draftView() }];
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
      if (q && !p.name.toLowerCase().includes(q) && !(p.en || (DB_BY_ID.get(String(p.id).split('@')[0]) || {}).en || '').toLowerCase().includes(q)) continue;
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
    base.farm = firstTeam(myTeam()).length >= FIRST_MAX;           // 1군 정원이 차 있으면 2군으로
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
      p.morale === undefined ? null : p.morale, p.birthYear || 0, p.rookie ? 1 : 0, p.ageSet ? 1 : 0, p.farm ? 1 : 0]);
    const teams = S.teams.map(t => ({ id: t.id, name: t.name, user: t.user, group: t.group, league: t.league, w: t.w, l: t.l, rs: t.rs, ra: t.ra, streak: t.streak, roster: t.roster.map(p => p.id) }));
    return { version: 5, articles: S.articles || [], history: S.history || [], retired: S.retired || [], started: S.started !== false, league: S.league, allStar: S.allStar, intl: S.intl, voices: S.voices || [], trades: S.trades || [], draft: S.draft || null, offers: S.offers || [], offerDay: S.offerDay || 0,
      devReport: S.devReport || null, mode: S.mode, year: S.year, length: S.length, difficulty: S.difficulty, day: S.day, tp: S.tp, done: S.done, champion: S.champion,
      recent: S.recent, news: S.news, schedule: S.schedule, stats: S.stats, players: pl, teams };
  }
  function importState(o) {
    if (!o || ![1, 2, 3, 4, 5].includes(o.version) || o.career) return false;   // 폐지된 '커리어' 저장은 무시
    const players = {};
    o.players.forEach(([id, name, pos, league, age, ovr, pot, sal, con, tm, era, fat, first, last, most, morale, by, rookie, ageSet, farm]) => {
      const p = new Player(name, pos, league, age, ovr, pot, sal, con, tm, era);
      p.id = id; p.fatigue = fat; p.first = first || 0; p.last = last || 0; p.most = most || '';
      if (morale !== null && morale !== undefined) p.morale = morale;
      p.birthYear = by || 0; p.rookie = !!rookie; p.ageSet = !!ageSet; p.farm = !!farm;
      players[id] = p;
    });
    // 동일인 키·국가는 선수 DB 에서 다시 붙임
    Object.values(players).forEach(p => {
      const vid = String(p.id), at = vid.indexOf('@'), b = DB_BY_ID.get(at < 0 ? vid : vid.slice(0, at));
      if (b) { p.person = at < 0 ? b.person : `${b.person}@${vid.slice(at + 1)}`; p.country = b.country; p.sub = b.sub; if (!p.birthYear) p.birthYear = b.birthYear; } else { p.person = p.id; p.sub = null; }
    });
    const teams = o.teams.map(t => ({ group: '', league: o.league || 'KBO', ...t, roster: t.roster.map(id => players[id]).filter(Boolean) }));
    S = { version: 4, articles: o.articles || [], history: o.history || [], retired: o.retired || [], league: o.league || 'KBO', allStar: o.allStar || { day: -1, done: true, result: null }, intl: o.intl && o.intl.groups ? o.intl : null,
      voices: o.voices || [], trades: o.trades || [], draft: o.draft && o.draft.pool.every(r => DB_BY_ID.has(r[8] || r[0])) ? o.draft : null,   // 옛 가상 신인 드래프트 저장은 버림
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
      res = [200, { league: lg, teams: teamPreview(lg, ['legend', 'year'].includes(body.mode) ? body.mode : 'current', body.year) }];
    }
    else if (key === 'POST api/season/new') {
      newSeason({ length: Number(body.length || 36), team: body.team || null,
        difficulty: DIFFICULTY[body.difficulty] ? body.difficulty : 'NORMAL', keep: !!body.keep,
        mode: ['legend', 'year'].includes(body.mode) ? body.mode : 'current', year: body.year, league: LEAGUE_KEYS.includes(body.league) ? body.league : 'KBO' });
      res = [200, seasonView()];
    } else if (key === 'POST api/season/quick') res = quick(clamp(Number(body.days || 1), 1, 200));
    else if (key === 'GET api/stats') res = [200, statsView()];
    else if (key === 'GET api/allstar/squads') {
      const sq = allStarSquads();
      res = [200, { mine: { name: sq.mine.name, roster: squadRows(sq.mine.roster) }, theirs: { name: sq.theirs.name, roster: squadRows(sq.theirs.roster) } }];
    }
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
    else if (key === 'POST api/draft/auto') res = draftAutoAll();
    else if (key === 'POST api/setup') res = setupView(body.kind === 'intl' ? 'intl' : 'allstar');
    else if (key === 'GET api/schedule') res = [200, scheduleView()];
    else if (key === 'GET api/articles') res = [200, { articles: (S.articles || []).slice(0, 40) }];
    else if (key === 'GET api/locker') res = [200, { voices: (S.voices || []).slice().reverse(),
      roster: myTeam().roster.map(p => { joinMyTeam(p); return { name: p.name, pos: p.pos, morale: p.morale, mood: moodOf(p.morale), age: p.age }; })
        .sort((a, b) => a.morale - b.morale) }];
    else if (key === 'POST api/intl/new') { newIntl({ era: body.era === 'legend' ? 'legend' : 'current', country: body.country }); res = [200, intlView()]; }
    else if (key === 'POST api/intl/quick') res = intlQuick();
    else if (key === 'POST api/train') res = train(body);
    else if (key === 'POST api/scout/search') res = scoutSearch(body);
    else if (key === 'POST api/scout/sign') res = sign(body);
    else if (key === 'POST api/release') res = release(body);
    else if (key === 'POST api/retire') res = retireNow(body);
    else if (key === 'POST api/farm') res = farmMove(body);
    else if (key === 'GET api/retired') res = [200, { retired: (S.retired || []).slice(0, 80), last: S.retiredLast || [] }];
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
