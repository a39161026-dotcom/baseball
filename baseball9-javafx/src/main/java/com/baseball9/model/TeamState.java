package com.baseball9.model;

import java.util.ArrayList;
import java.util.List;

/** 한 팀의 경기 중 상태 (타순, 현재 투수, 이닝별 득점, 기록) */
public class TeamState {
    private final String name;
    private final boolean user;          // true = 플레이어(우리 팀)
    private final List<Player> lineup = new ArrayList<>();
    private final List<Player> roster = new ArrayList<>();  // 벤치·불펜 계산용 전체 명단
    private int batterIdx;               // 누적 타순 인덱스 (슬롯 = idx % 9)
    private Player pitcher;
    private final List<PitcherLine> pitcherLines = new ArrayList<>();
    private final List<Integer> runsByInning = new ArrayList<>();  // null = 아직 공격 안 함
    private int score, hits;

    public TeamState(String name, boolean user) {
        this.name = name;
        this.user = user;
    }

    public String getName()          { return name; }
    public boolean isUser()          { return user; }
    public List<Player> getLineup()  { return lineup; }
    public List<Player> getRoster()  { return roster; }
    public Player getPitcher()       { return pitcher; }
    public void setPitcher(Player p) { this.pitcher = p; }
    public List<PitcherLine> getPitcherLines() { return pitcherLines; }
    public int getScore()            { return score; }
    public int getHits()             { return hits; }
    public void addScore(int n)      { score += n; }
    public void addHits(int n)       { hits += n; }

    public int currentSlot() {
        return lineup.isEmpty() ? 0 : batterIdx % lineup.size();
    }

    public Player currentBatter() {
        return lineup.isEmpty() ? null : lineup.get(currentSlot());
    }

    public Player nextBatter() {
        return lineup.isEmpty() ? null : lineup.get((currentSlot() + 1) % lineup.size());
    }

    public void advanceBatter() { batterIdx++; }

    public PitcherLine currentLine() {
        return pitcherLines.isEmpty() ? null : pitcherLines.get(pitcherLines.size() - 1);
    }

    /** 벤치: 야수 중 라인업에 없는 선수 */
    public List<Player> bench() {
        List<Player> r = new ArrayList<>();
        for (Player p : roster) {
            if (!p.isPitcher() && !lineup.contains(p)) r.add(p);
        }
        return r;
    }

    /** 불펜: 아직 등판하지 않은 투수 (현재 투수 제외) */
    public List<Player> bullpen() {
        List<Player> r = new ArrayList<>();
        for (Player p : roster) {
            if (!p.isPitcher() || p == pitcher) continue;
            boolean used = pitcherLines.stream().anyMatch(l -> l.getPitcher() == p);
            if (!used) r.add(p);
        }
        return r;
    }

    /** 이닝 시작 시 호출 — 0점으로 표시 시작 */
    public void startInning(int inning) {
        while (runsByInning.size() < inning) runsByInning.add(null);
        if (runsByInning.get(inning - 1) == null) runsByInning.set(inning - 1, 0);
    }

    public void addInningRuns(int inning, int n) {
        startInning(inning);
        runsByInning.set(inning - 1, runsByInning.get(inning - 1) + n);
    }

    /** 이닝별 득점 (0-based index, null = 공격 안 함) */
    public Integer getInningRuns(int index) {
        return index < runsByInning.size() ? runsByInning.get(index) : null;
    }

    public int getInningCount() { return runsByInning.size(); }
}
