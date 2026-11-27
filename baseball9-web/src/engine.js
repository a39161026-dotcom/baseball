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
  get effOvr() { return Math.min(99, Math.max(40, this.ovr + this.condition[1])); }
  setFatigue(v) { this.fatigue = clamp(Math.trunc(v), 0, 100); }
  setHp(v) { this.hp = clamp(Math.trunc(v), 0, 100); }
  toDict() {
    return { id: this.id, name: this.name, pos: this.pos, ovr: this.ovr, effOvr: this.effOvr,
      fatigue: this.fatigue, hp: this.hp, condition: this.condition[0], team: this.team, league: this.league };
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

    if (this.atBatFresh && mineBat) this.aiPitcherCheck(r);
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
    } else if (!mineBat) {
      const frm = this.aiStealBase();
      if (frm >= 0) this.attemptSteal(r, off, dfn, frm);
    }
    if (gs.outs >= 3) { this.finish(r); return r; }

    let bunt;
    if (mineBat) { bunt = this.pendingBunt; this.pendingBunt = false; }
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

    const pitch = this.throwPitch(bOvr, pOvr, call);
    this.atBatFresh = false;
    line.addPitch(pitcher.pos === 'SP' ? 0.6 : 1.2);
    gs.pitchTotal++;

    if (pitch === 'BALL') {
      gs.balls++;
      r.add('PITCH', C.ball(this.rng) + this.count());
      if (gs.balls >= 4) { this.walk(r, off, dfn, batter, false); this.endAtBat(r, off); }
    } else if (pitch === 'WHIFF' || pitch === 'CALLED') {
      gs.strikes++;
      r.add('PITCH', (pitch === 'WHIFF' ? C.whiff(this.rng) : C.called(this.rng)) + this.count());
      if (gs.strikes >= 3) { this.strikeout(r, dfn, batter, pitch === 'CALLED'); this.endAtBat(r, off); }
    } else if (pitch === 'FOUL') {
      if (gs.strikes < 2) gs.strikes++;
      r.add('PITCH', C.foul(this.rng) + this.count());
    } else {
      this.contact(r, off, dfn, batter, bOvr, pOvr, call);
      this.endAtBat(r, off);
    }
    this.finish(r);
    return r;
  }

  count() { return `  [${this.gs.balls}-${this.gs.strikes}]`; }

  pitcherEff(p) {
    if (!p) return 50;
    const pen = p.hp < 60 ? Math.min(15, Math.floor((60 - p.hp) / 4)) : 0;
    return Math.max(30, p.effOvr - pen);
  }

  callMods(c) {
    return { FASTBALL: [-0.04, -0.02, 0.03], BREAKING: [0.02, 0.08, -0.03], WASTE: [0.10, 0.06, -0.05] }[c] || [0, 0, 0];
  }

  throwPitch(bOvr, pOvr, call) {
    const sp = (pOvr - 50) / 50, sb = (bOvr - 50) / 50, m = this.callMods(call);
    const pBall = clamp(0.34 - 0.06 * sp + 0.02 * sb + m[0], 0.15, 0.50);
    if (this.rng.random() < pBall) return 'BALL';
    const two = this.gs.strikes >= 2 ? 0.10 : 0;
    let w = clamp(0.28 + 0.10 * sp - 0.07 * sb + m[1] + two, 0.08, 0.50);
    let f = clamp(0.30 - 0.02 * sb, 0.20, 0.38);
    let c = 0.10;
    const tot = w + f + c;
    if (tot > 0.95) { const k = 0.95 / tot; w *= k; f *= k; c *= k; }
    const q = this.rng.random();
    if (q < w) return 'WHIFF';
    if (q < w + f) return 'FOUL';
    if (q < w + f + c) return 'CALLED';
    return 'IN_PLAY';
  }

  contact(r, off, dfn, batter, bOvr, pOvr, call) {
    const sb = (bOvr - 50) / 50, sp = (pOvr - 50) / 50;
    const hitP = clamp(0.33 + 0.20 * sb - 0.15 * sp + this.callMods(call)[2], 0.12, 0.55);
    const u = this.rng.random();
    const ct = u < 0.44 ? 'GROUND' : (u < 0.84 ? 'FLY' : 'LINE');
    if (this.rng.random() >= hitP) {
      if (ct === 'GROUND') this.groundOut(r, off, dfn, batter);
      else if (ct === 'FLY') this.flyOut(r, off, dfn, batter);
      else { this.addOuts(dfn, 1); r.add('OUT', C.lineOut()); }
      return;
    }
    const hr = clamp(0.18 + 0.14 * sb - 0.05 * sp, 0.05, 0.35);
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
    if (kind === 'SINGLE') { adv = [this.rng.random() < 0.25 ? 2 : 1, this.rng.random() < 0.55 ? 2 : 1, 1]; batterAdv = 1; }
    else if (kind === 'DOUBLE') { adv = [this.rng.random() < 0.40 ? 3 : 2, 2, 1]; batterAdv = 2; }
    else if (kind === 'TRIPLE') { adv = [3, 2, 1]; batterAdv = 3; }
    else { adv = [3, 2, 1]; batterAdv = 4; }
    const scorers = this.advance(adv, batter, batterAdv);
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
    r.add('OUT', C.groundOut(this.rng));
    this.scoreRuns(r, scorers);
  }

  flyOut(r, off, dfn, batter) {
    const rn = this.gs.runners, before = this.gs.outs;
    this.addOuts(dfn, 1);
    if (rn[2] && before < 2 && this.rng.random() < 0.55) {
      const runner = rn[2];
      rn[2] = null;
      r.add('OUT', C.sacFly(runner));
      this.scoreRuns(r, [runner]);
      return;
    }
    r.add('OUT', C.flyOut(this.rng));
  }

  walk(r, off, dfn, batter, intentional) {
    const rn = this.gs.runners, scorers = [];
    if (!rn[0]) rn[0] = batter;
    else if (!rn[1]) { rn[1] = rn[0]; rn[0] = batter; }
    else if (!rn[2]) { rn[2] = rn[1]; rn[1] = rn[0]; rn[0] = batter; }
    else { scorers.push(rn[2]); rn[2] = rn[1]; rn[1] = rn[0]; rn[0] = batter; }
    dfn.currentLine().walks++;
    r.add('WALK', intentional ? C.ibb(batter) : C.walk(batter));
    this.scoreRuns(r, scorers);
  }

  walkAndEnd(r, off, dfn, intentional) {
    this.walk(r, off, dfn, off.currentBatter(), intentional);
    this.endAtBat(r, off);
  }

  strikeout(r, dfn, batter, called) {
    this.addOuts(dfn, 1);
    dfn.currentLine().strikeouts++;
    r.add('OUT', C.strikeout(this.rng, batter, called));
  }

  attemptSteal(r, off, dfn, frm) {
    const rn = this.gs.runners, to = frm + 1;
    if (frm < 0 || frm > 1 || !rn[frm] || rn[to]) return;
    const runner = rn[frm];
    const p = clamp(0.50 + (runner.effOvr - 60) * 0.012, 0.35, 0.90);
    rn[frm] = null;
    if (this.rng.random() < p) { rn[to] = runner; r.add('STEAL', C.stealSafe(runner, to + 1)); }
    else { this.addOuts(dfn, 1); r.add('STEAL', C.stealOut(runner)); }
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
    r.add('OUT', C.buntPop());
    return true;
  }

  addOuts(dfn, n) { this.gs.outs += n; dfn.currentLine().outs += n; }

  scoreRuns(r, scorers) {
    if (!scorers.length) return;
    const off = this.gs.offense(), dfn = this.gs.defense(), n = scorers.length;
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

  aiPitcherCheck(r) {
    const t = this.gs.theirs, p = t.pitcher, line = t.currentLine();
    if (!p || !line) return;
    if (!(p.hp <= 35 || line.pitches >= 100)) return;
    const pen = t.bullpen();
    if (!pen.length) return;
    const nxt = pen.reduce((a, b) => (b.effOvr > a.effOvr ? b : a));
    r.add('MANAGER', C.aiPitcherChange(p, nxt));
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
    if (rn[0] && !rn[1] && rn[0].effOvr >= 60 && this.rng.random() < 0.05) return 0;
    if (rn[1] && !rn[2] && rn[1].effOvr >= 60 && this.rng.random() < 0.02) return 1;
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

const buildAllPlayers = () => PLAYERS.map(row => new Player(...row));
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
    p.setFatigue(p.fatigue - rng.randrange(8) - 3);
    const roll = rng.random();
    if (roll < 0.04) p.setFatigue(p.fatigue + rng.randrange(16) + 15);
    else if (roll < 0.08) p.setFatigue(p.fatigue - rng.randrange(11) - 10);
  });
}

function applyPostGameFatigue(team, rng) {
  team.lineup.forEach(p => p.setFatigue(p.fatigue + 4 + rng.randrange(6)));
  team.pitcherLines.forEach(l => {
    const rate = l.pitcher.pos === 'SP' ? 0.25 : 0.40;
    l.pitcher.setFatigue(l.pitcher.fatigue + Math.round(l.pitches * rate));
  });
}

const opponentNames = () => [...KBO_TEAMS, ...NPB_TEAMS, ...MLB_TEAMS];

// ── 서비스 (Flask API와 같은 형태) ───────────────────────
function createService(seed) {
  const rng = makeRng(seed);
  const league = { allPlayers: buildAllPlayers(), teamName: '나의 팀', roster: [], wins: 0, losses: 0, recent: [] };
  const games = new Map();

  function resetLeague(lo, hi) {
    league.roster = buildAutoRoster(league.allPlayers, lo, hi, rng);
    league.wins = 0; league.losses = 0; league.recent = [];
    updateDailyCondition(league.roster, rng);
  }
  resetLeague(75, 85);

  const find = (players, id) => players.find(p => p.id === id) || null;
  const pdict = (p, l) => {
    const d = p.toDict();
    if (l) Object.assign(d, { pitches: l.pitches, inn: l.inningsText, hits: l.hits, runs: l.runs, walks: l.walks, ks: l.strikeouts });
    d.posLabel = POS_LABEL[p.pos] || p.pos;
    return d;
  };
  const ls = (t, cols) => [...t.runsByInning, ...Array(cols - t.runsByInning.length).fill(null)];

  function stateDict(g) {
    const { gs, engine: e } = g, { mine, theirs } = gs;
    const cols = Math.max(9, mine.runsByInning.length, theirs.runsByInning.length);
    const curSlot = gs.top ? mine.currentSlot : -1;
    const batter = gs.offense().currentBatter();
    const needs = e.needsDecision();
    const d = {
      gameId: g.id, opponent: gs.opponent, myName: mine.name, inning: gs.inning, top: gs.top,
      outs: gs.outs, balls: gs.balls, strikes: gs.strikes,
      runners: gs.runners.map(r => (r ? r.name : null)),
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
      record: { wins: league.wins, losses: league.losses }, defending: gs.defense().name,
    };
    if (gs.done) d.box = { mine: mine.pitcherLines.map(l => pdict(l.pitcher, l)), theirs: theirs.pitcherLines.map(l => pdict(l.pitcher, l)) };
    return d;
  }

  const linesOut = lines => lines.map(([kind, text]) => ({ kind, text }));

  function recordResult(g) {
    if (g.finished) return;
    g.finished = true;
    const gs = g.gs, win = gs.mine.score > gs.theirs.score;
    if (win) league.wins++; else league.losses++;
    league.recent.push({ opponent: gs.opponent, result: win ? '승' : '패', score: `${gs.mine.score}:${gs.theirs.score}` });
    applyPostGameFatigue(gs.mine, rng);
  }

  const leagueView = () => ({
    teamName: league.teamName, record: { wins: league.wins, losses: league.losses },
    roster: league.roster.map(p => p.toDict()), recent: league.recent.slice(-5),
    opponents: opponentNames(), difficulties: Object.entries(DIFFICULTY).map(([id, v]) => ({ id, label: v[1] })),
  });

  function newGame(body) {
    const opp = body.opponent || opponentNames()[0];
    const difficulty = body.difficulty || 'NORMAL';
    if (!DIFFICULTY[difficulty]) return [400, { error: '난이도가 올바르지 않습니다.' }];
    const roster = league.roster;
    const pitchers = roster.filter(p => p.isPitcher);
    if (!pitchers.length) return [400, { error: '투수가 1명 이상 필요합니다.' }];
    let lineup;
    if (body.lineup && body.lineup.length) {
      lineup = body.lineup.map(id => find(roster, id));
      if (lineup.length !== 9 || lineup.some(p => !p || p.isPitcher)) return [400, { error: '타순은 야수 9명이어야 합니다.' }];
    } else {
      lineup = roster.filter(p => !p.isPitcher).sort((a, b) => b.effOvr - a.effOvr).slice(0, 9);
    }
    if (lineup.length < 9) return [400, { error: '타순은 야수 9명이 필요합니다.' }];
    let starter = body.starter ? find(roster, body.starter) : null;
    if (!starter || !starter.isPitcher) {
      starter = [...pitchers].sort((a, b) => (a.pos !== 'SP') - (b.pos !== 'SP') || a.fatigue - b.fatigue)[0];
    }
    const oppRoster = buildOppRoster(league.allPlayers, new Set(roster.map(p => p.id)), rng);
    const oppLineup = oppRoster.filter(p => !p.isPitcher).sort((a, b) => b.ovr - a.ovr).slice(0, 9);
    if (oppLineup.length < 9) return [400, { error: '상대 팀 타자가 부족합니다.' }];
    const oppStarter = oppRoster.find(p => p.pos === 'SP') || oppRoster.find(p => p.isPitcher) || null;

    const gs = new GameState(league.teamName, opp);
    gs.mine.lineup = [...lineup]; gs.mine.roster = [...roster]; gs.mine.pitcher = starter;
    gs.theirs.lineup = oppLineup; gs.theirs.roster = oppRoster; gs.theirs.pitcher = oppStarter;
    const engine = new GameEngine(gs, { seed: rng.randrange(2 ** 31), difficulty });
    const g = { id: newId() + newId(), gs, engine, finished: false };
    games.set(g.id, g);
    return [200, { state: stateDict(g), lines: linesOut(engine.drainQueue()) }];
  }

  function advance(id, body) {
    const g = games.get(id);
    if (!g) return [404, { error: '경기를 찾을 수 없습니다.' }];
    const mode = { pitch: MODE.PITCH, atbat: MODE.AT_BAT, inning: MODE.HALF, game: MODE.GAME }[body.mode] || MODE.PITCH;
    const stop = !!body.stopAtDecision;
    if (body.ack) g.engine.ackDecision();
    if (g.gs.done) return [200, { state: stateDict(g), lines: [], paused: false }];
    if (stop && g.engine.needsDecision()) return [200, { state: stateDict(g), lines: [], paused: true }];
    const res = g.engine.run(mode, stop);
    const lines = g.engine.drainQueue();
    if (res.gameOver) recordResult(g);
    return [200, { state: stateDict(g), lines: linesOut([...lines, ...res.lines]), paused: false, gameOver: res.gameOver }];
  }

  function order(id, body) {
    const g = games.get(id);
    if (!g) return [404, { error: '경기를 찾을 수 없습니다.' }];
    const { engine: e, gs } = g;
    let ok;
    switch (body.type) {
      case 'bunt': ok = e.requestBunt(); break;
      case 'steal': ok = e.requestSteal(Number(body.base)); break;
      case 'ibb': ok = e.requestIbb(); break;
      case 'pinch_hit': { const s = find(gs.mine.roster, body.id); ok = !!s && e.requestPinchHit(s); break; }
      case 'pinch_run': { const s = find(gs.mine.roster, body.id); ok = !!s && e.requestPinchRun(Number(body.base), s); break; }
      case 'pitcher': { const n = find(gs.mine.roster, body.id); ok = !!n && e.requestPitcherChange(n); break; }
      case 'pitch_call': ok = e.setPitchCall(body.call); break;
      default: return [400, { error: '알 수 없는 지시입니다.' }];
    }
    const lines = e.drainQueue();
    if (!ok) return [409, { error: '지금은 이 지시를 낼 수 없습니다.', state: stateDict(g) }];
    return [200, { state: stateDict(g), lines: linesOut(lines) }];
  }

  function dispatch(method, path, body = {}) {
    const parts = path.split('?')[0].split('/').filter(Boolean);
    let res;
    if (parts[0] !== 'api') res = [404, { error: 'not found' }];
    else if (method === 'GET' && parts.join('/') === 'api/league') res = [200, leagueView()];
    else if (method === 'POST' && parts.join('/') === 'api/league/reset') {
      resetLeague(Number(body.minOvr ?? 75), Number(body.maxOvr ?? 85));
      res = [200, leagueView()];
    } else if (method === 'POST' && parts.join('/') === 'api/game') res = newGame(body);
    else if (parts[1] === 'game' && parts.length >= 3) {
      const id = parts[2];
      if (method === 'GET' && parts.length === 3) {
        const g = games.get(id);
        res = g ? [200, { state: stateDict(g), lines: [] }] : [404, { error: '경기를 찾을 수 없습니다.' }];
      } else if (method === 'POST' && parts[3] === 'advance') res = advance(id, body);
      else if (method === 'POST' && parts[3] === 'order') res = order(id, body);
      else res = [404, { error: 'not found' }];
    } else res = [404, { error: 'not found' }];
    return { status: res[0], payload: res[1] };
  }

  return { dispatch, league, games };
}

if (typeof module !== 'undefined') {
  module.exports = { createService, GameEngine, GameState, Player, MODE, makeRng };
}
