package com.baseball9.engine;

import com.baseball9.model.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/** 한국어 야구 중계 멘트 생성기. 같은 상황도 여러 표현 중 무작위로 골라 단조롭지 않게 합니다. */
final class Commentary {

    private Commentary() {}

    private static String pick(Random rng, String... xs) {
        return xs[rng.nextInt(xs.length)];
    }

    static String name(Player p) {
        return p == null ? "???" : p.getName();
    }

    /** 주자 상황: "주자 없음", "1·3루", "만루" */
    static String runnersText(Player[] rn) {
        List<String> s = new ArrayList<>();
        for (int i = 0; i < 3; i++) if (rn[i] != null) s.add(String.valueOf(i + 1));
        if (s.isEmpty()) return "주자 없음";
        if (s.size() == 3) return "만루";
        return String.join("·", s) + "루";
    }

    /** 상황 요약: "3회초 · 1아웃 · 1·2루" */
    static String situation(GameState gs) {
        return gs.getInning() + "회" + (gs.isTop() ? "초" : "말")
            + " · " + gs.getOuts() + "아웃 · " + runnersText(gs.getRunners());
    }

    static String gameStart(GameState gs) {
        return "⚾ 플레이 볼! " + gs.getMine().getName() + " vs " + gs.getOpponent()
            + " 경기를 시작합니다. 선발 " + name(gs.getMine().getPitcher())
            + " / " + name(gs.getTheirs().getPitcher());
    }

    static String atBatIntro(GameState gs, Player batter, Player pitcher, boolean mineBat) {
        String head = "[" + situation(gs) + "] ";
        if (mineBat) {
            return head + "🎙 타석에 " + name(batter) + " (" + batter.getPos() + ", OVR "
                + batter.getEffectiveOvr() + ")! 마운드에는 " + name(pitcher) + " 투수입니다.";
        }
        return head + "🎙 " + name(pitcher) + " 투수, 상대 타자 " + name(batter)
            + " (" + batter.getPos() + ") 상대로 승부합니다.";
    }

    static String topStart(GameState gs) {
        return "▲ " + gs.getInning() + "회 초 " + gs.getMine().getName() + " 공격 · "
            + score(gs);
    }

    static String bottomStart(GameState gs) {
        return "▼ " + gs.getInning() + "회 말 " + gs.getOpponent() + " 공격 · " + score(gs);
    }

    static String score(GameState gs) {
        return gs.getMine().getName() + " " + gs.getMine().getScore() + " : "
            + gs.getTheirs().getScore() + " " + gs.getOpponent();
    }

    static String gameEnd(GameState gs) {
        boolean mineWin = gs.getMine().getScore() > gs.getTheirs().getScore();
        String winner = mineWin ? gs.getMine().getName() : gs.getOpponent();
        return "🏁 경기 종료! " + winner + " 승리 — 최종 " + gs.getMine().getScore()
            + " : " + gs.getTheirs().getScore();
    }

    // ── 투구
    static String ball(Random rng) {
        return pick(rng, "볼", "볼! 바깥쪽으로 빠집니다", "볼 판정, 공이 높았습니다", "공이 빠집니다, 볼");
    }

    static String whiff(Random rng) {
        return pick(rng, "헛스윙! 스트라이크", "스윙! 방망이가 공을 못 따라갑니다", "헛스윙, 빠른 승부!");
    }

    static String called(Random rng) {
        return pick(rng, "스트라이크 콜! 존 한가운데 걸쳤습니다", "꽉 찬 스트라이크 판정");
    }

    static String foul(Random rng) {
        return pick(rng, "파울, 커트해 냅니다", "파울! 방망이 끝에 걸렸습니다", "파울 — 끈질긴 승부입니다");
    }

    static String buntFoul() {
        return "번트 실패, 스트라이크 판정";
    }

    // ── 타구 결과
    static String groundOut(Random rng, Player batter) {
        return pick(rng,
            "땅볼, 내야수가 잡아 1루에 송구... 아웃!",
            "내야 땅볼, 깔끔하게 처리합니다. 아웃!");
    }

    static String flyOut(Random rng) {
        return pick(rng,
            "뜬공, 외야수가 뒤로 물러나 잡습니다. 아웃!",
            "높이 뜬 공, 외야 정면에서 잡힙니다. 아웃!");
    }

    static String lineOut() {
        return "라인드라이브! 야수 정면으로 빨려 들어갑니다. 아웃!";
    }

    static String sacFly(Player runner) {
        return "희생플라이! " + name(runner) + " 홈으로 쇄도, 득점!";
    }

    static String doublePlay(Player batter, Player runner) {
        return "병살타! " + name(batter) + "의 땅볼, 2루를 거쳐 1루까지... " + name(runner) + "과 타자 모두 아웃!";
    }

    static String fieldersChoice(Player batter) {
        return "야수 선택! 2루에서 포스아웃, " + name(batter) + " 1루 세이프";
    }

    static String sacBunt(Player batter) {
        return "희생번트 성공! " + name(batter) + " 자신을 희생하고 주자를 진루시킵니다";
    }

    static String buntPop() {
        return "번트 실패! 뜬공이 됩니다. 포수가 잡아 아웃!";
    }

    static String hit(GameEngine.HitType type, Random rng, Player batter, int scored) {
        String base;
        switch (type) {
            case SINGLE -> base = pick(rng,
                "내야를 뚫는 안타! " + name(batter) + " 1루 세이프",
                "중전 안타! 주자들이 움직입니다",
                "좌전 안타, 1루 베이스를 밟습니다");
            case DOUBLE -> base = pick(rng,
                "우익선상을 가르는 2루타!",
                "외야 갭을 꿰뚫는 2루타!");
            case TRIPLE -> base = "3루타! 외야가 뚫렸습니다, 세 베이스를 달립니다!";
            default -> base = pick(rng,
                "홈런!!! 담장을 넘어갑니다!",
                "쭉쭉 뻗어 나간 타구, 홈런입니다!",
                "홈런!! 관중석이 환호합니다!");
        }
        return base;
    }

    static String walk(Player batter) {
        return name(batter) + " 볼넷, 1루로 걸어 나갑니다";
    }

    static String intentionalWalk(Player batter) {
        return "고의사구! " + name(batter) + " 1루로 걸어 나갑니다";
    }

    static String strikeout(Random rng, Player batter, boolean called) {
        if (called) return pick(rng, "삼진! 존을 지나간 공에 꼼짝 못 합니다", "스트라이크 아웃, 콜 삼진!");
        return pick(rng, "삼진! 헛스윙으로 돌아섭니다", "스트라이크 아웃! 방망이 한 번 못 내밉니다");
    }

    // ── 주루
    static String stealSafe(Player runner, int toBase) {
        return "도루 성공! " + name(runner) + " " + toBase + "루 세이프";
    }

    static String stealOut(Player runner) {
        return "도루 실패! 포수 송구, " + name(runner) + " 아웃!";
    }

    static String scoreLine(String names, GameState gs) {
        return "🔔 득점! " + names + " 홈을 밟습니다 · " + score(gs);
    }

    // ── 감독 / AI 감독
    static String aiPitcherChange(Player old, Player next) {
        return "📢 상대 감독, 투수 교체: " + name(old) + " → " + name(next) + " 등판";
    }

    static String aiIbb() {
        return "📢 상대 배터리, 고의사구를 택합니다";
    }

    static String aiBunt() {
        return "📢 상대 감독, 번트 작전 사인!";
    }

    static String pinchHit(Player old, Player sub) {
        return "🔁 대타 교체: " + name(old) + " → " + name(sub) + " 타석에 들어섭니다";
    }

    static String pinchRun(Player old, Player sub, int base) {
        return "🏃 대주자 투입: " + name(old) + " → " + name(sub) + " (" + base + "루)";
    }

    static String pitcherChange(Player old, Player next) {
        return "🔄 투수 교체: " + name(old) + " → " + name(next) + " (" + next.getPos() + ")";
    }

    // ── 해설 (가끔 끼어드는 코멘트)
    static String colorPitcherTired(Player p) {
        return "💬 해설: " + name(p) + " 선수 구위가 떨어졌네요. 체력이 한계에 가까워 보입니다.";
    }

    static String colorRisp() {
        return "💬 해설: 득점권 찬스! 한 점이 승부를 가를 수 있는 상황입니다.";
    }

    static String colorHomer() {
        return "💬 해설: 시원한 한 방입니다, 흐름이 확 바뀌네요.";
    }
}
