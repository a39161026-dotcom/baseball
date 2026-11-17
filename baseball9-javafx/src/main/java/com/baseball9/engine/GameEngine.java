package com.baseball9.engine;

import com.baseball9.model.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * 투구 단위 야구 시뮬레이션 엔진 (UI 독립).
 *
 * - step(): 투구 1구 (필요 시 도루·번트·고의4구 등 선행 처리)
 * - 감독 지시(대타·대주자·번트·도루·고의4구·투수교체·구종 사인)는 다음 투구 전에 반영됩니다.
 * - needsDecision(): 감독 판단이 필요한 타석 시작 시점인지 알려줍니다 (자동 진행 일시정지용).
 */
public class GameEngine {

    // ── 공개 타입 ─────────────────────────────────────────

    public enum Difficulty {
        EASY(0.82, "쉬움"), NORMAL(1.0, "보통"), HARD(1.18, "어려움");
        private final double oppOvrMult;
        private final String label;
        Difficulty(double m, String l) { oppOvrMult = m; label = l; }
        public double getOppOvrMult() { return oppOvrMult; }
        public String getLabel() { return label; }
    }

    /** 수비 측 구종 사인 (우리 투수가 수비일 때 적용) */
    public enum PitchCall {
        AUTO("자동"), FASTBALL("직구 위주"), BREAKING("변화구 위주"), WASTE("유인구(볼 유도)");
        private final String label;
        PitchCall(String l) { label = l; }
        public String getLabel() { return label; }
        @Override public String toString() { return label; }
    }

    public enum Kind { NEUTRAL, PITCH, HIT, OUT, WALK, STEAL, MANAGER, COLOR, INNING, SCORE, END }

    public enum HitType { SINGLE, DOUBLE, TRIPLE, HOMER }

    /** run() 의 진행 단위 */
    public enum Mode { PITCH, AT_BAT, HALF_INNING, GAME }

    public static final class Line {
        private final Kind kind;
        private final String text;
        public Line(Kind kind, String text) { this.kind = kind; this.text = text; }
        public Kind getKind()  { return kind; }
        public String getText() { return text; }
    }

    public static final class StepResult {
        private final List<Line> lines = new ArrayList<>();
        private boolean atBatEnded, inningChanged, gameOver;

        public List<Line> getLines()      { return lines; }
        public boolean isAtBatEnded()     { return atBatEnded; }
        public boolean isInningChanged()  { return inningChanged; }
        public boolean isGameOver()       { return gameOver; }

        void add(Kind k, String t) { lines.add(new Line(k, t)); }

        void merge(StepResult o) {
            lines.addAll(o.lines);
            atBatEnded |= o.atBatEnded;
            inningChanged |= o.inningChanged;
            gameOver |= o.gameOver;
        }
    }

    private enum Pitch { BALL, WHIFF, CALLED, FOUL, IN_PLAY }
    private enum Contact { GROUND, FLY, LINE }

    // ── 상태 ──────────────────────────────────────────────
    private final Random rng = new Random();
    private Difficulty difficulty = Difficulty.NORMAL;
    private PitchCall pitchCall = PitchCall.AUTO;
    private GameState gs;

    // 감독 지시 대기열 (다음 투구 전에 처리)
    private boolean pendingBunt;
    private int pendingSteal = -1;       // 도루 시도할 주자의 베이스 인덱스 (0=1루, 1=2루)
    private boolean pendingIbb;
    private final List<Line> queue = new ArrayList<>();   // 지시 기록(다음 step에서 로그로 출력)

    private boolean atBatFresh = true;   // 아직 투구 전인 타석인지
    private boolean decisionAck;         // 이번 타석의 감독 판단 시점을 이미 넘겼는지

    // ── 설정 ──────────────────────────────────────────────
    public void setDifficulty(Difficulty d) { this.difficulty = d; }
    public Difficulty getDifficulty()       { return difficulty; }
    public GameState getGs()                { return gs; }
    public PitchCall getPitchCall()         { return pitchCall; }
    public void setPitchCall(PitchCall c)   { this.pitchCall = c; }

    // ── 경기 시작 ─────────────────────────────────────────
    public void startGame(GameState state) {
        this.gs = state;
        queue.clear();
        pendingBunt = false;
        pendingSteal = -1;
        pendingIbb = false;
        atBatFresh = true;
        decisionAck = false;
        pitchCall = PitchCall.AUTO;

        TeamState mine = gs.getMine(), theirs = gs.getTheirs();
        for (Player p : mine.getLineup()) p.setHp(Math.max(40, 100 - p.getFatigue()));

        if (mine.getPitcher() == null) mine.setPitcher(fallbackPitcher());
        if (theirs.getPitcher() == null) theirs.setPitcher(fallbackPitcher());
        introducePitcher(mine, mine.getPitcher());
        introducePitcher(theirs, theirs.getPitcher());

        mine.startInning(1);
        queue.add(new Line(Kind.NEUTRAL, Commentary.gameStart(gs)));
    }

    private Player fallbackPitcher() {
        return new Player("대체 투수", Position.RP, "국내", 27, 55, 55, 1.0, 1, "-", 2024);
    }

    private void introducePitcher(TeamState t, Player p) {
        p.setHp(Math.max(40, 100 - p.getFatigue()));
        t.setPitcher(p);
        t.getPitcherLines().add(new PitcherLine(p));
    }

    // ── 진행 ──────────────────────────────────────────────

    /** 판단이 필요한 타석 시작인지: 우리 공격 + 주자 있음 / 우리 투수 체력 저하 */
    public boolean needsDecision() {
        if (gs == null || gs.isDone() || !atBatFresh || decisionAck) return false;
        if (gs.isTop()) return gs.hasRunners();
        Player p = gs.getMine().getPitcher();
        return p != null && p.getHp() < 45 && !gs.getMine().bullpen().isEmpty();
    }

    /** 감독 판단 시점을 넘김 (자동 진행 재개할 때 호출) */
    public void ackDecision() { decisionAck = true; }

    /** 지정 단위만큼 진행 (감독 판단 지점에서 멈추지 않음) */
    public StepResult run(Mode mode) {
        return run(mode, false);
    }

    /** 지정 단위만큼 진행. stopAtDecision=true 이면 감독 판단 지점(needsDecision)에서 멈춤 */
    public StepResult run(Mode mode, boolean stopAtDecision) {
        StepResult all = new StepResult();
        if (gs == null) return all;
        int guard = 0;
        do {
            if (stopAtDecision && needsDecision()) break;
            StepResult r = step();
            all.merge(r);
            if (r.isGameOver()) break;
            if (mode == Mode.PITCH) break;
            if (mode == Mode.AT_BAT && r.isAtBatEnded()) break;
            if (mode == Mode.HALF_INNING && r.isInningChanged()) break;
        } while (++guard < 5000);
        return all;
    }

    /** 대기 중인 안내 줄(경기 시작 등)을 꺼냄 */
    public List<Line> drainQueue() {
        List<Line> out = new ArrayList<>(queue);
        queue.clear();
        return out;
    }

    /** 투구 1구 진행 */
    public StepResult step() {
        StepResult r = new StepResult();
        if (gs == null) return r;
        if (gs.isDone()) { r.gameOver = true; return r; }

        for (Line l : queue) r.lines.add(l);
        queue.clear();

        TeamState off = gs.offense(), def = gs.defense();
        boolean mineBat = gs.isTop();

        // (1) 상대 투수 교체 (AI) — 우리 공격 타석 시작 시
        if (atBatFresh && mineBat) aiPitcherCheck(r);

        // (2) 타석 안내
        if (atBatFresh) {
            r.add(Kind.NEUTRAL, Commentary.atBatIntro(gs, off.currentBatter(), def.getPitcher(), mineBat));
        }

        // (3) 고의4구: 우리 수비 지시 또는 상대 AI 판단
        if (atBatFresh && mineBat && aiWantsIbb(off)) {
            r.add(Kind.MANAGER, Commentary.aiIbb());
            endAtBatWithWalk(r, off, def, true);
            finish(r);
            return r;
        }
        if (!mineBat && pendingIbb) {
            pendingIbb = false;
            r.add(Kind.MANAGER, "🚫 고의4구 지시");
            endAtBatWithWalk(r, off, def, true);
            finish(r);
            return r;
        }

        // (4) 도루: 우리 지시 또는 상대 AI
        if (mineBat && pendingSteal >= 0) {
            int from = pendingSteal;
            pendingSteal = -1;
            r.add(Kind.MANAGER, "🏃 도루 사인!");
            attemptSteal(r, off, def, from);
        } else if (!mineBat) {
            int from = aiStealBase();
            if (from >= 0) attemptSteal(r, off, def, from);
        }
        if (gs.getOuts() >= 3) {           // 도루 실패로 이닝 종료
            finish(r);
            return r;
        }

        // (5) 번트
        boolean bunt = mineBat ? pendingBunt : (atBatFresh && aiWantsBunt(off.currentBatter()));
        if (mineBat) pendingBunt = false;
        if (bunt) {
            if (!mineBat) r.add(Kind.MANAGER, Commentary.aiBunt());
            else r.add(Kind.MANAGER, "🥎 번트 사인 실행!");
            boolean ended = doBunt(r, off, def, off.currentBatter());
            atBatFresh = false;
            if (ended) endAtBat(r, off);
            finish(r);
            return r;
        }

        // (6) 투구
        Player batter = off.currentBatter();
        Player pitcher = def.getPitcher();
        PitcherLine line = def.currentLine();

        int bOvr = batter.getEffectiveOvr();
        if (!mineBat) bOvr = (int) (bOvr * difficulty.getOppOvrMult());
        int pOvr = pitcherEff(pitcher);
        PitchCall call = mineBat ? PitchCall.AUTO : pitchCall;

        Pitch p = throwPitch(bOvr, pOvr, call);
        atBatFresh = false;
        line.addPitch(pitcher.getPos() == Position.SP ? 0.6 : 1.2);
        gs.setPitchTotal(gs.getPitchTotal() + 1);

        switch (p) {
            case BALL -> {
                gs.setBalls(gs.getBalls() + 1);
                r.add(Kind.PITCH, Commentary.ball(rng) + count());
                if (gs.getBalls() >= 4) {
                    walk(r, off, def, batter, false);
                    endAtBat(r, off);
                }
            }
            case WHIFF, CALLED -> {
                gs.setStrikes(gs.getStrikes() + 1);
                boolean whiff = p == Pitch.WHIFF;
                r.add(Kind.PITCH, (whiff ? Commentary.whiff(rng) : Commentary.called(rng)) + count());
                if (gs.getStrikes() >= 3) {
                    strikeout(r, def, batter, !whiff);
                    endAtBat(r, off);
                }
            }
            case FOUL -> {
                if (gs.getStrikes() < 2) gs.setStrikes(gs.getStrikes() + 1);   // 2스트라이크 이후 파울은 카운트 불변
                r.add(Kind.PITCH, Commentary.foul(rng) + count());
            }
            case IN_PLAY -> {
                contact(r, off, def, batter, bOvr, pOvr, call);
                endAtBat(r, off);
            }
        }

        finish(r);
        return r;
    }

    private String count() {
        return "  [" + gs.getBalls() + "-" + gs.getStrikes() + "]";
    }

    // ── 투구 결정 ─────────────────────────────────────────

    /** 투수 체력이 떨어지면 능력치 감소 (최대 -15) */
    private int pitcherEff(Player p) {
        if (p == null) return 50;
        int base = p.getEffectiveOvr();
        int hp = p.getHp();
        int pen = hp < 60 ? Math.min(15, (60 - hp) / 4) : 0;
        return Math.max(30, base - pen);
    }

    /** 구종 사인 보정: {볼, 헛스윙, 안타} */
    private double[] callMods(PitchCall c) {
        return switch (c) {
            case FASTBALL -> new double[]{-0.04, -0.02, +0.03};
            case BREAKING -> new double[]{+0.02, +0.08, -0.03};
            case WASTE    -> new double[]{+0.10, +0.06, -0.05};
            default       -> new double[]{0, 0, 0};
        };
    }

    private Pitch throwPitch(int bOvr, int pOvr, PitchCall call) {
        double sp = (pOvr - 50) / 50.0;
        double sb = (bOvr - 50) / 50.0;
        double[] m = callMods(call);

        double pBall = clamp(0.34 - 0.06 * sp + 0.02 * sb + m[0], 0.15, 0.50);
        if (rng.nextDouble() < pBall) return Pitch.BALL;

        // 2스트라이크 이후에는 유인구·헛스윙이 늘어남
        double twoStrikeBonus = gs.getStrikes() >= 2 ? 0.10 : 0.0;
        double w = clamp(0.28 + 0.10 * sp - 0.07 * sb + m[1] + twoStrikeBonus, 0.08, 0.50);  // 헛스윙
        double f = clamp(0.30 - 0.02 * sb, 0.20, 0.38);                    // 파울
        double c = 0.10;                                                    // 볼 판정 스트라이크
        double tot = w + f + c;
        if (tot > 0.95) { double k = 0.95 / tot; w *= k; f *= k; c *= k; }

        double q = rng.nextDouble();
        if (q < w) return Pitch.WHIFF;
        if (q < w + f) return Pitch.FOUL;
        if (q < w + f + c) return Pitch.CALLED;
        return Pitch.IN_PLAY;
    }

    // ── 타구 처리 ─────────────────────────────────────────

    private void contact(StepResult r, TeamState off, TeamState def, Player batter,
                         int bOvr, int pOvr, PitchCall call) {
        double sb = (bOvr - 50) / 50.0;
        double sp = (pOvr - 50) / 50.0;
        double hitP = clamp(0.33 + 0.20 * sb - 0.15 * sp + callMods(call)[2], 0.12, 0.55);

        double u = rng.nextDouble();
        Contact ct = u < 0.44 ? Contact.GROUND : (u < 0.84 ? Contact.FLY : Contact.LINE);
        boolean hit = rng.nextDouble() < hitP;

        if (!hit) {
            switch (ct) {
                case GROUND -> groundOut(r, off, def, batter);
                case FLY    -> flyOut(r, off, def, batter);
                case LINE   -> { addOuts(def, 1); r.add(Kind.OUT, Commentary.lineOut()); }
            }
            return;
        }

        double hr = clamp(0.18 + 0.14 * sb - 0.05 * sp, 0.05, 0.35);
        double v = rng.nextDouble();
        HitType type;
        if (ct == Contact.GROUND) {
            type = v < 0.92 ? HitType.SINGLE : HitType.DOUBLE;
        } else {
            if (v < hr) type = HitType.HOMER;
            else if (v < hr + 0.25) type = HitType.DOUBLE;
            else if (v < hr + 0.28) type = HitType.TRIPLE;
            else type = HitType.SINGLE;
        }
        hit(r, off, def, batter, type);
    }

    /** 안타 처리: 주자 진루 + 득점 */
    private void hit(StepResult r, TeamState off, TeamState def, Player batter, HitType type) {
        int[] adv;
        int batterAdv;
        switch (type) {
            case SINGLE -> {
                adv = new int[]{ rng.nextDouble() < 0.25 ? 2 : 1, rng.nextDouble() < 0.55 ? 2 : 1, 1 };
                batterAdv = 1;
            }
            case DOUBLE -> {
                adv = new int[]{ rng.nextDouble() < 0.40 ? 3 : 2, 2, 1 };
                batterAdv = 2;
            }
            case TRIPLE -> { adv = new int[]{3, 2, 1}; batterAdv = 3; }
            default     -> { adv = new int[]{3, 2, 1}; batterAdv = 4; }   // 홈런: 전원 득점
        }

        List<Player> scorers = advance(adv, batter, batterAdv);
        off.addHits(1);
        def.currentLine().addHits(1);
        r.add(Kind.HIT, Commentary.hit(type, rng, batter, scorers.size()));
        if (type == HitType.HOMER && rng.nextDouble() < 0.5) r.add(Kind.COLOR, Commentary.colorHomer());
        scoreRuns(r, scorers);
    }

    /** 주자 진루 공통 처리. adv[i]: i번째 베이스 주자의 진루 수. batterAdv: 타자 도달 베이스 (0이면 타자 없음, 4이면 득점) */
    private List<Player> advance(int[] adv, Player batter, int batterAdv) {
        Player[] old = gs.getRunners();
        Player[] nb = new Player[3];
        List<Player> scored = new ArrayList<>();

        for (int i = 2; i >= 0; i--) {          // 앞 주자부터 처리
            if (old[i] == null) continue;
            int base = i + 1;
            int target = base + adv[i];
            if (target >= 4) { scored.add(old[i]); continue; }
            while (target > base && nb[target - 1] != null) target--;   // 앞 주자와 겹치면 한 베이스 뒤에 멈춤
            nb[target - 1] = old[i];
        }

        if (batterAdv >= 4) {
            scored.add(batter);
        } else if (batterAdv > 0) {
            int t = batterAdv;
            while (t > 1 && nb[t - 1] != null) t--;
            nb[t - 1] = batter;
        }
        gs.setRunners(nb);
        return scored;
    }

    private void groundOut(StepResult r, TeamState off, TeamState def, Player batter) {
        Player[] rn = gs.getRunners();
        int before = gs.getOuts();

        // 병살: 1루 주자 있고 아웃 2개 이하일 때 40%
        if (rn[0] != null && before <= 1 && rng.nextDouble() < 0.40) {
            Player runner = rn[0];
            rn[0] = null;
            addOuts(def, 2);
            List<Player> scorers = new ArrayList<>();
            if (before == 0 && rn[2] != null) { scorers.add(rn[2]); rn[2] = null; }
            if (rn[1] != null && rn[2] == null) { rn[2] = rn[1]; rn[1] = null; }
            r.add(Kind.OUT, Commentary.doublePlay(batter, runner));
            scoreRuns(r, scorers);
            return;
        }

        // 야수선택: 1루 주자만 있을 때 2루 포스아웃, 타자 1루 세이프
        if (rn[0] != null && rn[1] == null && before <= 1 && rng.nextDouble() < 0.35) {
            rn[0] = batter;
            addOuts(def, 1);
            r.add(Kind.OUT, Commentary.fieldersChoice(batter));
            return;
        }

        addOuts(def, 1);
        List<Player> scorers = new ArrayList<>();
        if (rn[2] != null && before < 2 && rng.nextDouble() < 0.10) { scorers.add(rn[2]); rn[2] = null; }
        if (rn[1] != null && rn[2] == null && rng.nextDouble() < 0.25) { rn[2] = rn[1]; rn[1] = null; }
        if (rn[0] != null && rn[1] == null && rng.nextDouble() < 0.20) { rn[1] = rn[0]; rn[0] = null; }
        r.add(Kind.OUT, Commentary.groundOut(rng, batter));
        scoreRuns(r, scorers);
    }

    private void flyOut(StepResult r, TeamState off, TeamState def, Player batter) {
        Player[] rn = gs.getRunners();
        int before = gs.getOuts();
        addOuts(def, 1);
        if (rn[2] != null && before < 2 && rng.nextDouble() < 0.55) {
            Player runner = rn[2];
            rn[2] = null;
            r.add(Kind.OUT, Commentary.sacFly(runner));
            scoreRuns(r, List.of(runner));
            return;
        }
        r.add(Kind.OUT, Commentary.flyOut(rng));
    }

    /** 볼넷 / 고의4구 (밀어내기) */
    private void walk(StepResult r, TeamState off, TeamState def, Player batter, boolean intentional) {
        Player[] rn = gs.getRunners();
        List<Player> scorers = new ArrayList<>();
        if (rn[0] == null) {
            rn[0] = batter;
        } else if (rn[1] == null) {
            rn[1] = rn[0]; rn[0] = batter;
        } else if (rn[2] == null) {
            rn[2] = rn[1]; rn[1] = rn[0]; rn[0] = batter;
        } else {                                  // 만루: 3루 주자 밀려 득점
            scorers.add(rn[2]);
            rn[2] = rn[1]; rn[1] = rn[0]; rn[0] = batter;
        }
        def.currentLine().addWalks(1);
        r.add(Kind.WALK, intentional ? Commentary.intentionalWalk(batter) : Commentary.walk(batter));
        scoreRuns(r, scorers);
    }

    private void endAtBatWithWalk(StepResult r, TeamState off, TeamState def, boolean intentional) {
        walk(r, off, def, off.currentBatter(), intentional);
        endAtBat(r, off);
    }

    private void strikeout(StepResult r, TeamState def, Player batter, boolean called) {
        addOuts(def, 1);
        def.currentLine().addStrikeouts(1);
        r.add(Kind.OUT, Commentary.strikeout(rng, batter, called));
    }

    /** 도루 시도: 1루→2루(from=0), 2루→3루(from=1) */
    private void attemptSteal(StepResult r, TeamState off, TeamState def, int from) {
        Player[] rn = gs.getRunners();
        int to = from + 1;
        if (from < 0 || from > 1 || rn[from] == null || rn[to] != null) return;

        Player runner = rn[from];
        double p = clamp(0.50 + (runner.getEffectiveOvr() - 60) * 0.012, 0.35, 0.90);
        rn[from] = null;
        if (rng.nextDouble() < p) {
            rn[to] = runner;
            r.add(Kind.STEAL, Commentary.stealSafe(runner, to + 1));
        } else {
            addOuts(def, 1);
            r.add(Kind.STEAL, Commentary.stealOut(runner));
        }
    }

    /** 번트. true 를 반환하면 타석 종료 */
    private boolean doBunt(StepResult r, TeamState off, TeamState def, Player batter) {
        Player[] rn = gs.getRunners();
        double u = rng.nextDouble();
        def.currentLine().addPitch(1.2);
        gs.setPitchTotal(gs.getPitchTotal() + 1);

        if (u < 0.68) {                           // 희생번트 성공
            int before = gs.getOuts();
            addOuts(def, 1);
            List<Player> scorers = new ArrayList<>();
            if (rn[2] != null) scorers.add(rn[2]);
            Player[] nb = new Player[3];
            nb[2] = rn[1];
            nb[1] = rn[0];
            if (before >= 2) scorers.clear();     // 3아웃이면 득점 불인정
            gs.setRunners(nb);
            r.add(Kind.OUT, Commentary.sacBunt(batter));
            scoreRuns(r, scorers);
            return true;
        }
        if (u < 0.78) {                           // 번트 안타
            hit(r, off, def, batter, HitType.SINGLE);
            return true;
        }
        if (u < 0.88) {                           // 번트 파울 = 스트라이크
            gs.setStrikes(gs.getStrikes() + 1);
            r.add(Kind.PITCH, Commentary.buntFoul() + count());
            if (gs.getStrikes() >= 3) {
                strikeout(r, def, batter, false);
                return true;
            }
            return false;
        }
        addOuts(def, 1);                          // 번트 실패(팝업)
        r.add(Kind.OUT, Commentary.buntPop());
        return true;
    }

    private void addOuts(TeamState def, int n) {
        gs.setOuts(gs.getOuts() + n);
        def.currentLine().addOuts(n);
    }

    private void scoreRuns(StepResult r, List<Player> scorers) {
        if (scorers.isEmpty()) return;
        TeamState off = gs.offense(), def = gs.defense();
        int n = scorers.size();
        off.addScore(n);
        off.addInningRuns(gs.getInning(), n);
        def.currentLine().addRuns(n);
        StringBuilder names = new StringBuilder();
        for (Player p : scorers) {
            if (names.length() > 0) names.append(", ");
            names.append(p.getName());
        }
        r.add(Kind.SCORE, Commentary.scoreLine(names.toString(), gs));
        if (gs.getInning() >= 8 && rng.nextDouble() < 0.4) r.add(Kind.COLOR, Commentary.colorRisp());
    }

    // ── 타석/이닝 흐름 ────────────────────────────────────

    private void endAtBat(StepResult r, TeamState off) {
        off.advanceBatter();
        gs.setBalls(0);
        gs.setStrikes(0);
        atBatFresh = true;
        decisionAck = false;
        pendingBunt = false;
        pendingIbb = false;
        pendingSteal = -1;
        r.atBatEnded = true;
    }

    /** 3아웃 처리 + 경기 종료 판정 */
    private void finish(StepResult r) {
        if (gs.isDone()) return;
        if (gs.getOuts() >= 3) changeHalf(r);
        if (!gs.isDone() && gs.getInning() >= 9 && !gs.isTop()
            && gs.getTheirs().getScore() > gs.getMine().getScore()) {
            endGame(r);                           // 9회 이후 말 공격에서 상대가 역전 = 즉시 종료 (끝내기)
        }
    }

    private void changeHalf(StepResult r) {
        gs.setOuts(0);
        gs.setBalls(0);
        gs.setStrikes(0);
        gs.setRunners(new Player[3]);
        pendingBunt = false;
        pendingSteal = -1;
        pendingIbb = false;
        decisionAck = false;
        atBatFresh = true;

        if (gs.isTop()) {
            gs.setTop(false);
            gs.getTheirs().startInning(gs.getInning());
            r.add(Kind.INNING, Commentary.bottomStart(gs));
        } else {
            if (gs.getInning() >= 9 && gs.getMine().getScore() != gs.getTheirs().getScore()) {
                endGame(r);
                return;
            }
            gs.setInning(gs.getInning() + 1);     // 동점이면 연장
            gs.setTop(true);
            gs.getMine().startInning(gs.getInning());
            r.add(Kind.INNING, Commentary.topStart(gs));
        }
        r.inningChanged = true;
    }

    private void endGame(StepResult r) {
        gs.setDone(true);
        r.gameOver = true;
        r.add(Kind.END, Commentary.gameEnd(gs));
    }

    // ── AI 감독 ───────────────────────────────────────────

    private void aiPitcherCheck(StepResult r) {
        TeamState t = gs.getTheirs();
        Player p = t.getPitcher();
        PitcherLine line = t.currentLine();
        if (p == null || line == null) return;
        if (!(p.getHp() <= 35 || line.getPitches() >= 100)) return;

        Player next = null;
        for (Player c : t.bullpen()) {
            if (next == null || c.getEffectiveOvr() > next.getEffectiveOvr()) next = c;
        }
        if (next == null) return;
        r.add(Kind.MANAGER, Commentary.aiPitcherChange(p, next));
        introducePitcher(t, next);
    }

    private boolean aiWantsIbb(TeamState off) {
        if (gs.getRunners()[0] != null || gs.getOuts() >= 2) return false;
        Player b = off.currentBatter(), nb = off.nextBatter();
        return b != null && nb != null
            && b.getEffectiveOvr() >= 80 && nb.getEffectiveOvr() < 68
            && rng.nextDouble() < 0.35;
    }

    private boolean aiWantsBunt(Player batter) {
        return gs.getRunners()[0] != null && gs.getOuts() == 0
            && batter != null && batter.getEffectiveOvr() < 62
            && rng.nextDouble() < 0.30;
    }

    /** AI 도루 판단: -1이면 시도 안 함 */
    private int aiStealBase() {
        Player[] rn = gs.getRunners();
        if (gs.getOuts() >= 2) return -1;
        if (rn[0] != null && rn[1] == null && rn[0].getEffectiveOvr() >= 60 && rng.nextDouble() < 0.05) return 0;
        if (rn[1] != null && rn[2] == null && rn[1].getEffectiveOvr() >= 60 && rng.nextDouble() < 0.02) return 1;
        return -1;
    }

    // ── 감독 지시 (사용자) ────────────────────────────────

    /** 번트 사인: 우리 공격 중 */
    public boolean canBunt() {
        return gs != null && !gs.isDone() && gs.isTop() && !pendingBunt;
    }

    public boolean requestBunt() {
        if (!canBunt()) return false;
        pendingBunt = true;
        queue.add(new Line(Kind.MANAGER, "🥎 번트 사인! 다음 투구에 번트를 댑니다"));
        return true;
    }

    /** 도루 가능한 주자 베이스 인덱스 목록 (0=1루 주자, 1=2루 주자) */
    public List<Integer> stealableBases() {
        List<Integer> r = new ArrayList<>();
        if (gs == null || gs.isDone() || !gs.isTop() || pendingSteal >= 0) return r;
        Player[] rn = gs.getRunners();
        if (rn[0] != null && rn[1] == null) r.add(0);
        if (rn[1] != null && rn[2] == null) r.add(1);
        return r;
    }

    public boolean requestSteal(int from) {
        if (!stealableBases().contains(from)) return false;
        pendingSteal = from;
        queue.add(new Line(Kind.MANAGER, "🏃 도루 사인! " + gs.getRunners()[from].getName() + " 다음 투구에 스타트"));
        return true;
    }

    public boolean canIntentionalWalk() {
        return gs != null && !gs.isDone() && !gs.isTop() && gs.getRunners()[0] == null && !pendingIbb;
    }

    public boolean requestIntentionalWalk() {
        if (!canIntentionalWalk()) return false;
        pendingIbb = true;
        queue.add(new Line(Kind.MANAGER, "🚫 고의4구 지시! 1루를 비웁니다"));
        return true;
    }

    /** 대타: 벤치 선수로 현재 타자 교체 (라인업 슬롯 영구 교체) */
    public boolean requestPinchHit(Player sub) {
        if (gs == null || gs.isDone() || !gs.isTop()) return false;
        TeamState t = gs.getMine();
        if (!t.bench().contains(sub)) return false;
        Player old = t.currentBatter();
        t.getLineup().set(t.currentSlot(), sub);
        gs.setBalls(0);
        gs.setStrikes(0);
        atBatFresh = true;
        pendingBunt = false;
        queue.add(new Line(Kind.MANAGER, Commentary.pinchHit(old, sub)));
        return true;
    }

    /** 대주자: 주자를 벤치 선수로 교체 */
    public boolean requestPinchRun(int base, Player sub) {
        if (gs == null || gs.isDone() || !gs.isTop() || base < 0 || base > 2) return false;
        TeamState t = gs.getMine();
        Player[] rn = gs.getRunners();
        if (rn[base] == null || !t.bench().contains(sub)) return false;
        Player old = rn[base];
        int idx = t.getLineup().indexOf(old);
        if (idx < 0) return false;
        t.getLineup().set(idx, sub);
        rn[base] = sub;
        queue.add(new Line(Kind.MANAGER, Commentary.pinchRun(old, sub, base + 1)));
        return true;
    }

    /** 투수 교체 (우리 수비 중) */
    public boolean requestPitcherChange(Player next) {
        if (gs == null || gs.isDone() || gs.isTop()) return false;
        TeamState t = gs.getMine();
        if (!t.bullpen().contains(next)) return false;
        Player old = t.getPitcher();
        introducePitcher(t, next);
        queue.add(new Line(Kind.MANAGER, Commentary.pitcherChange(old, next)));
        return true;
    }

    // ── 유틸 ──────────────────────────────────────────────

    private static double clamp(double v, double lo, double hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
