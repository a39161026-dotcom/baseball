package com.baseball9.model;

/** 경기 전체 상태: 이닝/카운트/주자/양 팀 */
public class GameState {
    private final String opponent;
    private int inning = 1;
    private boolean top = true;          // true = 우리 공격(초), false = 상대 공격(말)
    private int outs, balls, strikes;
    private Player[] runners = new Player[3];   // [0]=1루 [1]=2루 [2]=3루
    private final TeamState mine;
    private final TeamState theirs;
    private boolean done;
    private int pitchTotal;

    public GameState(String myTeamName, String opponent) {
        this.opponent = opponent;
        this.mine = new TeamState(myTeamName, true);
        this.theirs = new TeamState(opponent, false);
    }

    public TeamState offense() { return top ? mine : theirs; }
    public TeamState defense() { return top ? theirs : mine; }

    public boolean hasRunners() {
        return runners[0] != null || runners[1] != null || runners[2] != null;
    }

    public String getOpponent()          { return opponent; }
    public TeamState getMine()           { return mine; }
    public TeamState getTheirs()         { return theirs; }
    public int getInning()               { return inning; }
    public void setInning(int inning)    { this.inning = inning; }
    public boolean isTop()               { return top; }
    public void setTop(boolean top)      { this.top = top; }
    public int getOuts()                 { return outs; }
    public void setOuts(int outs)        { this.outs = outs; }
    public int getBalls()                { return balls; }
    public void setBalls(int balls)      { this.balls = balls; }
    public int getStrikes()              { return strikes; }
    public void setStrikes(int strikes)  { this.strikes = strikes; }
    public Player[] getRunners()         { return runners; }
    public void setRunners(Player[] r)   { this.runners = r; }
    public boolean isDone()              { return done; }
    public void setDone(boolean done)    { this.done = done; }
    public int getPitchTotal()           { return pitchTotal; }
    public void setPitchTotal(int n)     { this.pitchTotal = n; }
}
