package com.baseball9.model;

public class Player {
    private String id;
    private String name;
    private Position pos;
    private String league;
    private int age;
    private int ovr;
    private int potential;
    private double salary;
    private int contract;
    private String team;
    private int era; // 시대
    private int fatigue; // 피로도 0~100
    private int hp;     // 현재 경기 체력
    private boolean injury;

    // 스탯
    private double eraRate;
    private double avg;
    private int hr;
    private int rbi;
    private int wins;
    private int losses;

    public Player(String name, Position pos, String league, int age, int ovr,
                  int potential, double salary, int contract, String team, int era) {
        this.id = java.util.UUID.randomUUID().toString().substring(0, 8);
        this.name = name;
        this.pos = pos;
        this.league = league;
        this.age = age;
        this.ovr = ovr;
        this.potential = potential;
        this.salary = salary;
        this.contract = contract;
        this.team = team;
        this.era = era;
        this.fatigue = 0;
        this.hp = 100;
        this.injury = false;
        initStats();
    }

    private void initStats() {
        boolean isPitch = pos == Position.SP || pos == Position.RP;
        if (isPitch) {
            this.eraRate = Math.round((3.0 + (99 - ovr) * 0.04) * 100.0) / 100.0;
        } else {
            this.avg = Math.round((ovr / 330.0) * 1000.0) / 1000.0;
        }
    }

    public Condition getCondition() {
        if (fatigue <= 15) return Condition.BEST;
        if (fatigue <= 35) return Condition.GOOD;
        if (fatigue <= 60) return Condition.NORMAL;
        if (fatigue <= 80) return Condition.BAD;
        return Condition.WORST;
    }

    public int getEffectiveOvr() {
        return Math.min(99, Math.max(40, ovr + getCondition().getOvrBonus()));
    }

    public boolean isPitcher() {
        return pos == Position.SP || pos == Position.RP;
    }

    // Getters & Setters
    public String getId() { return id; }
    public String getName() { return name; }
    public Position getPos() { return pos; }
    public void setPos(Position pos) { this.pos = pos; }
    public String getLeague() { return league; }
    public int getAge() { return age; }
    public int getOvr() { return ovr; }
    public int getPotential() { return potential; }
    public double getSalary() { return salary; }
    public int getContract() { return contract; }
    public void setContract(int contract) { this.contract = contract; }
    public String getTeam() { return team; }
    public int getEra() { return era; }
    public int getFatigue() { return fatigue; }
    public void setFatigue(int fatigue) { this.fatigue = Math.max(0, Math.min(100, fatigue)); }
    public int getHp() { return hp; }
    public void setHp(int hp) { this.hp = Math.max(0, Math.min(100, hp)); }
    public boolean isInjury() { return injury; }
    public double getEraRate() { return eraRate; }
    public double getAvg() { return avg; }
    public int getHr() { return hr; }
    public int getRbi() { return rbi; }
    public int getWins() { return wins; }
    public int getLosses() { return losses; }

    @Override
    public String toString() {
        return String.format("%s (%s) OVR:%d", name, pos, ovr);
    }
}
