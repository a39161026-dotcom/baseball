package com.baseball9.engine;

import com.baseball9.model.*;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class GameEngineTest {

    private static Player p(String name, Position pos, int ovr) {
        return new Player(name, pos, "국내", 27, ovr, ovr, 1.0, 1, "T", 2024);
    }

    /** 야수 9 + 벤치 1, 선발 1, 불펜 2 씩 있는 두 팀으로 경기 생성 */
    private static GameState newGame(int ovr) {
        Position[] pos = {Position.C, Position.B1, Position.B2, Position.B3, Position.SS,
                          Position.OF, Position.OF, Position.OF, Position.DH, Position.DH};
        GameState gs = new GameState("우리", "상대");
        List<Player> mine = new ArrayList<>(), theirs = new ArrayList<>();
        for (int i = 0; i < pos.length; i++) {
            mine.add(p("우리" + i, pos[i], ovr));
            theirs.add(p("상대" + i, pos[i], ovr));
        }
        mine.add(p("우리SP", Position.SP, ovr));
        mine.add(p("우리RP1", Position.RP, ovr));
        mine.add(p("우리RP2", Position.RP, ovr));
        theirs.add(p("상대SP", Position.SP, ovr));
        theirs.add(p("상대RP1", Position.RP, ovr));
        theirs.add(p("상대RP2", Position.RP, ovr));

        gs.getMine().getLineup().addAll(mine.subList(0, 9));
        gs.getMine().getRoster().addAll(mine);
        gs.getMine().setPitcher(mine.get(10));          // 선발 SP (index 10)
        gs.getTheirs().getLineup().addAll(theirs.subList(0, 9));
        gs.getTheirs().getRoster().addAll(theirs);
        gs.getTheirs().setPitcher(theirs.get(10));
        return gs;
    }

    @Test
    void outsStayWithinRangeAndRunnersNeverDuplicateAcrossGames() {
        for (int g = 0; g < 200; g++) {
            GameState gs = newGame(75);
            GameEngine e = new GameEngine();
            e.startGame(gs);
            int guard = 0;
            while (!gs.isDone() && guard++ < 20000) {
                if (e.needsDecision()) e.ackDecision();
                e.step();
                assertTrue(gs.getOuts() >= 0 && gs.getOuts() <= 2, "아웃 카운트 범위 이탈: " + gs.getOuts());
                Player[] rn = gs.getRunners();
                if (rn[0] != null) assertNotSame(rn[0], rn[1]);
                if (rn[0] != null) assertNotSame(rn[0], rn[2]);
                if (rn[1] != null) assertNotSame(rn[1], rn[2]);
            }
            assertTrue(gs.isDone(), "경기가 끝나지 않음");
            assertNotEquals(gs.getMine().getScore(), gs.getTheirs().getScore(), "동점으로 끝남");
        }
    }

    @Test
    void runGameRunsToEndAndReportsGameOver() {
        GameState gs = newGame(80);
        GameEngine e = new GameEngine();
        e.startGame(gs);
        GameEngine.StepResult r = e.run(GameEngine.Mode.GAME);
        assertTrue(r.isGameOver());
        assertTrue(gs.isDone());
        assertTrue(gs.getInning() >= 9);
    }

    @Test
    void intentionalWalkWithFirstBaseEmptyDoesNotForceRunners() {
        GameState gs = newGame(70);
        gs.setTop(false);                        // 상대 공격 (우리 수비)
        Player second = gs.getTheirs().getLineup().get(1);   // 타자(0번)와 주자를 분리
        Player third = gs.getTheirs().getLineup().get(2);
        gs.setRunners(new Player[]{null, second, third});

        GameEngine e = new GameEngine();
        e.startGame(gs);
        assertTrue(e.canIntentionalWalk());
        assertTrue(e.requestIntentionalWalk());
        int beforeScore = gs.getTheirs().getScore();

        GameEngine.StepResult r = e.step();
        assertTrue(r.isAtBatEnded());
        assertEquals(beforeScore, gs.getTheirs().getScore(), "1루가 비어 있으면 득점이 없어야 함");
        assertNotNull(gs.getRunners()[0], "고의4구 타자가 1루에 있어야 함");
        assertSame(second, gs.getRunners()[1]);
        assertSame(third, gs.getRunners()[2]);
    }

    @Test
    void stealLinesMatchRunnerPosition() {
        for (int g = 0; g < 50; g++) {
            GameState gs = newGame(72);
            GameEngine e = new GameEngine();
            e.startGame(gs);
            // 첫 타석이 끝날 때까지 진행 후 1루 주자가 생기면 도루 지시
            Player runner = null;
            int guard = 0;
            while (runner == null && guard++ < 500) {
                e.run(GameEngine.Mode.PITCH);
                if (gs.isTop() && gs.getRunners()[0] != null && gs.getRunners()[1] == null) runner = gs.getRunners()[0];
                if (gs.isDone()) break;
            }
            if (runner == null) continue;
            assertTrue(e.requestSteal(0));
            GameEngine.StepResult r = e.step();
            boolean safe = r.getLines().stream().anyMatch(l -> l.getText().contains("도루 성공"));
            boolean caught = r.getLines().stream().anyMatch(l -> l.getText().contains("도루 실패"));
            assertTrue(safe ^ caught, "도루 결과 로그가 정확히 하나여야 함");
            // 같은 step 안에서 이후 투구로 주자가 또 움직일 수 있으므로, 도루 로그에 주자 이름이 있는지만 확인
            String line = r.getLines().stream().filter(l -> l.getText().startsWith("도루")).findFirst().get().getText();
            assertTrue(line.contains(runner.getName()), "도루 로그에 주자 이름이 없음: " + line);
        }
    }

    @Test
    void pinchHitReplacesCurrentBatterInLineup() {
        GameState gs = newGame(75);
        Player bench = p("대타", Position.OF, 80);
        gs.getMine().getRoster().add(bench);
        GameEngine e = new GameEngine();
        e.startGame(gs);
        Player before = gs.getMine().currentBatter();
        assertTrue(e.requestPinchHit(bench));
        assertSame(bench, gs.getMine().currentBatter());
        assertFalse(gs.getMine().getLineup().contains(before));
    }

    @Test
    void pitcherChangeUsesBullpenAndStartsNewLine() {
        GameState gs = newGame(75);
        gs.setTop(false);                        // 우리 수비
        Player rp = gs.getMine().getRoster().get(11);   // 불펜 RP1
        GameEngine e = new GameEngine();
        e.startGame(gs);
        assertTrue(gs.getMine().bullpen().contains(rp));
        assertTrue(e.requestPitcherChange(rp));
        assertSame(rp, gs.getMine().getPitcher());
        assertEquals(2, gs.getMine().getPitcherLines().size());
        assertFalse(gs.getMine().bullpen().contains(rp), "등판한 투수는 불펜에서 빠져야 함");
    }

    @Test
    void pitcherChangeRejectedForPlayerNotInBullpen() {
        GameState gs = newGame(75);
        gs.setTop(false);
        GameEngine e = new GameEngine();
        e.startGame(gs);
        Player starter = gs.getMine().getPitcher();
        assertFalse(e.requestPitcherChange(starter));
    }

    @Test
    void decisionPointWhenRunnersOnWithOurOffense() {
        GameState gs = newGame(75);
        gs.getRunners()[0] = gs.getMine().getLineup().get(0);
        GameEngine e = new GameEngine();
        e.startGame(gs);
        assertTrue(e.needsDecision());
        e.ackDecision();
        assertFalse(e.needsDecision());
    }

    @Test
    void stopAtDecisionHaltsBeforePitchWhenRunnersOn() {
        GameState gs = newGame(75);
        gs.getRunners()[1] = gs.getMine().getLineup().get(0);
        GameEngine e = new GameEngine();
        e.startGame(gs);
        int pitchesBefore = gs.getPitchTotal();
        e.run(GameEngine.Mode.PITCH, true);
        assertEquals(pitchesBefore, gs.getPitchTotal(), "판단 지점에서는 투구가 진행되지 않아야 함");
    }

    @Test
    void drainQueueReturnsGameStartLine() {
        GameState gs = newGame(75);
        GameEngine e = new GameEngine();
        e.startGame(gs);
        List<GameEngine.Line> lines = e.drainQueue();
        assertFalse(lines.isEmpty());
        assertTrue(lines.get(0).getText().contains("플레이 볼"));
        assertTrue(e.drainQueue().isEmpty());
    }
}
