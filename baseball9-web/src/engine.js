// 야구9단 매니저 — 브라우저용 게임 엔진 (JavaFX GameEngine → Python → JavaScript 포팅)
// dispatch(method, path, body) -> { status, payload } 형태로 Flask API와 같은 동작을 합니다.

// ── 난수 (테스트에서 시드 고정 가능) ─────────────────────
function makeRng(seed) {
  let a = (seed === undefined ? Math.floor(Math.random() * 2 ** 32) : seed) >>> 0;
  const next = () => {                       // mulberry32
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { random: next, randrange: n => Math.floor(next() * n) };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const PITCHER_POS = ['SP', 'RP'];
const POS_LABEL = { SP: '선발투수', RP: '불펜투수', C: '포수', '1B': '1루수', '2B': '2루수',
  '3B': '3루수', SS: '유격수', OF: '외야수', DH: '지명타자' };

let idCounter = 0;
const newId = () => (++idCounter).toString(36) + Math.random().toString(36).slice(2, 7);

function conditionOf(f) {
  if (f <= 15) return ['최상', 5];
  if (f <= 35) return ['좋음', 2];
  if (f <= 60) return ['보통', 0];
  if (f <= 80) return ['나쁨', -3];
  return ['부진', -7];
}

// ── 모델 ─────────────────────────────────────────────────
class Player {
  constructor(name, pos, league, age, ovr, potential, salary, contract, team, era) {
    Object.assign(this, { name, pos, league, age, ovr, potential, salary, contract, team, era });
    this.id = newId();
    this.fatigue = 0;
    this.hp = 100;
  }
  get isPitcher() { return PITCHER_POS.includes(this.pos); }
  get condition() { return conditionOf(this.fatigue); }
  // 실력 = 기본 능력치 + 컨디션(피로) + 사기(우리 팀 선수만, ±4)
  get moraleBonus() { return this.morale === undefined ? 0 : Math.max(-4, Math.min(4, Math.round((this.morale - 60) / 10))); }
  get effOvr() { return Math.min(99, Math.max(40, this.ovr + this.condition[1] + this.moraleBonus)); }
  setFatigue(v) { this.fatigue = clamp(Math.trunc(v), 0, 100); }
  setHp(v) { this.hp = clamp(Math.trunc(v), 0, 100); }
  toDict() {
    return { id: this.id, name: this.name, pos: this.pos, ovr: this.ovr, effOvr: this.effOvr,
      fatigue: this.fatigue, hp: this.hp, condition: this.condition[0], team: this.team, league: this.league,
      first: this.first || null, last: this.last || null, country: this.country || '',
      age: this.age, potential: this.potential, morale: this.morale === undefined ? null : this.morale, rookie: !!this.rookie,
      sub: this.sub || null, farm: !!this.farm };
  }
}

class PitcherLine {
  constructor(p) {
    this.pitcher = p; this.entryHp = p.hp; this.stamina = 0;
    this.pitches = 0; this.outs = 0; this.hits = 0; this.runs = 0; this.walks = 0; this.strikeouts = 0;
  }
  addPitch(drain) {
    this.pitches++;
    this.stamina += drain;
    this.pitcher.setHp(this.entryHp - Math.round(this.stamina));
  }
  get inningsText() { return `${Math.floor(this.outs / 3)}.${this.outs % 3}`; }
}

class TeamState {
  constructor(name, user) {
    this.name = name; this.user = user;
    this.lineup = []; this.roster = []; this.batterIdx = 0; this.pitcher = null;
    this.pitcherLines = []; this.runsByInning = []; this.score = 0; this.hits = 0;
  }
  get currentSlot() { return this.lineup.length ? this.batterIdx % this.lineup.length : 0; }
  currentBatter() { return this.lineup.length ? this.lineup[this.currentSlot] : null; }
  nextBatter() { return this.lineup.length ? this.lineup[(this.currentSlot + 1) % this.lineup.length] : null; }
  advanceBatter() { this.batterIdx++; }
  currentLine() { return this.pitcherLines.length ? this.pitcherLines[this.pitcherLines.length - 1] : null; }
  bench() { return this.roster.filter(p => !p.isPitcher && !this.lineup.includes(p)); }
  bullpen() {
    return this.roster.filter(p => p.isPitcher && p !== this.pitcher
      && !this.pitcherLines.some(l => l.pitcher === p));
  }
  startInning(i) {
    while (this.runsByInning.length < i) this.runsByInning.push(null);
    if (this.runsByInning[i - 1] === null) this.runsByInning[i - 1] = 0;
  }
  addInningRuns(i, n) { this.startInning(i); this.runsByInning[i - 1] += n; }
}

class GameState {
  constructor(myName, opponent) {
    this.opponent = opponent; this.inning = 1; this.top = true;
    this.outs = 0; this.balls = 0; this.strikes = 0; this.runners = [null, null, null];
    this.mine = new TeamState(myName, true); this.theirs = new TeamState(opponent, false);
    this.done = false; this.pitchTotal = 0;
  }
  offense() { return this.top ? this.mine : this.theirs; }
  defense() { return this.top ? this.theirs : this.mine; }
  hasRunners() { return this.runners.some(r => r !== null); }
}

// ── 중계 멘트 ────────────────────────────────────────────
const C = {
  pick: (rng, ...xs) => xs[rng.randrange(xs.length)],
  nm: p => (p ? p.name : '???'),
  runnersText(rn) {
    const s = [0, 1, 2].filter(i => rn[i]).map(i => String(i + 1));
    if (!s.length) return '주자 없음';
    if (s.length === 3) return '만루';
    return s.join('·') + '루';
  },
  situation: gs => `${gs.inning}회${gs.top ? '초' : '말'} · ${gs.outs}아웃 · ${C.runnersText(gs.runners)}`,
  scoreText: gs => `${gs.mine.name} ${gs.mine.score} : ${gs.theirs.score} ${gs.opponent}`,
  gameStart: gs => `⚾ 플레이 볼! ${gs.mine.name} vs ${gs.opponent} 경기를 시작합니다. 선발 ${C.nm(gs.mine.pitcher)} / ${C.nm(gs.theirs.pitcher)}`,
  atBatIntro(gs, b, p, mineBat) {
    const head = `[${C.situation(gs)}] `;
    if (mineBat) return head + `🎙 타석에 ${C.nm(b)} (${b.pos}, OVR ${b.effOvr})! 마운드에는 ${C.nm(p)} 투수입니다.`;
    return head + `🎙 ${C.nm(p)} 투수, 상대 타자 ${C.nm(b)} (${b.pos}) 상대로 승부합니다.`;
  },
  topStart: gs => `▲ ${gs.inning}회 초 ${gs.mine.name} 공격 · ${C.scoreText(gs)}`,
  bottomStart: gs => `▼ ${gs.inning}회 말 ${gs.opponent} 공격 · ${C.scoreText(gs)}`,
  gameEnd(gs) {
    const w = gs.mine.score > gs.theirs.score ? gs.mine.name : gs.opponent;
    return `🏁 경기 종료! ${w} 승리 — 최종 ${gs.mine.score} : ${gs.theirs.score}`;
  },
  ball: r => C.pick(r, '볼', '볼! 바깥쪽으로 빠집니다', '볼 판정, 공이 높았습니다', '공이 빠집니다, 볼'),
  whiff: r => C.pick(r, '헛스윙! 스트라이크', '스윙! 방망이가 공을 못 따라갑니다', '헛스윙, 빠른 승부!'),
  called: r => C.pick(r, '스트라이크 콜! 존 한가운데 걸쳤습니다', '꽉 찬 스트라이크 판정'),
  foul: r => C.pick(r, '파울, 커트해 냅니다', '파울! 방망이 끝에 걸렸습니다', '파울 — 끈질긴 승부입니다'),
  buntFoul: () => '번트 실패, 스트라이크 판정',
  groundOut: r => C.pick(r, '땅볼, 내야수가 잡아 1루에 송구... 아웃!', '내야 땅볼, 깔끔하게 처리합니다. 아웃!'),
  flyOut: r => C.pick(r, '뜬공, 외야수가 뒤로 물러나 잡습니다. 아웃!', '높이 뜬 공, 외야 정면에서 잡힙니다. 아웃!'),
  lineOut: () => '라인드라이브! 야수 정면으로 빨려 들어갑니다. 아웃!',
  sacFly: runner => `희생플라이! ${C.nm(runner)} 홈으로 쇄도, 득점!`,
  doublePlay: (b, runner) => `병살타! ${C.nm(b)}의 땅볼, 2루를 거쳐 1루까지... ${C.nm(runner)}과 타자 모두 아웃!`,
  fieldersChoice: b => `야수 선택! 2루에서 포스아웃, ${C.nm(b)} 1루 세이프`,
  sacBunt: b => `희생번트 성공! ${C.nm(b)} 자신을 희생하고 주자를 진루시킵니다`,
  buntPop: () => '번트 실패! 뜬공이 됩니다. 포수가 잡아 아웃!',
  hit(kind, r, b) {
    if (kind === 'SINGLE') return C.pick(r, `내야를 뚫는 안타! ${C.nm(b)} 1루 세이프`, '중전 안타! 주자들이 움직입니다', '좌전 안타, 1루 베이스를 밟습니다');
    if (kind === 'DOUBLE') return C.pick(r, '우익선상을 가르는 2루타!', '외야 갭을 꿰뚫는 2루타!');
    if (kind === 'TRIPLE') return '3루타! 외야가 뚫렸습니다, 세 베이스를 달립니다!';
    return C.pick(r, '홈런!!! 담장을 넘어갑니다!', '쭉쭉 뻗어 나간 타구, 홈런입니다!', '홈런!! 관중석이 환호합니다!');
  },
  walk: b => `${C.nm(b)} 볼넷, 1루로 걸어 나갑니다`,
  ibb: b => `고의사구! ${C.nm(b)} 1루로 걸어 나갑니다`,
  strikeout(r, b, called) {
    if (called) return C.pick(r, '삼진! 존을 지나간 공에 꼼짝 못 합니다', '스트라이크 아웃, 콜 삼진!');
    return C.pick(r, '삼진! 헛스윙으로 돌아섭니다', '스트라이크 아웃! 방망이 한 번 못 내밉니다');
  },
  stealSafe: (runner, to) => `도루 성공! ${C.nm(runner)} ${to}루 세이프`,
  stealOut: runner => `도루 실패! 포수 송구, ${C.nm(runner)} 아웃!`,
  scoreLine: (names, gs) => `🔔 득점! ${names} 홈을 밟습니다 · ${C.scoreText(gs)}`,
  aiPitcherChange: (o, n) => `📢 상대 감독, 투수 교체: ${C.nm(o)} → ${C.nm(n)} 등판`,
  aiIbb: () => '📢 상대 배터리, 고의사구를 택합니다',
  aiBunt: () => '📢 상대 감독, 번트 작전 사인!',
  pinchHit: (o, s) => `🔁 대타 교체: ${C.nm(o)} → ${C.nm(s)} 타석에 들어섭니다`,
  pinchRun: (o, s, base) => `🏃 대주자 투입: ${C.nm(o)} → ${C.nm(s)} (${base}루)`,
  pitcherChange: (o, n) => `🔄 투수 교체: ${C.nm(o)} → ${C.nm(n)} (${n.pos})`,
  colorRisp: () => '💬 해설: 득점권 찬스! 한 점이 승부를 가를 수 있는 상황입니다.',
  colorHomer: () => '💬 해설: 시원한 한 방입니다, 흐름이 확 바뀌네요.',
};

// ── 엔진 ─────────────────────────────────────────────────
const DIFFICULTY = { EASY: [0.82, '쉬움'], NORMAL: [1.0, '보통'], HARD: [1.18, '어려움'] };
const PITCH_CALLS = { AUTO: '자동', FASTBALL: '직구 위주', BREAKING: '변화구 위주', WASTE: '유인구(볼 유도)' };
const MODE = { PITCH: 'PITCH', AT_BAT: 'AT_BAT', HALF: 'HALF_INNING', GAME: 'GAME' };

class StepResult {
  constructor() { this.lines = []; this.atBatEnded = false; this.inningChanged = false; this.gameOver = false; }
  add(kind, text) { this.lines.push([kind, text]); }
  merge(o) {
    this.lines.push(...o.lines);
    this.atBatEnded ||= o.atBatEnded; this.inningChanged ||= o.inningChanged; this.gameOver ||= o.gameOver;
  }
}

const fallbackPitcher = () => new Player('대체 투수', 'RP', '국내', 27, 55, 55, 1.0, 1, '-', 2024);

class GameEngine {
  constructor(gs, { seed, difficulty = 'NORMAL' } = {}) {
    this.gs = gs; this.rng = makeRng(seed); this.difficulty = difficulty; this.pitchCall = 'AUTO';
    this.pendingBunt = false; this.pendingSteal = -1; this.pendingIbb = false;
    this.queue = []; this.atBatFresh = true; this.decisionAck = false;
    this.cosRng = makeRng(((seed === undefined ? 1 : seed) ^ 0x5bd1e995) >>> 0);   // 구종·구속·코스(화면용): 경기 결과 난수와 분리
    this.plate = []; this.plateKey = '';      // 현재(또는 직전) 타석의 투구 기록
    this.bat = new Map();      // 선수 id -> 이번 경기 타격 기록
    this.autoMine = false;     // true 면 우리 팀 투수 교체도 코치(AI)가 판단
    const { mine, theirs } = gs;
    mine.lineup.forEach(p => p.setHp(Math.max(40, 100 - p.fatigue)));
    if (!mine.pitcher) mine.pitcher = fallbackPitcher();
    if (!theirs.pitcher) theirs.pitcher = fallbackPitcher();
    this.introducePitcher(mine, mine.pitcher);
    this.introducePitcher(theirs, theirs.pitcher);
    mine.startInning(1);
    this.queue.push(['NEUTRAL', C.gameStart(gs)]);
  }

  get oppMult() { return DIFFICULTY[this.difficulty][0]; }

  stat(p) {
    if (!this.bat.has(p.id)) this.bat.set(p.id, { pa: 0, ab: 0, h: 0, d2: 0, d3: 0, hr: 0, rbi: 0, bb: 0, k: 0, r: 0, sb: 0, cs: 0 });
    return this.bat.get(p.id);
  }

  introducePitcher(t, p) {
    p.setHp(Math.max(40, 100 - p.fatigue));
    t.pitcher = p;
    t.pitcherLines.push(new PitcherLine(p));
  }

  drainQueue() { const out = this.queue; this.queue = []; return out; }

  needsDecision() {
    const gs = this.gs;
    if (gs.done || !this.atBatFresh || this.decisionAck) return false;
    if (gs.top) return gs.hasRunners();
    const p = gs.mine.pitcher;
    return !!p && p.hp < 45 && gs.mine.bullpen().length > 0;
  }

  ackDecision() { this.decisionAck = true; }

  run(mode, stopAtDecision = false) {
    const all = new StepResult();
    for (let guard = 0; guard < 5000; guard++) {
      if (stopAtDecision && this.needsDecision()) break;
      const r = this.step();
      all.merge(r);
      if (r.gameOver) break;
      if (mode === MODE.PITCH) break;
      if (mode === MODE.AT_BAT && r.atBatEnded) break;
      if (mode === MODE.HALF && r.inningChanged) break;
    }
    return all;
  }

  step() {
    const r = new StepResult();
    const gs = this.gs;
    if (gs.done) { r.gameOver = true; return r; }
    this.queue.forEach(([k, t]) => r.add(k, t));
    this.queue = [];

    const off = gs.offense(), dfn = gs.defense();
    const mineBat = gs.top;

    if (this.atBatFresh && mineBat) this.aiPitcherCheck(r, gs.theirs);
    if (this.atBatFresh && !mineBat && this.autoMine) this.aiPitcherCheck(r, gs.mine);
    if (this.atBatFresh) r.add('NEUTRAL', C.atBatIntro(gs, off.currentBatter(), dfn.pitcher, mineBat));

    if (this.atBatFresh && mineBat && this.aiWantsIbb(off)) {
      r.add('MANAGER', C.aiIbb());
      this.walkAndEnd(r, off, dfn, true);
      this.finish(r);
      return r;
    }
    if (!mineBat && this.pendingIbb) {
      this.pendingIbb = false;
      r.add('MANAGER', '🚫 고의4구 지시');
      this.walkAndEnd(r, off, dfn, true);
      this.finish(r);
      return r;
    }

    if (mineBat && this.pendingSteal >= 0) {
      const frm = this.pendingSteal;
      this.pendingSteal = -1;
      r.add('MANAGER', '🏃 도루 사인!');
      this.attemptSteal(r, off, dfn, frm);
    } else if (!mineBat || this.autoMine) {       // 사용자가 지휘하지 않는 쪽(AI 경기 포함)은 코치가 도루 판단
      const frm = this.aiStealBase();
      if (frm >= 0) this.attemptSteal(r, off, dfn, frm);
    }
    if (gs.outs >= 3) { this.finish(r); return r; }

    let bunt;
    if (mineBat && !this.autoMine) { bunt = this.pendingBunt; this.pendingBunt = false; }
    else bunt = this.atBatFresh && this.aiWantsBunt(off.currentBatter());
    if (bunt) {
      r.add('MANAGER', mineBat ? '🥎 번트 사인 실행!' : C.aiBunt());
      const ended = this.doBunt(r, off, dfn, off.currentBatter());
      this.atBatFresh = false;
      if (ended) this.endAtBat(r, off);
      this.finish(r);
      return r;
    }

    const batter = off.currentBatter();
    const pitcher = dfn.pitcher;
    const line = dfn.currentLine();
    let bOvr = batter.effOvr;
    if (!mineBat) bOvr = Math.trunc(bOvr * this.oppMult);
    const pOvr = this.pitcherEff(pitcher);
    const call = mineBat ? 'AUTO' : this.pitchCall;

    const bk = this.batterSkills(batter, bOvr), pks = this.pitcherSkills(pitcher, pOvr);
    const pitch = this.throwPitch(bk, pks, pOvr, call);
    const ev = this.recordPitch(pitch, pitcher, pOvr, batter, call);
    const tag = `[${ev.type} ${ev.speed}km/h] `;
    this.atBatFresh = false;
    line.addPitch(pitcher.pos === 'SP' ? 0.6 : 1.2);
    gs.pitchTotal++;

    if (pitch === 'BALL') {
      gs.balls++;
      r.add('PITCH', tag + C.ball(this.rng) + this.count());
      if (gs.balls >= 4) { this.walk(r, off, dfn, batter, false); this.endAtBat(r, off); }
    } else if (pitch === 'WHIFF' || pitch === 'CALLED') {
      gs.strikes++;
      r.add('PITCH', tag + (pitch === 'WHIFF' ? C.whiff(this.rng) : C.called(this.rng)) + this.count());
      if (gs.strikes >= 3) { this.strikeout(r, dfn, batter, pitch === 'CALLED'); this.endAtBat(r, off); }
    } else if (pitch === 'FOUL') {
      if (gs.strikes < 2) gs.strikes++;
      r.add('PITCH', tag + C.foul(this.rng) + this.count());
    } else {
      const n0 = r.lines.length;
      this.contact(r, off, dfn, batter, bk, pOvr, call);
      ev.outcome = r.lines.slice(n0).some(([k]) => k === 'HIT') ? 'hit' : 'out';
      this.endAtBat(r, off);
    }
    this.finish(r);
    return r;
  }

  count() { return `  [${this.gs.balls}-${this.gs.strikes}]`; }

  // 화면용 투구 기록: 구종·구속·스트라이크존 위치. 결과(볼/스트라이크/타격)는 이미 정해진 뒤에 꾸미므로 경기에는 영향 없음
  repertoire(p) {
    if (p._rep) return p._rep;
    const set = ['슬라이더', '커브', '체인지업', '포크볼', '커터', '싱커', '투심'];
    let h = 7;
    for (const ch of String(p.id || p.name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const rep = ['직구'];
    const n = 2 + (h % 2);
    for (let i = 0; i < n; i++) rep.push(set.splice((h >>> (i * 3 + 1)) % set.length, 1)[0]);
    p._rep = rep;
    return rep;
  }
  recordPitch(pitch, pitcher, pOvr, batter, call) {
    const gs = this.gs, R = this.cosRng, key = gs.inning + (gs.top ? 't' : 'b') + (batter ? batter.id : '');
    if (key !== this.plateKey) { this.plateKey = key; this.plate = []; }
    const rep = this.repertoire(pitcher);
    let type = '직구';
    if (call === 'BREAKING') type = rep[1 + R.randrange(rep.length - 1)];
    else if (call !== 'FASTBALL' && R.random() > 0.5) type = rep[1 + R.randrange(rep.length - 1)];
    const delta = { 직구: 0, 투심: -3, 싱커: -4, 커터: -5, 슬라이더: -11, 체인지업: -13, 포크볼: -12, 커브: -21 }[type];
    const base = 134 + (pOvr - 50) * 0.32 + (pitcher.pos === 'RP' ? 2 : 0);
    const speed = Math.max(112, Math.min(160, Math.round(base + delta + R.random() * 5 - 2)));
    const edge = () => (R.random() < 0.5 ? -1 : 1) * (0.7 + R.random() * 0.3);
    let x, y;
    if (pitch === 'BALL') {
      if (R.random() < 0.5) { x = (R.random() < 0.5 ? -1 : 1) * (1.15 + R.random() * 0.5); y = R.random() * 2.4 - 1.2; }
      else { x = R.random() * 2.4 - 1.2; y = (R.random() < 0.5 ? -1 : 1) * (1.15 + R.random() * 0.4); }
    } else if (pitch === 'WHIFF') { x = R.random() * 2.1 - 1.05; y = R.random() * 1.3 - 1.1; }
    else if (pitch === 'CALLED') { if (R.random() < 0.5) { x = edge(); y = R.random() * 1.8 - 0.9; } else { x = R.random() * 1.8 - 0.9; y = edge(); } }
    else { x = (R.random() + R.random() - 1) * 0.95; y = (R.random() + R.random() - 1) * 0.95; }
    const ev = { n: this.plate.length + 1, res: pitch, type, speed, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
    this.plate.push(ev);
    return ev;
  }

  // 세부 능력치 반영: 종합 능력치(OVR)에는 이미 컨택·파워·선구가 섞여 있으므로, 선수 본인 평균 대비 편차만 0.5 배로 반영
  // (스타일만 달라지고 전체 득점 환경은 유지). 세부 능력치가 없으면(신인 등) 종합 능력치 그대로
  batterSkills(b, ovr) {
    const s = b.sub;
    if (!s || s.length < 3) return { ovr, con: ovr, pow: ovr, eye: ovr };
    const m = (s[0] + s[1] + s[2]) / 3;
    return { ovr, con: ovr + 0.5 * (s[0] - m), pow: ovr + 0.5 * (s[1] - m), eye: ovr + 0.5 * (s[2] - m) };
  }
  pitcherSkills(p, ovr) {
    const s = p && p.sub;
    if (!s || s.length < 2) return { ovr, k: ovr, ctl: ovr };
    const m = (s[0] + s[1]) / 2;
    return { ovr, k: ovr + 0.5 * (s[0] - m), ctl: ovr + 0.5 * (s[1] - m) };
  }
  speedOf(p) { return p && p.sub && p.sub.length === 4 ? p.sub[3] : 50; }

  pitcherEff(p) {
    if (!p) return 50;
    const pen = p.hp < 60 ? Math.min(15, Math.floor((60 - p.hp) / 4)) : 0;
    return Math.max(30, p.effOvr - pen);
  }

  callMods(c) {
    return { FASTBALL: [-0.04, -0.02, 0.03], BREAKING: [0.02, 0.08, -0.03], WASTE: [0.10, 0.06, -0.05] }[c] || [0, 0, 0];
  }

  throwPitch(bk, pks, pOvr, call) {
    // sB/sP: 종합 능력치 기준(전체 환경), 아래 (세부 - 종합) 항: 스타일 편차에만 더 큰 계수
    const sB = (bk.ovr - 50) / 50, sP = (pks.ovr - 50) / 50;
    const dK = (pks.k - pks.ovr) / 50, dCtl = (pks.ctl - pks.ovr) / 50, dEye = (bk.eye - bk.ovr) / 50, dCon = (bk.con - bk.ovr) / 50;
    const m = this.callMods(call);
    const pBall = clamp(0.34 - 0.06 * sP + 0.02 * sB - 0.14 * dCtl + 0.14 * dEye + m[0], 0.15, 0.55);   // 볼: 투수 제구 vs 타자 선구
    if (this.rng.random() < pBall) return 'BALL';
    const two = this.gs.strikes >= 2 ? 0.10 : 0;
    let w = clamp(0.28 + 0.10 * sP - 0.07 * sB + 0.14 * dK - 0.10 * dCon + m[1] + two, 0.08, 0.55);   // 헛스윙: 투수 탈삼진 vs 타자 컨택
    let f = clamp(0.30 - 0.02 * sB, 0.20, 0.38);
    let c = 0.10;
    const tot = w + f + c;
    if (tot > 0.95) { const k = 0.95 / tot; w *= k; f *= k; c *= k; }
    const q = this.rng.random();
    if (q < w) return 'WHIFF';
    if (q < w + f) return 'FOUL';
    if (q < w + f + c) return 'CALLED';
    return 'IN_PLAY';
  }

  contact(r, off, dfn, batter, bk, pOvr, call) {
    const sB = (bk.ovr - 50) / 50, dCon = (bk.con - bk.ovr) / 50, dPow = (bk.pow - bk.ovr) / 50, sp = (pOvr - 50) / 50;
    const hitP = clamp(0.33 + 0.20 * sB + 0.28 * dCon - 0.15 * sp + this.callMods(call)[2], 0.12, 0.58);
    const u = this.rng.random();
    const ct = u < 0.44 ? 'GROUND' : (u < 0.84 ? 'FLY' : 'LINE');
    if (this.rng.random() >= hitP) {
      if (ct === 'GROUND') this.groundOut(r, off, dfn, batter);
      else if (ct === 'FLY') this.flyOut(r, off, dfn, batter);
      else { this.addOuts(dfn, 1); const st = this.stat(batter); st.pa++; st.ab++; r.add('OUT', C.lineOut()); }
      return;
    }
    const hr = clamp(0.18 + 0.14 * sB + 0.36 * dPow - 0.05 * sp, 0.04, 0.55);        // 홈런: 타자 파워
    const v = this.rng.random();
    let kind;
    if (ct === 'GROUND') kind = v < 0.92 ? 'SINGLE' : 'DOUBLE';
    else if (v < hr) kind = 'HOMER';
    else if (v < hr + 0.25) kind = 'DOUBLE';
    else if (v < hr + 0.28) kind = 'TRIPLE';
    else kind = 'SINGLE';
    this.hit(r, off, dfn, batter, kind);
  }

  hit(r, off, dfn, batter, kind) {
    let adv, batterAdv;
    const rn0 = this.gs.runners, ex = i => (this.speedOf(rn0[i]) - 50) * 0.004;      // 발 빠른 주자는 한 베이스 더
    if (kind === 'SINGLE') { adv = [this.rng.random() < 0.25 + ex(0) ? 2 : 1, this.rng.random() < 0.55 + ex(1) ? 2 : 1, 1]; batterAdv = 1; }
    else if (kind === 'DOUBLE') { adv = [this.rng.random() < 0.40 + ex(0) ? 3 : 2, 2, 1]; batterAdv = 2; }
    else if (kind === 'TRIPLE') { adv = [3, 2, 1]; batterAdv = 3; }
    else { adv = [3, 2, 1]; batterAdv = 4; }
    const scorers = this.advance(adv, batter, batterAdv);
    const st = this.stat(batter);
    st.pa++; st.ab++; st.h++; st.rbi += scorers.length;
    if (kind === 'DOUBLE') st.d2++; else if (kind === 'TRIPLE') st.d3++; else if (kind === 'HOMER') st.hr++;
    off.hits++;
    dfn.currentLine().hits++;
    r.add('HIT', C.hit(kind, this.rng, batter));
    if (kind === 'HOMER' && this.rng.random() < 0.5) r.add('COLOR', C.colorHomer());
    this.scoreRuns(r, scorers);
  }

  advance(adv, batter, batterAdv) {
    const old = this.gs.runners, nb = [null, null, null], scored = [];
    for (const i of [2, 1, 0]) {
      if (!old[i]) continue;
      const base = i + 1;
      let target = base + adv[i];
      if (target >= 4) { scored.push(old[i]); continue; }
      while (target > base && nb[target - 1]) target--;
      nb[target - 1] = old[i];
    }
    if (batterAdv >= 4) scored.push(batter);
    else if (batterAdv > 0) {
      let t = batterAdv;
      while (t > 1 && nb[t - 1]) t--;
      nb[t - 1] = batter;
    }
    this.gs.runners = nb;
    return scored;
  }

  groundOut(r, off, dfn, batter) {
    const rn = this.gs.runners, before = this.gs.outs;
    const st = this.stat(batter);
    st.pa++; st.ab++;
    if (rn[0] && before <= 1 && this.rng.random() < 0.40) {          // 병살
      const runner = rn[0];
      rn[0] = null;
      this.addOuts(dfn, 2);
      const scorers = [];
      if (before === 0 && rn[2]) { scorers.push(rn[2]); rn[2] = null; }
      if (rn[1] && !rn[2]) { rn[2] = rn[1]; rn[1] = null; }
      r.add('OUT', C.doublePlay(batter, runner));
      this.scoreRuns(r, scorers);
      return;
    }
    if (rn[0] && !rn[1] && before <= 1 && this.rng.random() < 0.35) { // 야수선택
      rn[0] = batter;
      this.addOuts(dfn, 1);
      r.add('OUT', C.fieldersChoice(batter));
      return;
    }
    this.addOuts(dfn, 1);
    const scorers = [];
    if (rn[2] && before < 2 && this.rng.random() < 0.10) { scorers.push(rn[2]); rn[2] = null; }
    if (rn[1] && !rn[2] && this.rng.random() < 0.25) { rn[2] = rn[1]; rn[1] = null; }
    if (rn[0] && !rn[1] && this.rng.random() < 0.20) { rn[1] = rn[0]; rn[0] = null; }
    st.rbi += scorers.length;
    r.add('OUT', C.groundOut(this.rng));
    this.scoreRuns(r, scorers);
  }

  flyOut(r, off, dfn, batter) {
    const rn = this.gs.runners, before = this.gs.outs;
    const st = this.stat(batter);
    st.pa++;
    this.addOuts(dfn, 1);
    if (rn[2] && before < 2 && this.rng.random() < 0.55) {
      st.rbi++;                         // 희생플라이: 타수 아님, 타점 1
      const runner = rn[2];
      rn[2] = null;
      r.add('OUT', C.sacFly(runner));
      this.scoreRuns(r, [runner]);
      return;
    }
    st.ab++;
    r.add('OUT', C.flyOut(this.rng));
  }

  walk(r, off, dfn, batter, intentional) {
    const rn = this.gs.runners, scorers = [];
    if (!rn[0]) rn[0] = batter;
    else if (!rn[1]) { rn[1] = rn[0]; rn[0] = batter; }
    else if (!rn[2]) { rn[2] = rn[1]; rn[1] = rn[0]; rn[0] = batter; }
    else { scorers.push(rn[2]); rn[2] = rn[1]; rn[1] = rn[0]; rn[0] = batter; }
    dfn.currentLine().walks++;
    const st = this.stat(batter);
    st.pa++; st.bb++; st.rbi += scorers.length;
    r.add('WALK', intentional ? C.ibb(batter) : C.walk(batter));
    this.scoreRuns(r, scorers);
  }

  walkAndEnd(r, off, dfn, intentional) {
    this.walk(r, off, dfn, off.currentBatter(), intentional);
    this.endAtBat(r, off);
  }

  strikeout(r, dfn, batter, called) {
    const st = this.stat(batter);
    st.pa++; st.ab++; st.k++;
    this.addOuts(dfn, 1);
    dfn.currentLine().strikeouts++;
    r.add('OUT', C.strikeout(this.rng, batter, called));
  }

  attemptSteal(r, off, dfn, frm) {
    const rn = this.gs.runners, to = frm + 1;
    if (frm < 0 || frm > 1 || !rn[frm] || rn[to]) return;
    const runner = rn[frm];
    const p = clamp(0.50 + (runner.effOvr - 60) * 0.006 + (this.speedOf(runner) - 50) * 0.008, 0.30, 0.95);   // 도루: 주력 중심
    rn[frm] = null;
    if (this.rng.random() < p) { rn[to] = runner; this.stat(runner).sb++; r.add('STEAL', C.stealSafe(runner, to + 1)); }
    else { this.addOuts(dfn, 1); this.stat(runner).cs++; r.add('STEAL', C.stealOut(runner)); }
  }

  doBunt(r, off, dfn, batter) {
    const rn = this.gs.runners, u = this.rng.random();
    dfn.currentLine().addPitch(1.2);
    this.gs.pitchTotal++;
    if (u < 0.68) {
      const before = this.gs.outs;
      this.addOuts(dfn, 1);
      let scorers = rn[2] ? [rn[2]] : [];
      if (before >= 2) scorers = [];
      this.gs.runners = [null, rn[0], rn[1]];
      const st = this.stat(batter);
      st.pa++; st.rbi += scorers.length;   // 희생번트: 타수 아님
      r.add('OUT', C.sacBunt(batter));
      this.scoreRuns(r, scorers);
      return true;
    }
    if (u < 0.78) { this.hit(r, off, dfn, batter, 'SINGLE'); return true; }
    if (u < 0.88) {
      this.gs.strikes++;
      r.add('PITCH', C.buntFoul() + this.count());
      if (this.gs.strikes >= 3) { this.strikeout(r, dfn, batter, false); return true; }
      return false;
    }
    this.addOuts(dfn, 1);
    const st = this.stat(batter);
    st.pa++; st.ab++;
    r.add('OUT', C.buntPop());
    return true;
  }

  addOuts(dfn, n) { this.gs.outs += n; dfn.currentLine().outs += n; }

  scoreRuns(r, scorers) {
    if (!scorers.length) return;
    const off = this.gs.offense(), dfn = this.gs.defense(), n = scorers.length;
    scorers.forEach(p => { this.stat(p).r++; });
    off.score += n;
    off.addInningRuns(this.gs.inning, n);
    dfn.currentLine().runs += n;
    r.add('SCORE', C.scoreLine(scorers.map(p => p.name).join(', '), this.gs));
    if (this.gs.inning >= 8 && this.rng.random() < 0.4) r.add('COLOR', C.colorRisp());
  }

  endAtBat(r, off) {
    off.advanceBatter();
    this.gs.balls = 0; this.gs.strikes = 0;
    this.atBatFresh = true; this.decisionAck = false;
    this.pendingBunt = false; this.pendingIbb = false; this.pendingSteal = -1;
    r.atBatEnded = true;
  }

  finish(r) {
    const gs = this.gs;
    if (gs.done) return;
    if (gs.outs >= 3) this.changeHalf(r);
    if (!gs.done && gs.inning >= 9 && !gs.top && gs.theirs.score > gs.mine.score) this.endGame(r);
  }

  changeHalf(r) {
    const gs = this.gs;
    gs.outs = 0; gs.balls = 0; gs.strikes = 0; gs.runners = [null, null, null];
    this.pendingBunt = false; this.pendingSteal = -1; this.pendingIbb = false;
    this.decisionAck = false; this.atBatFresh = true;
    if (gs.top) {
      gs.top = false;
      gs.theirs.startInning(gs.inning);
      r.add('INNING', C.bottomStart(gs));
    } else {
      if (gs.inning >= 9 && gs.mine.score !== gs.theirs.score) { this.endGame(r); return; }
      gs.inning++;
      gs.top = true;
      gs.mine.startInning(gs.inning);
      r.add('INNING', C.topStart(gs));
    }
    r.inningChanged = true;
  }

  endGame(r) { this.gs.done = true; r.gameOver = true; r.add('END', C.gameEnd(this.gs)); }

  aiPitcherCheck(r, t) {
    const p = t.pitcher, line = t.currentLine();
    if (!p || !line) return;
    if (!(p.hp <= 35 || line.pitches >= 100)) return;
    const all = t.bullpen();
    if (!all.length) return;
    // 불펜(RP) 우선, 지친 투수는 피함. 다른 날 선발을 위해 SP는 불펜이 없을 때만 사용
    const rp = all.filter(x => x.pos === 'RP');
    const fresh = rp.filter(x => x.fatigue < 40);
    const pen = fresh.length ? fresh : rp.length ? rp : all;
    const nxt = pen.reduce((a, b) => (b.effOvr > a.effOvr ? b : a));
    r.add('MANAGER', t === this.gs.mine ? `📋 코치 판단, 투수 교체: ${C.nm(p)} → ${C.nm(nxt)}` : C.aiPitcherChange(p, nxt));
    this.introducePitcher(t, nxt);
  }

  aiWantsIbb(off) {
    if (this.gs.runners[0] || this.gs.outs >= 2) return false;
    const b = off.currentBatter(), nb = off.nextBatter();
    return !!b && !!nb && b.effOvr >= 80 && nb.effOvr < 68 && this.rng.random() < 0.35;
  }

  aiWantsBunt(b) {
    return !!this.gs.runners[0] && this.gs.outs === 0 && !!b && b.effOvr < 62 && this.rng.random() < 0.30;
  }

  aiStealBase() {
    const rn = this.gs.runners;
    if (this.gs.outs >= 2) return -1;
    if (rn[0] && !rn[1] && this.speedOf(rn[0]) >= 55 && this.rng.random() < 0.06) return 0;
    if (rn[1] && !rn[2] && this.speedOf(rn[1]) >= 55 && this.rng.random() < 0.025) return 1;
    return -1;
  }

  // ── 감독 지시 ──
  canBunt() { return !this.gs.done && this.gs.top && !this.pendingBunt; }
  requestBunt() {
    if (!this.canBunt()) return false;
    this.pendingBunt = true;
    this.queue.push(['MANAGER', '🥎 번트 사인! 다음 투구에 번트를 댑니다']);
    return true;
  }
  stealableBases() {
    const gs = this.gs;
    if (gs.done || !gs.top || this.pendingSteal >= 0) return [];
    const rn = gs.runners, out = [];
    if (rn[0] && !rn[1]) out.push(0);
    if (rn[1] && !rn[2]) out.push(1);
    return out;
  }
  requestSteal(frm) {
    if (!this.stealableBases().includes(frm)) return false;
    this.pendingSteal = frm;
    this.queue.push(['MANAGER', `🏃 도루 사인! ${this.gs.runners[frm].name} 다음 투구에 스타트`]);
    return true;
  }
  canIbb() { return !this.gs.done && !this.gs.top && !this.gs.runners[0] && !this.pendingIbb; }
  requestIbb() {
    if (!this.canIbb()) return false;
    this.pendingIbb = true;
    this.queue.push(['MANAGER', '🚫 고의4구 지시! 1루를 비웁니다']);
    return true;
  }
  requestPinchHit(sub) {
    const gs = this.gs, t = gs.mine;
    if (gs.done || !gs.top || !t.bench().includes(sub)) return false;
    const old = t.currentBatter();
    t.lineup[t.currentSlot] = sub;
    gs.balls = 0; gs.strikes = 0;
    this.atBatFresh = true; this.pendingBunt = false;
    this.queue.push(['MANAGER', C.pinchHit(old, sub)]);
    return true;
  }
  requestPinchRun(base, sub) {
    const gs = this.gs, t = gs.mine;
    if (gs.done || !gs.top || ![0, 1, 2].includes(base)) return false;
    const old = gs.runners[base];
    if (!old || !t.bench().includes(sub)) return false;
    const idx = t.lineup.indexOf(old);
    if (idx < 0) return false;
    t.lineup[idx] = sub;
    gs.runners[base] = sub;
    this.queue.push(['MANAGER', C.pinchRun(old, sub, base + 1)]);
    return true;
  }
  requestPitcherChange(nxt) {
    const gs = this.gs, t = gs.mine;
    if (gs.done || gs.top || !t.bullpen().includes(nxt)) return false;
    const old = t.pitcher;
    this.introducePitcher(t, nxt);
    this.queue.push(['MANAGER', C.pitcherChange(old, nxt)]);
    return true;
  }
  setPitchCall(call) {
    if (!(call in PITCH_CALLS)) return false;
    this.pitchCall = call;
    return true;
  }
}

// ── 리그 (로스터 구성) ───────────────────────────────────
const ROSTER_POS = ['SP', 'SP', 'RP', 'RP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'DH', 'DH'];
const OPP_POS = ['SP', 'RP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'DH'];

// players.js 행: [id, 이름, 포지션, 리그, 출생연도, OVR, 잠재력, 마지막 소속, 최다 소속(계보), 첫 시즌, 마지막 시즌, 전성기, 국가, 동일인 키]
function playerFromRow(r) {
  const [id, name, pos, league, by, ovr, pot, last, most, first, lastY, peak, country, person, sub, en] = r;
  const p = new Player(name, pos, league, by ? peak - by : 28, ovr, pot, 0, 1, last, peak);
  p.id = id; p.most = most; p.first = first; p.last = lastY;
  p.country = country || ''; p.person = person || id;   // 리그가 달라도 같은 사람이면 같은 person
  p.en = en || '';                                         // 영어 이름(검색용, NPB·MLB)
  p.sub = sub && sub.length ? sub : null;                 // 타자 [컨택,파워,선구,주루] / 투수 [탈삼진,제구]
  p.birthYear = by || 0;
  return p;
}
// 같은 선수를 새 객체로 복사 (국가대표·올스타처럼 소속팀 피로와 분리할 때)
function clonePlayer(p) {
  const c = new Player(p.name, p.pos, p.league, p.age, p.ovr, p.potential, p.salary, p.contract, p.team, p.era);
  Object.assign(c, { id: p.id, most: p.most, first: p.first, last: p.last, country: p.country, person: p.person, birthYear: p.birthYear, sub: p.sub, en: p.en });
  return c;
}
const buildAllPlayers = () => PLAYERS.map(playerFromRow);
const candidates = (pool, pos, used) => pool.filter(p => p.pos === pos && !used.has(p.id)).sort((a, b) => b.ovr - a.ovr);

function fillRoster(result, used, pool, pitchers, count) {
  let have = result.filter(p => p.isPitcher === pitchers).length;
  if (have >= count) return;
  const extra = pool.filter(p => p.isPitcher === pitchers && !used.has(p.id)).sort((a, b) => b.ovr - a.ovr);
  for (const p of extra) {
    if (have >= count) break;
    used.add(p.id); result.push(p); have++;
  }
}

function buildAutoRoster(all, lo, hi, rng) {
  const inRange = all.filter(p => p.ovr >= lo && p.ovr <= hi);
  const result = [], used = new Set();
  for (const pos of ROSTER_POS) {
    let c = candidates(inRange, pos, used);
    if (!c.length) c = candidates(all, pos, used);
    if (!c.length) continue;
    const pick = c[rng.randrange(Math.min(3, c.length))];
    used.add(pick.id); result.push(pick);
  }
  fillRoster(result, used, all, false, 10);
  fillRoster(result, used, all, true, 5);
  return result;
}

function buildOppRoster(all, excludeIds, rng) {
  const pool = all.filter(p => !excludeIds.has(p.id));
  const result = [], used = new Set();
  for (const pos of OPP_POS) {
    const c = candidates(pool, pos, used);
    if (!c.length) continue;
    const pick = c[rng.randrange(Math.min(3, c.length))];
    used.add(pick.id); result.push(pick);
  }
  fillRoster(result, used, pool, false, 9);
  fillRoster(result, used, pool, true, 3);
  return result;
}

function updateDailyCondition(roster, rng) {
  roster.forEach(p => {
    // 하루 회복: 투수는 등판 간격이 있어 회복이 빠름(10~16), 야수는 3~10
    p.setFatigue(p.fatigue - (p.isPitcher ? 10 + rng.randrange(7) : 3 + rng.randrange(8)));
    const roll = rng.random();
    if (roll < 0.04) p.setFatigue(p.fatigue + rng.randrange(16) + 15);
    else if (roll < 0.08) p.setFatigue(p.fatigue - rng.randrange(11) - 10);
  });
}

function applyPostGameFatigue(team, rng) {
  team.lineup.forEach(p => p.setFatigue(p.fatigue + 4 + rng.randrange(6)));
  team.pitcherLines.forEach(l => {
    // 선발: 100구 던지면 피로 45 → 4~5일 휴식 / 불펜: 등판만 해도 몸 풀기 피로 12 + 투구 수
    const add = l.pitcher.pos === 'SP' ? Math.round(l.pitches * 0.45) : 12 + Math.round(l.pitches * 0.5);
    l.pitcher.setFatigue(l.pitcher.fatigue + add);
  });
}

// 포지션을 맞춘 9인 라인업: 포수·1루·2루·3루·유격수·외야 3명 + 지명타자(남은 최고 타자). 모자란 포지션은 남은 선수 중 가장 나은 선수로 채움.
// 타순은 점수(기본: 현재 능력치) 높은 순
function positionalLineup(hitters, score = p => p.effOvr) {
  const pool = [...hitters].sort((a, b) => score(b) - score(a)), lineup = [];
  const take = p => { lineup.push(p); pool.splice(pool.indexOf(p), 1); };
  let gaps = 0;
  ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF'].forEach(pos => { const p = pool.find(x => x.pos === pos); if (p) take(p); else gaps++; });
  for (let i = 0; i < gaps + 1 && pool.length; i++) take(pool[0]);          // 빈 포지션 + 지명타자
  return lineup.sort((a, b) => score(b) - score(a));
}
// 라인업 9명에게 수비 위치(포수·1·2·3루·유격수·좌·중·우익수·지명타자) 배정.
// 중견수는 주루(발)가 가장 빠른 외야수, 외야수가 4명이면 가장 느린 선수가 지명타자 (예: 발 느린 최형우는 지명타자)
function assignPositions(lineup) {
  const out = {}, used = new Set(), spd = p => (p.sub && p.sub.length === 4 ? p.sub[3] : 50);
  ['C', '1B', '2B', '3B', 'SS'].forEach(pos => { const p = lineup.find(x => x.pos === pos && !used.has(x)); if (p) { out[p.id] = pos; used.add(p); } });
  const of = lineup.filter(x => x.pos === 'OF' && !used.has(x)).sort((a, b) => spd(b) - spd(a));
  ['CF', 'LF', 'RF'].forEach(pos => { const p = of.shift(); if (p) { out[p.id] = pos; used.add(p); } });
  const rest = lineup.filter(x => !used.has(x)).sort((a, b) => b.effOvr - a.effOvr);
  const open = ['C', '1B', '2B', '3B', 'SS', 'CF', 'LF', 'RF'].filter(pos => !Object.values(out).includes(pos));
  open.forEach(pos => { const p = rest.pop(); if (p) out[p.id] = pos; });         // 빈 자리는 남은 선수 중 약한 순으로 채움
  rest.forEach((p, i) => { out[p.id] = 'DH'; });
  return out;
}
// 사용자가 정한 수비 위치(override: id → 위치)를 존중하고, 빠진 선수(대타 등)는 남은 자리에 자동 배정
const POS_SLOTS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
function resolvePositions(lineup, override) {
  const out = {}, taken = new Set();
  if (override) lineup.forEach(p => { const sl = override[p.id]; if (POS_SLOTS.includes(sl) && !taken.has(sl)) { out[p.id] = sl; taken.add(sl); } });
  const rest = lineup.filter(p => !out[p.id]);
  if (rest.length) {
    const auto = assignPositions(rest);
    rest.forEach(p => { const sl = auto[p.id]; if (sl && !taken.has(sl)) { out[p.id] = sl; taken.add(sl); } });
    rest.filter(p => !out[p.id]).forEach(p => { const sl = POS_SLOTS.find(x => !taken.has(x)); if (sl) { out[p.id] = sl; taken.add(sl); } });
  }
  return out;
}
const opponentNames = () => [...KBO_TEAMS, ...NPB_TEAMS, ...MLB_TEAMS];

if (typeof module !== 'undefined') {
  module.exports = { GameEngine, GameState, TeamState, Player, MODE, makeRng, C, DIFFICULTY, PITCH_CALLS, POS_LABEL,
    buildAllPlayers, playerFromRow, clonePlayer, positionalLineup, assignPositions, resolvePositions, POS_SLOTS, buildAutoRoster, updateDailyCondition, applyPostGameFatigue, newId };
}
