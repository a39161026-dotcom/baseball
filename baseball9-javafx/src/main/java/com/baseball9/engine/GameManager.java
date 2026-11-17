package com.baseball9.engine;

import com.baseball9.data.PlayerDB;
import com.baseball9.model.*;
import java.util.*;
import java.util.stream.Collectors;

public class GameManager {

    private static GameManager instance;
    public static GameManager getInstance() {
        if (instance == null) instance = new GameManager();
        return instance;
    }

    // ── 팀 데이터
    private String myTeamName = "나의 팀";
    private List<Player> roster = new ArrayList<>();
    private List<Player> faPool = new ArrayList<>();
    private List<Player> draftPool = new ArrayList<>();
    private double budget = 150.0;
    private int wins = 0, losses = 0, season = 1, draftPicks = 3;
    private List<String[]> recentGames = new ArrayList<>(); // [상대, 결과, 스코어]

    // ── 리그 순위
    private List<TeamRecord> kboStandings = new ArrayList<>();
    private List<TeamRecord> npbStandings = new ArrayList<>();
    private List<TeamRecord> mlbStandings = new ArrayList<>();

    // ── 선수 DB
    private final List<Player> allPlayers;

    private GameManager() {
        allPlayers = PlayerDB.getAllPlayers();
    }

    // ── 게임 초기화
    public void initGame(List<Player> selectedRoster, String teamName, double budget) {
        this.myTeamName = teamName;
        this.roster = new ArrayList<>(selectedRoster);
        this.budget = budget;
        this.wins = 0;
        this.losses = 0;
        this.season = 1;
        this.draftPicks = 3;
        this.recentGames.clear();
        generateFA();
        generateDraftPool();
        generateStandings();
    }

    // ── FA 풀 생성 (내 팀에 없는 선수들)
    public void generateFA() {
        Set<String> myIds = roster.stream().map(Player::getId).collect(Collectors.toSet());
        faPool = allPlayers.stream()
            .filter(p -> !myIds.contains(p.getId()))
            .sorted((a, b) -> Integer.compare(b.getOvr(), a.getOvr()))
            .limit(25)
            .collect(Collectors.toList());
        // 랜덤 계약년수
        faPool.forEach(p -> p.setContract(1 + new Random().nextInt(4)));
    }

    // ── 드래프트 풀
    public void generateDraftPool() {
        Random rand = new Random();
        List<Position> positions = Arrays.asList(Position.values());
        draftPool = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            Player p = new Player(
                "유망주 " + (i + 1),
                positions.get(rand.nextInt(positions.size())),
                "국내", 18 + rand.nextInt(5),
                55 + rand.nextInt(20), 75 + rand.nextInt(20),
                rand.nextDouble() * 5 + 1, 3, "신인", 2024
            );
            draftPool.add(p);
        }
    }

    // ── 리그 순위 생성
    public void generateStandings() {
        Random rand = new Random();
        kboStandings = new ArrayList<>();
        npbStandings = new ArrayList<>();
        mlbStandings = new ArrayList<>();

        // 내 팀 추가
        kboStandings.add(new TeamRecord(myTeamName, wins, losses, true));

        for (String name : PlayerDB.getKboTeams()) {
            if (!name.equals(myTeamName))
                kboStandings.add(new TeamRecord(name, 20 + rand.nextInt(60), 20 + rand.nextInt(60), false));
        }
        for (String name : PlayerDB.getNpbTeams())
            npbStandings.add(new TeamRecord(name, 20 + rand.nextInt(60), 20 + rand.nextInt(60), false));
        for (String name : PlayerDB.getMlbTeams())
            mlbStandings.add(new TeamRecord(name, 40 + rand.nextInt(80), 40 + rand.nextInt(80), false));

        sortStandings();
    }

    private void sortStandings() {
        Comparator<TeamRecord> cmp = Comparator.comparingDouble(TeamRecord::getWinRate).reversed();
        kboStandings.sort(cmp);
        npbStandings.sort(cmp);
        mlbStandings.sort(cmp);
    }

    // ── 경기 후 업데이트
    public void recordResult(boolean win, String opponent, String score) {
        if (win) wins++; else losses++;
        recentGames.add(new String[]{opponent, win ? "승" : "패", score});
        // 리그 순위 업데이트
        kboStandings.stream().filter(t -> t.getName().equals(myTeamName)).findFirst()
            .ifPresent(t -> { if (win) t.addWin(); else t.addLoss(); });
        sortStandings();
    }

    // ── 자동 로스터 생성 (OVR 범위)
    //    투수 5명 + 야수 10명을 항상 채움 (범위 안 선수가 부족하면 범위 밖에서 보충)
    public List<Player> buildAutoRoster(int minOvr, int maxOvr) {
        List<Position> needed = Arrays.asList(
            Position.SP, Position.SP, Position.RP, Position.RP, Position.RP,
            Position.C, Position.B1, Position.B2, Position.B3, Position.SS,
            Position.OF, Position.OF, Position.OF, Position.DH, Position.DH
        );
        Random rand = new Random();
        List<Player> inRange = allPlayers.stream()
            .filter(p -> p.getOvr() >= minOvr && p.getOvr() <= maxOvr)
            .collect(Collectors.toList());
        List<Player> result = new ArrayList<>();
        Set<String> used = new HashSet<>();

        for (Position pos : needed) {
            List<Player> cands = pickCandidates(inRange, pos, used);
            if (cands.isEmpty()) cands = pickCandidates(allPlayers, pos, used);
            if (cands.isEmpty()) continue;
            Player pick = cands.get(rand.nextInt(Math.min(cands.size(), 3)));
            used.add(pick.getId());
            result.add(pick);
        }
        // 부족분 보충: 야수 10명, 투수 5명
        fillRoster(result, used, allPlayers, false, 10);
        fillRoster(result, used, allPlayers, true, 5);
        return result;
    }

    private List<Player> pickCandidates(List<Player> pool, Position pos, Set<String> used) {
        return pool.stream()
            .filter(p -> p.getPos() == pos && !used.contains(p.getId()))
            .sorted((a, b) -> Integer.compare(b.getOvr(), a.getOvr()))
            .collect(Collectors.toList());
    }

    /** 투수(pitchers=true) 또는 야수 수가 count 가 될 때까지 OVR 높은 선수로 채움 */
    private void fillRoster(List<Player> result, Set<String> used, List<Player> pool, boolean pitchers, int count) {
        long have = result.stream().filter(p -> p.isPitcher() == pitchers).count();
        if (have >= count) return;
        List<Player> extra = pool.stream()
            .filter(p -> p.isPitcher() == pitchers && !used.contains(p.getId()))
            .sorted((a, b) -> Integer.compare(b.getOvr(), a.getOvr()))
            .collect(Collectors.toList());
        for (Player p : extra) {
            if (have >= count) break;
            used.add(p.getId());
            result.add(p);
            have++;
        }
    }

    // ── 상대팀 자동 생성 (야수 9명 + 투수 3명을 항상 채움)
    public List<Player> buildOppRoster(String teamName) {
        Set<String> myIds = roster.stream().map(Player::getId).collect(Collectors.toSet());
        List<Player> pool = allPlayers.stream()
            .filter(p -> !myIds.contains(p.getId()))
            .collect(Collectors.toList());

        List<Position> needed = Arrays.asList(
            Position.SP, Position.RP, Position.RP,
            Position.C, Position.B1, Position.B2, Position.B3,
            Position.SS, Position.OF, Position.OF, Position.OF, Position.DH
        );

        Random rand = new Random();
        List<Player> result = new ArrayList<>();
        Set<String> used = new HashSet<>();
        for (Position pos : needed) {
            List<Player> cands = pickCandidates(pool, pos, used);
            if (cands.isEmpty()) continue;
            Player pick = cands.get(rand.nextInt(Math.min(3, cands.size())));
            used.add(pick.getId());
            result.add(pick);
        }
        fillRoster(result, used, pool, false, 9);
        fillRoster(result, used, pool, true, 3);
        return result;
    }

    // ── 경기 후 피로도 반영 (출전 야수 + 등판 투수)
    public void applyPostGameFatigue(TeamState team) {
        Random rand = new Random();
        for (Player p : team.getLineup()) {
            p.setFatigue(p.getFatigue() + 4 + rand.nextInt(6));
        }
        for (PitcherLine l : team.getPitcherLines()) {
            Player p = l.getPitcher();
            double rate = p.getPos() == Position.SP ? 0.25 : 0.40;   // 선발은 투구 수 대비 완만, 불펜은 가파르게
            p.setFatigue(p.getFatigue() + (int) Math.round(l.getPitches() * rate));
        }
    }

    // ── 매 경기 전 컨디션 변동
    public void updateDailyCondition() {
        Random rand = new Random();
        roster.forEach(p -> {
            p.setFatigue(p.getFatigue() - rand.nextInt(8) - 3); // 자연 회복
            double roll = rand.nextDouble();
            if (roll < 0.04) p.setFatigue(p.getFatigue() + rand.nextInt(16) + 15);
            else if (roll < 0.08) p.setFatigue(p.getFatigue() - rand.nextInt(11) - 10);
        });
    }

    // ── Getters & Setters
    public String getMyTeamName() { return myTeamName; }
    public List<Player> getRoster() { return roster; }
    public List<Player> getFaPool() { return faPool; }
    public List<Player> getDraftPool() { return draftPool; }
    public double getBudget() { return budget; }
    public void setBudget(double budget) { this.budget = budget; }
    public int getWins() { return wins; }
    public int getLosses() { return losses; }
    public int getSeason() { return season; }
    public int getDraftPicks() { return draftPicks; }
    public void setDraftPicks(int n) { this.draftPicks = n; }
    public List<String[]> getRecentGames() { return recentGames; }
    public List<Player> getAllPlayers() { return allPlayers; }
    public List<TeamRecord> getKboStandings() { return kboStandings; }
    public List<TeamRecord> getNpbStandings() { return npbStandings; }
    public List<TeamRecord> getMlbStandings() { return mlbStandings; }

    public int getTeamOvr() {
        if (roster.isEmpty()) return 70;
        return (int) roster.stream().mapToInt(Player::getEffectiveOvr).average().orElse(70);
    }

    public int getRank() {
        for (int i = 0; i < kboStandings.size(); i++)
            if (kboStandings.get(i).getName().equals(myTeamName)) return i + 1;
        return -1;
    }

    // ── FA 계약
    public boolean signFA(Player p, int years) {
        if (budget < p.getSalary()) return false;
        budget -= p.getSalary();
        p.setContract(years);
        roster.add(p);
        faPool.remove(p);
        return true;
    }

    // ── 방출
    public void releasePlayer(Player p) {
        budget += p.getSalary() * 0.5;
        roster.remove(p);
    }

    // ── 드래프트
    public boolean draftPlayer(Player p) {
        if (draftPicks <= 0) return false;
        draftPicks--;
        roster.add(p);
        draftPool.remove(p);
        return true;
    }

    // ── 상대팀 목록 (전체 리그 팀 이름)
    public List<String> getOpponentNames() {
        List<String> names = new ArrayList<>();
        kboStandings.stream().map(TeamRecord::getName).filter(n -> !n.equals(myTeamName)).forEach(names::add);
        npbStandings.stream().map(TeamRecord::getName).forEach(names::add);
        mlbStandings.stream().map(TeamRecord::getName).forEach(names::add);
        return names;
    }

    // 팀 기록 클래스
    public static class TeamRecord {
        private final String name;
        private int wins, losses;
        private final boolean isMyTeam;

        public TeamRecord(String name, int wins, int losses, boolean isMyTeam) {
            this.name = name; this.wins = wins; this.losses = losses; this.isMyTeam = isMyTeam;
        }
        public String getName() { return name; }
        public int getWins() { return wins; }
        public int getLosses() { return losses; }
        public void addWin() { wins++; }
        public void addLoss() { losses++; }
        public boolean isMyTeam() { return isMyTeam; }
        public double getWinRate() {
            int total = wins + losses;
            return total == 0 ? 0 : (double) wins / total;
        }
        public String getWinRateStr() {
            return String.format("%.3f", getWinRate());
        }
    }
}
