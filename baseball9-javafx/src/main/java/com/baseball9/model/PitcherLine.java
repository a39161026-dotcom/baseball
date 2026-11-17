package com.baseball9.model;

/** 한 경기에서 투수 한 명의 기록 (박스스코어용) + 이닝 중 체력 소모 */
public class PitcherLine {
    private final Player pitcher;
    private final int entryHp;      // 등판 시점 체력
    private double staminaUsed;     // 누적 체력 소모 (소수점 누적)
    private int pitches, outs, hits, runs, walks, strikeouts;

    public PitcherLine(Player pitcher) {
        this.pitcher = pitcher;
        this.entryHp = pitcher.getHp();
    }

    /** 투구 1구 기록. drain 만큼 체력 소모 */
    public void addPitch(double drain) {
        pitches++;
        staminaUsed += drain;
        pitcher.setHp(entryHp - (int) Math.round(staminaUsed));
    }

    public Player getPitcher()  { return pitcher; }
    public int getPitches()     { return pitches; }
    public int getOuts()        { return outs; }
    public int getHits()        { return hits; }
    public int getRuns()        { return runs; }
    public int getWalks()       { return walks; }
    public int getStrikeouts()  { return strikeouts; }

    public void addOuts(int n)       { outs += n; }
    public void addHits(int n)       { hits += n; }
    public void addRuns(int n)       { runs += n; }
    public void addWalks(int n)      { walks += n; }
    public void addStrikeouts(int n) { strikeouts += n; }

    /** 이닝 표기: 6아웃 = "2.0", 5아웃 = "1.2" */
    public String getInningsText() {
        return (outs / 3) + "." + (outs % 3);
    }
}
