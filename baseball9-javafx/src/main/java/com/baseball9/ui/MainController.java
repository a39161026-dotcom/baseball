package com.baseball9.ui;

import com.baseball9.MainApp;
import com.baseball9.engine.GameEngine;
import com.baseball9.engine.GameManager;
import com.baseball9.model.*;
import javafx.animation.*;
import javafx.application.Platform;
import javafx.geometry.*;
import javafx.scene.Scene;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.layout.FlowPane;
import java.util.function.Consumer;
import java.util.function.BiConsumer;
import javafx.scene.paint.Color;
import javafx.scene.text.*;
import javafx.stage.Stage;
import javafx.util.Duration;

import java.util.*;
import java.util.stream.Collectors;

public class MainController {

    private final Stage stage;
    private final GameManager gm = GameManager.getInstance();
    private final GameEngine engine = new GameEngine();

    // 화면 구성
    private BorderPane root;
    private StackPane contentArea;

    // 현재 화면
    private String currentScreen = "setup";

    // 게임 상태
    private GameState gs;
    private Timeline autoPlayTimeline;
    private List<Player> selectedRoster = new ArrayList<>();
    private Player selectedStarter;
    private List<Player> lineup = new ArrayList<>();

    // 스타일 상수
    private static final String BG_DARK   = "-fx-background-color: #0d0d0d;";
    private static final String BG_PANEL  = "-fx-background-color: #1a1a2e;";
    private static final String COLOR_GOLD   = "#f5a623";
    private static final String COLOR_GREEN  = "#4ade80";
    private static final String COLOR_RED    = "#ef4444";
    private static final String COLOR_BLUE   = "#38bdf8";
    private static final String COLOR_MUTED  = "#64748b";

    public MainController(Stage stage) {
        this.stage = stage;
    }

    public Scene buildScene() {
        root = new BorderPane();
        root.setStyle(BG_DARK);

        // 상단 타이틀바
        root.setTop(buildTitleBar());

        // 왼쪽 네비게이션 (게임 시작 후에만 표시)
        contentArea = new StackPane();
        root.setCenter(contentArea);

        // 초기 화면: 팀 구성
        showSetupScreen();

        return new Scene(root, MainApp.WIDTH, MainApp.HEIGHT);
    }

    // ── 타이틀바
    private HBox buildTitleBar() {
        HBox bar = new HBox(12);
        bar.setPadding(new Insets(10, 16, 10, 16));
        bar.setAlignment(Pos.CENTER_LEFT);
        bar.setStyle("-fx-background-color: #0a0a1a; -fx-border-color: #333; -fx-border-width: 0 0 1 0;");

        Label title = new Label("⚾ 야구9단 매니저");
        title.setStyle("-fx-font-size: 14px; -fx-font-weight: bold; -fx-text-fill: " + COLOR_GOLD + ";");

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        Label teamLabel = new Label("");
        teamLabel.setStyle("-fx-text-fill: #94a3b8; -fx-font-size: 12px;");
        teamLabel.setId("team-label");

        bar.getChildren().addAll(title, spacer, teamLabel);
        return bar;
    }

    // ── 게임 네비게이션 (게임 시작 후)
    private VBox buildNavBar() {
        VBox nav = new VBox(4);
        nav.setPadding(new Insets(12, 8, 12, 8));
        nav.setStyle(BG_PANEL + " -fx-border-color: #333; -fx-border-width: 0 1 0 0;");
        nav.setPrefWidth(130);

        String[][] menus = {
            {"🏠", "대시보드", "dashboard"},
            {"⚾", "경기",    "game"},
            {"👥", "로스터",  "roster"},
            {"💰", "FA",      "fa"},
            {"📋", "드래프트","draft"},
            {"📊", "순위표",  "standings"},
        };

        for (String[] m : menus) {
            Button btn = new Button(m[0] + " " + m[1]);
            btn.setMaxWidth(Double.MAX_VALUE);
            btn.setStyle("-fx-background-color: transparent; -fx-text-fill: #94a3b8; -fx-font-size: 12px; -fx-padding: 8 12; -fx-cursor: hand; -fx-alignment: center-left;");
            btn.setOnMouseEntered(e -> btn.setStyle("-fx-background-color: rgba(255,255,255,0.05); -fx-text-fill: #e2e8f0; -fx-font-size: 12px; -fx-padding: 8 12; -fx-cursor: hand; -fx-alignment: center-left;"));
            btn.setOnMouseExited(e -> btn.setStyle("-fx-background-color: transparent; -fx-text-fill: #94a3b8; -fx-font-size: 12px; -fx-padding: 8 12; -fx-cursor: hand; -fx-alignment: center-left;"));
            final String screen = m[2];
            btn.setOnAction(e -> navigateTo(screen));
            nav.getChildren().add(btn);
        }
        return nav;
    }

    private void navigateTo(String screen) {
        currentScreen = screen;
        switch (screen) {
            case "dashboard"  -> showDashboard();
            case "game"       -> showGameSetup();
            case "roster"     -> showRoster();
            case "fa"         -> showFA();
            case "draft"      -> showDraft();
            case "standings"  -> showStandings();
        }
    }

    // ════════════════════════════════════════════
    // 팀 구성 화면 (시작 전)
    // ════════════════════════════════════════════
    private void showSetupScreen() {
        VBox setup = new VBox(20);
        setup.setPadding(new Insets(30));
        setup.setAlignment(Pos.TOP_CENTER);
        setup.setStyle(BG_DARK);

        Label title = new Label("⚾ 야구9단 매니저");
        title.setStyle("-fx-font-size: 28px; -fx-font-weight: bold; -fx-text-fill: " + COLOR_GOLD + ";");

        Label sub = new Label("BASEBALL MANAGER SIMULATION");
        sub.setStyle("-fx-font-size: 12px; -fx-text-fill: " + COLOR_MUTED + "; -fx-letter-spacing: 0.2em;");

        // 탭: 자동 구성 / 직접 선택
        TabPane tabs = new TabPane();
        tabs.setStyle("-fx-background-color: #1a1a2e;");
        tabs.setMaxWidth(700);

        Tab autoTab = new Tab("🎲 자동 구성", buildAutoSetupPanel());
        Tab manualTab = new Tab("✏️ 직접 선택", buildManualSetupPanel());
        autoTab.setClosable(false);
        manualTab.setClosable(false);
        tabs.getTabs().addAll(autoTab, manualTab);

        // 난이도
        HBox diffBox = new HBox(10);
        diffBox.setAlignment(Pos.CENTER);
        Label diffLabel = new Label("AI 난이도:");
        diffLabel.setStyle("-fx-text-fill: #94a3b8; -fx-font-size: 12px;");
        ToggleGroup diffGroup = new ToggleGroup();
        for (GameEngine.Difficulty d : GameEngine.Difficulty.values()) {
            RadioButton rb = new RadioButton(d.getLabel());
            rb.setToggleGroup(diffGroup);
            rb.setStyle("-fx-text-fill: #e2e8f0; -fx-font-size: 12px;");
            rb.setSelected(d == GameEngine.Difficulty.NORMAL);
            rb.setOnAction(e -> engine.setDifficulty(d));
            diffBox.getChildren().add(rb);
        }
        diffBox.getChildren().add(0, diffLabel);

        // 예산 선택
        HBox budgetBox = new HBox(10);
        budgetBox.setAlignment(Pos.CENTER);
        Label budLabel = new Label("팀 예산:");
        budLabel.setStyle("-fx-text-fill: #94a3b8; -fx-font-size: 12px;");
        ToggleGroup budGroup = new ToggleGroup();
        double[] budgets = {80, 150, 250};
        String[] budLabels = {"소규모 $80M", "표준 $150M", "대형 $250M"};
        double[] selectedBudget = {150};
        for (int i = 0; i < budgets.length; i++) {
            final double b = budgets[i];
            RadioButton rb = new RadioButton(budLabels[i]);
            rb.setToggleGroup(budGroup);
            rb.setStyle("-fx-text-fill: #e2e8f0; -fx-font-size: 12px;");
            rb.setSelected(b == 150);
            rb.setOnAction(e -> selectedBudget[0] = b);
            budgetBox.getChildren().add(rb);
        }
        budgetBox.getChildren().add(0, budLabel);

        // 시작 버튼
        Button startBtn = new Button("⚾ 게임 시작!");
        startBtn.setStyle("-fx-background-color: " + COLOR_GOLD + "; -fx-text-fill: #000; -fx-font-size: 14px; -fx-font-weight: bold; -fx-padding: 12 32; -fx-cursor: hand;");
        startBtn.setOnAction(e -> {
            List<Player> roster = selectedRoster.isEmpty()
                ? gm.buildAutoRoster(74, 87)
                : new ArrayList<>(selectedRoster);
            if (roster.isEmpty()) {
                showAlert("오류", "선수를 선택해주세요!");
                return;
            }
            gm.initGame(roster, "나의 팀", selectedBudget[0]);
            updateTitleBar();
            showMainLayout();
        });

        setup.getChildren().addAll(title, sub, tabs, diffBox, budgetBox, startBtn);
        ScrollPane scroll = new ScrollPane(setup);
        scroll.setStyle("-fx-background-color: #0d0d0d; -fx-background: #0d0d0d;");
        scroll.setFitToWidth(true);
        contentArea.getChildren().setAll(scroll);
    }

    private VBox buildAutoSetupPanel() {
        VBox panel = new VBox(12);
        panel.setPadding(new Insets(16));
        panel.setStyle(BG_PANEL);

        Label desc = new Label("내장 선수 DB(국내·해외·일본·국가대표)에서 자동으로 로스터를 구성합니다.\n투수 5명 + 야수 10명 기본 구성");
        desc.setStyle("-fx-text-fill: #94a3b8; -fx-font-size: 12px;");
        desc.setWrapText(true);

        Label strengthLabel = new Label("강도 선택:");
        strengthLabel.setStyle("-fx-text-fill: #e2e8f0; -fx-font-size: 12px;");

        ToggleGroup sg = new ToggleGroup();
        HBox sBox = new HBox(10);
        String[][] strengths = {{"약체 (OVR 65~75)", "65:75"}, {"중위권 (OVR 75~85)", "75:85"}, {"강팀 (OVR 85~95)", "85:95"}};
        for (String[] s : strengths) {
            RadioButton rb = new RadioButton(s[0]);
            rb.setToggleGroup(sg);
            rb.setStyle("-fx-text-fill: #e2e8f0; -fx-font-size: 12px;");
            rb.setSelected(s[1].equals("75:85"));
            String[] range = s[1].split(":");
            rb.setOnAction(e -> {
                selectedRoster.clear();
                selectedRoster.addAll(gm.buildAutoRoster(Integer.parseInt(range[0]), Integer.parseInt(range[1])));
            });
            sBox.getChildren().add(rb);
        }
        selectedRoster.addAll(gm.buildAutoRoster(74, 87));

        panel.getChildren().addAll(desc, strengthLabel, sBox);
        return panel;
    }

    private ScrollPane buildManualSetupPanel() {
        VBox panel = new VBox(8);
        panel.setPadding(new Insets(12));
        panel.setStyle(BG_PANEL);

        Label desc = new Label("포지션 탭을 선택해 선수를 클릭하세요. (최대 25명)");
        desc.setStyle("-fx-text-fill: #94a3b8; -fx-font-size: 11px;");

        Label countLabel = new Label("선택: 0 / 25명");
        countLabel.setStyle("-fx-text-fill: " + COLOR_GOLD + "; -fx-font-size: 12px;");

        // 포지션 필터 탭
        FlowPane posBox = new FlowPane(4, 4);
        ToggleGroup posGroup = new ToggleGroup();
        String[] posLabels = {"전체", "SP", "RP", "C", "1B", "2B", "3B", "SS", "OF", "DH"};

        // 선수 리스트
        VBox listBox = new VBox(2);

        Runnable[] holder = new Runnable[1];   // 자기 자신을 참조하기 위한 홀더
        holder[0] = () -> {
            listBox.getChildren().clear();
            String selPos = posGroup.getSelectedToggle() != null
                ? ((RadioButton)posGroup.getSelectedToggle()).getText() : "전체";
            List<Player> pool = gm.getAllPlayers().stream()
                .filter(p -> selPos.equals("전체") || p.getPos().toString().equals(selPos))
                .sorted((a,b) -> b.getOvr() - a.getOvr())
                .collect(Collectors.toList());
            for (Player p : pool) {
                boolean picked = selectedRoster.stream().anyMatch(r -> r.getId().equals(p.getId()));
                HBox row = new HBox(8);
                row.setPadding(new Insets(6, 10, 6, 10));
                row.setStyle("-fx-background-color: " + (picked ? "rgba(245,166,35,0.15)" : "transparent") + "; -fx-border-color: #222; -fx-border-width: 0 0 1 0; -fx-cursor: hand;");
                row.setAlignment(Pos.CENTER_LEFT);

                Label check = new Label(picked ? "✓" : " ");
                check.setStyle("-fx-text-fill: " + COLOR_GOLD + "; -fx-min-width: 20px;");
                Label name  = new Label(p.getName());
                name.setStyle("-fx-text-fill: #e2e8f0; -fx-font-size: 12px; -fx-min-width: 120px;");
                Label pos   = new Label("[" + p.getPos() + "]");
                pos.setStyle("-fx-text-fill: " + COLOR_BLUE + "; -fx-font-size: 11px; -fx-min-width: 40px;");
                Label league = new Label(p.getLeague());
                league.setStyle("-fx-text-fill: " + COLOR_MUTED + "; -fx-font-size: 10px; -fx-min-width: 60px;");
                Label ovr   = new Label("OVR " + p.getOvr());
                ovr.setStyle("-fx-text-fill: " + ovrColor(p.getOvr()) + "; -fx-font-weight: bold; -fx-font-size: 12px;");
                Label team  = new Label(p.getTeam());
                team.setStyle("-fx-text-fill: " + COLOR_MUTED + "; -fx-font-size: 10px;");

                row.getChildren().addAll(check, name, pos, league, ovr, team);

                final Runnable r = holder[0];
                row.setOnMouseClicked(e -> {
                    if (picked) {
                        selectedRoster.removeIf(x -> x.getId().equals(p.getId()));
                    } else {
                        if (selectedRoster.size() >= 25) return;
                        selectedRoster.add(p);
                    }
                    countLabel.setText("선택: " + selectedRoster.size() + " / 25명");
                    r.run();
                });
                listBox.getChildren().add(row);
            }
        };

        Runnable refreshList = holder[0];

        for (String pl : posLabels) {
            RadioButton rb = new RadioButton(pl);
            rb.setToggleGroup(posGroup);
            rb.setStyle("-fx-text-fill: #e2e8f0; -fx-font-size: 11px;");
            rb.setSelected(pl.equals("전체"));
            rb.setOnAction(e -> refreshList.run());
            posBox.getChildren().add(rb);
        }
        refreshList.run();

        panel.getChildren().addAll(desc, countLabel, posBox, listBox);
        ScrollPane sp = new ScrollPane(panel);
        sp.setFitToWidth(true);
        sp.setStyle("-fx-background-color: #1a1a2e;");
        sp.setPrefHeight(350);
        return sp;
    }

    // ── 메인 레이아웃 (네비 + 콘텐츠)
    private void showMainLayout() {
        root.setLeft(buildNavBar());
        showDashboard();
    }

    private void updateTitleBar() {
        Label tl = (Label) root.getTop().lookup("#team-label");
        if (tl != null) tl.setText(gm.getMyTeamName() + "  " + gm.getWins() + "승 " + gm.getLosses() + "패  $" + String.format("%.0f", gm.getBudget()) + "M");
    }

    // ════════════════════════════════════════════
    // 대시보드
    // ════════════════════════════════════════════
    private void showDashboard() {
        VBox dash = new VBox(16);
        dash.setPadding(new Insets(20));
        dash.setStyle(BG_DARK);

        Label title = new Label("🏠 대시보드");
        title.setStyle("-fx-font-size: 18px; -fx-font-weight: bold; -fx-text-fill: " + COLOR_GOLD + ";");

        // 스탯 카드들
        HBox cards = new HBox(12);
        cards.getChildren().addAll(
            statCard("팀 OVR", String.valueOf(gm.getTeamOvr()), COLOR_GOLD),
            statCard("순위", "#" + gm.getRank(), COLOR_GREEN),
            statCard("성적", gm.getWins() + "승 " + gm.getLosses() + "패", COLOR_BLUE),
            statCard("예산", "$" + String.format("%.0f", gm.getBudget()) + "M", COLOR_GOLD)
        );

        // 최근 경기
        VBox recentBox = new VBox(6);
        recentBox.setPadding(new Insets(12));
        recentBox.setStyle(BG_PANEL + " -fx-border-color: #333;");
        Label recentTitle = new Label("최근 경기");
        recentTitle.setStyle("-fx-text-fill: " + COLOR_GOLD + "; -fx-font-size: 13px; -fx-font-weight: bold;");
        recentBox.getChildren().add(recentTitle);

        List<String[]> games = gm.getRecentGames();
        if (games.isEmpty()) {
            Label none = new Label("아직 경기 기록이 없습니다.");
            none.setStyle("-fx-text-fill: " + COLOR_MUTED + "; -fx-font-size: 12px;");
            recentBox.getChildren().add(none);
        } else {
            for (int i = Math.max(0, games.size()-5); i < games.size(); i++) {
                String[] g = games.get(i);
                HBox row = new HBox(12);
                Label opp   = new Label("vs " + g[0]);
                Label res   = new Label(g[1]);
                Label score = new Label(g[2]);
                opp.setStyle("-fx-text-fill: #e2e8f0; -fx-font-size: 12px;");
                res.setStyle("-fx-text-fill: " + ("승".equals(g[1]) ? COLOR_GREEN : COLOR_RED) + "; -fx-font-weight: bold; -fx-font-size: 12px;");
                score.setStyle("-fx-text-fill: " + COLOR_MUTED + "; -fx-font-size: 12px;");
                row.getChildren().addAll(opp, res, score);
                recentBox.getChildren().add(row);
            }
        }

        // 경기 시작 버튼
        Button playBtn = new Button("▶ 경기 시작");
        playBtn.setStyle("-fx-background-color: " + COLOR_RED + "; -fx-text-fill: white; -fx-font-size: 13px; -fx-font-weight: bold; -fx-padding: 10 24; -fx-cursor: hand;");
        playBtn.setOnAction(e -> navigateTo("game"));

        dash.getChildren().addAll(title, cards, recentBox, playBtn);
        ScrollPane sp = new ScrollPane(dash);
        sp.setStyle("-fx-background-color: #0d0d0d; -fx-background: #0d0d0d;");
        sp.setFitToWidth(true);
        contentArea.getChildren().setAll(sp);
    }

    private VBox statCard(String label, String value, String color) {
        VBox card = new VBox(4);
        card.setPadding(new Insets(14));
        card.setPrefWidth(130);
        card.setStyle(BG_PANEL + " -fx-border-color: #333;");
        Label l = new Label(label);
        l.setStyle("-fx-text-fill: " + COLOR_MUTED + "; -fx-font-size: 11px;");
        Label v = new Label(value);
        v.setStyle("-fx-text-fill: " + color + "; -fx-font-size: 18px; -fx-font-weight: bold;");
        card.getChildren().addAll(l, v);
        return card;
    }

    // ════════════════════════════════════════════
    // 경기 화면
    // ════════════════════════════════════════════
    private void showGameSetup() {
        gm.updateDailyCondition();
        if (lineup.isEmpty()) autoLineup();

        VBox panel = new VBox(14);
        panel.setPadding(new Insets(20));
        panel.setStyle(BG_DARK);

        Label title = new Label("⚾ 경기 설정");
        title.setStyle("-fx-font-size: 16px; -fx-font-weight: bold; -fx-text-fill: " + COLOR_GOLD + ";");

        // 선발 투수
        VBox starterBox = new VBox(8);
        starterBox.setPadding(new Insets(12));
        starterBox.setStyle(BG_PANEL + " -fx-border-color: #333;");
        Label starterTitle = new Label("⚾ 오늘의 선발 투수");
        starterTitle.setStyle("-fx-text-fill: " + COLOR_GOLD + "; -fx-font-size: 13px; -fx-font-weight: bold;");
        starterBox.getChildren().add(starterTitle);

        ToggleGroup starterGroup = new ToggleGroup();
        List<Player> pitchers = gm.getRoster().stream()
            .filter(Player::isPitcher)
            .sorted(Comparator.comparingInt(Player::getFatigue))
            .collect(Collectors.toList());

        for (Player p : pitchers) {
            RadioButton rb = new RadioButton(
                String.format("%s (%s)  OVR:%d  피로:%d%%  컨디션:%s",
                    p.getName(), p.getPos(), p.getOvr(), p.getFatigue(), p.getCondition())
            );
            rb.setToggleGroup(starterGroup);
            rb.setStyle("-fx-text-fill: #e2e8f0; -fx-font-size: 12px;");
            boolean best = selectedStarter == null || p.getFatigue() < selectedStarter.getFatigue();
            if (best && selectedStarter == null) { rb.setSelected(true); selectedStarter = p; }
            if (selectedStarter != null && p.getId().equals(selectedStarter.getId())) rb.setSelected(true);
            rb.setOnAction(e -> selectedStarter = p);
            starterBox.getChildren().add(rb);
        }

        // 타순
        VBox lineupBox = new VBox(4);
        lineupBox.setPadding(new Insets(12));
        lineupBox.setStyle(BG_PANEL + " -fx-border-color: #333;");
        HBox lineupHeader = new HBox();
        Label lineupTitle = new Label("📋 타순 편성");
        lineupTitle.setStyle("-fx-text-fill: " + COLOR_GOLD + "; -fx-font-size: 13px; -fx-font-weight: bold;");
        Button autoBtn = new Button("🎲 자동");
        autoBtn.setStyle("-fx-background-color: #334155; -fx-text-fill: #e2e8f0; -fx-font-size: 11px; -fx-cursor: hand;");
        autoBtn.setOnAction(e -> { autoLineup(); showGameSetup(); });
        Region sp2 = new Region(); HBox.setHgrow(sp2, Priority.ALWAYS);
        lineupHeader.getChildren().addAll(lineupTitle, sp2, autoBtn);
        lineupBox.getChildren().add(lineupHeader);

        for (int i = 0; i < lineup.size(); i++) {
            Player p = lineup.get(i);
            HBox row = new HBox(8);
            row.setPadding(new Insets(4, 0, 4, 0));
            row.setAlignment(Pos.CENTER_LEFT);
            Label num  = new Label((i+1) + "번");
            num.setStyle("-fx-text-fill: " + COLOR_MUTED + "; -fx-font-size: 11px; -fx-min-width: 30px;");
            Label pos  = new Label("[" + p.getPos() + "]");
            pos.setStyle("-fx-text-fill: " + COLOR_BLUE + "; -fx-font-size: 11px; -fx-min-width: 35px;");
            Label name = new Label(p.getName());
            name.setStyle("-fx-text-fill: #e2e8f0; -fx-font-size: 12px; -fx-min-width: 100px;");
            Label ovr  = new Label("OVR " + p.getEffectiveOvr());
            ovr.setStyle("-fx-text-fill: " + ovrColor(p.getOvr()) + "; -fx-font-size: 11px;");
            Label cond = new Label(p.getCondition().toString());
            cond.setStyle("-fx-text-fill: #94a3b8; -fx-font-size: 10px;");
            row.getChildren().addAll(num, pos, name, ovr, cond);
            lineupBox.getChildren().add(row);
        }

        // 상대팀 선택
        HBox oppBox = new HBox(12);
        oppBox.setAlignment(Pos.CENTER_LEFT);
        Label oppLabel = new Label("상대팀:");
        oppLabel.setStyle("-fx-text-fill: #e2e8f0; -fx-font-size: 12px;");
        ComboBox<String> oppCombo = new ComboBox<>();
        oppCombo.getItems().addAll(gm.getOpponentNames());
        oppCombo.setValue(oppCombo.getItems().isEmpty() ? "상대팀" : oppCombo.getItems().get(0));
        oppCombo.setStyle("-fx-background-color: #1e293b; -fx-text-fill: #e2e8f0;");
        oppCombo.setPrefWidth(200);
        oppBox.getChildren().addAll(oppLabel, oppCombo);

        // 시작 버튼
        HBox btnBox = new HBox(10);
        Button startBtn = new Button("▶ 경기 시작!");
        startBtn.setStyle("-fx-background-color: " + COLOR_RED + "; -fx-text-fill: white; -fx-font-size: 13px; -fx-font-weight: bold; -fx-padding: 10 24; -fx-cursor: hand;");
        Button autoStartBtn = new Button("⏩ 자동 경기");
        autoStartBtn.setStyle("-fx-background-color: #334155; -fx-text-fill: #e2e8f0; -fx-font-size: 12px; -fx-padding: 10 18; -fx-cursor: hand;");

        startBtn.setOnAction(e -> {
            String opp = oppCombo.getValue();
            if (opp == null) return;
            startGameSession(opp, false);
        });
        autoStartBtn.setOnAction(e -> {
            String opp = oppCombo.getValue();
            if (opp == null) return;
            startGameSession(opp, true);
        });
        btnBox.getChildren().addAll(startBtn, autoStartBtn);

        panel.getChildren().addAll(title, starterBox, lineupBox, oppBox, btnBox);
        ScrollPane scroll = new ScrollPane(panel);
        scroll.setFitToWidth(true);
        scroll.setStyle("-fx-background-color: #0d0d0d; -fx-background: #0d0d0d;");
        contentArea.getChildren().setAll(scroll);
    }

    private void autoLineup() {
        lineup = gm.getRoster().stream()
            .filter(p -> !p.isPitcher())
            .sorted((a, b) -> Integer.compare(b.getEffectiveOvr(), a.getEffectiveOvr()))
            .limit(9)
            .collect(Collectors.toList());
    }

    // ════════════════════════════════════════════
    // 경기 진행 (GameScreen)
    // ════════════════════════════════════════════
    private void startGameSession(String opp, boolean autoFull) {
        if (lineup.size() < 9) {
            showAlert("타순 부족", "타순은 야수 9명이 필요합니다. 로스터를 확인하세요.");
            return;
        }
        List<Player> pitchers = gm.getRoster().stream()
            .filter(Player::isPitcher).collect(Collectors.toList());
        if (pitchers.isEmpty()) {
            showAlert("투수 부족", "투수가 1명 이상 필요합니다.");
            return;
        }

        List<Player> oppRoster = gm.buildOppRoster(opp);
        List<Player> oppLineup = oppRoster.stream()
            .filter(p -> !p.isPitcher())
            .sorted((a, b) -> b.getOvr() - a.getOvr())
            .limit(9)
            .collect(Collectors.toList());
        if (oppLineup.size() < 9) {
            showAlert("상대 팀 구성 실패", "상대 팀 타자가 부족합니다. 다른 팀을 선택하세요.");
            return;
        }
        Player oppStarter = oppRoster.stream().filter(p -> p.getPos() == Position.SP).findFirst()
            .orElse(oppRoster.stream().filter(Player::isPitcher).findFirst().orElse(null));

        gs = new GameState(gm.getMyTeamName(), opp);
        TeamState mine = gs.getMine(), theirs = gs.getTheirs();
        mine.getLineup().addAll(lineup);
        mine.getRoster().addAll(gm.getRoster());
        mine.setPitcher(selectedStarter != null ? selectedStarter : pitchers.get(0));
        theirs.getLineup().addAll(oppLineup);
        theirs.getRoster().addAll(oppRoster);
        theirs.setPitcher(oppStarter);

        engine.startGame(gs);
        GameScreen screen = new GameScreen(gm, engine, gs, this::onGameOver);
        contentArea.getChildren().setAll(screen);
        if (autoFull) screen.runToEnd();
    }

    private void onGameOver(GameState state) {
        boolean win = state.getMine().getScore() > state.getTheirs().getScore();
        String score = state.getMine().getScore() + ":" + state.getTheirs().getScore();
        gm.recordResult(win, state.getOpponent(), score);
        gm.applyPostGameFatigue(state.getMine());
        updateTitleBar();
        showGameResult(state);
    }

    // ── 경기 결과 화면
    private void showGameResult(GameState state) {
        TeamState me = state.getMine(), them = state.getTheirs();
        boolean win = me.getScore() > them.getScore();

        VBox box = new VBox(14);
        box.setPadding(new Insets(30));
        box.setAlignment(Pos.TOP_CENTER);
        box.setStyle(BG_DARK);

        Label title = new Label(win ? "🏆 승리!" : "😢 패배");
        title.setStyle("-fx-font-size: 36px; -fx-font-weight: bold; -fx-text-fill: " + (win ? COLOR_GOLD : COLOR_RED) + ";");

        Label scoreLabel = new Label(me.getName() + "  " + me.getScore() + " : " + them.getScore() + "  " + state.getOpponent());
        scoreLabel.setStyle("-fx-font-size: 18px; -fx-text-fill: #e2e8f0;");

        Label detail = new Label("안타 " + me.getHits() + " | " + them.getHits() + "   ·   "
            + (state.getInning() > 9 ? "연장 " : "") + state.getInning() + "회 종료   ·   투구 " + state.getPitchTotal());
        detail.setStyle("-fx-font-size: 13px; -fx-text-fill: " + COLOR_MUTED + ";");

        Button backBtn = new Button("← 돌아가기");
        backBtn.setStyle("-fx-background-color: #334155; -fx-text-fill: white; -fx-font-size: 13px; -fx-padding: 10 24; -fx-cursor: hand;");
        backBtn.setOnAction(e -> showDashboard());

        Button playAgainBtn = new Button("다시 경기 ▶");
        playAgainBtn.setStyle("-fx-background-color: " + COLOR_GOLD + "; -fx-text-fill: #000; -fx-font-size: 13px; -fx-font-weight: bold; -fx-padding: 10 24; -fx-cursor: hand;");
        playAgainBtn.setOnAction(e -> showGameSetup());

        HBox btnRow = new HBox(12, backBtn, playAgainBtn);
        btnRow.setAlignment(Pos.CENTER);

        box.getChildren().addAll(title, scoreLabel, detail, GameScreen.linescore(state),
            buildPitcherTable(me), buildPitcherTable(them), btnRow);

        ScrollPane sp = new ScrollPane(box);
        sp.setFitToWidth(true);
        sp.setStyle("-fx-background-color: #0d0d0d; -fx-background: #0d0d0d;");
        contentArea.getChildren().setAll(sp);
    }

    private VBox buildPitcherTable(TeamState t) {
        VBox v = new VBox(6);
        v.setPadding(new Insets(12));
        v.setMaxWidth(640);
        v.setStyle(BG_PANEL + " -fx-border-color: #333;");

        Label title = new Label("⚾ " + t.getName() + " 투수 기록");
        title.setStyle("-fx-text-fill: " + COLOR_GOLD + "; -fx-font-size: 13px; -fx-font-weight: bold;");

        GridPane g = new GridPane();
        g.setHgap(16);
        g.setVgap(4);
        String[] hdr = {"투수", "이닝", "투구", "피안타", "실점", "볼넷", "삼진"};
        for (int i = 0; i < hdr.length; i++) {
            Label h = new Label(hdr[i]);
            h.setStyle("-fx-text-fill: " + COLOR_MUTED + "; -fx-font-size: 11px;");
            g.add(h, i, 0);
        }
        int row = 1;
        for (PitcherLine l : t.getPitcherLines()) {
            String[] vals = {
                l.getPitcher().getName(), l.getInningsText(), String.valueOf(l.getPitches()),
                String.valueOf(l.getHits()), String.valueOf(l.getRuns()),
                String.valueOf(l.getWalks()), String.valueOf(l.getStrikeouts())
            };
            for (int i = 0; i < vals.length; i++) {
                Label c = new Label(vals[i]);
                c.setStyle("-fx-text-fill: #e2e8f0; -fx-font-size: 12px;");
                g.add(c, i, row);
            }
            row++;
        }
        v.getChildren().addAll(title, g);
        return v;
    }

    private void showRoster() {
        VBox panel = new VBox(12);
        panel.setPadding(new Insets(20));
        panel.setStyle(BG_DARK);

        Label title = new Label("👥 로스터 관리");
        title.setStyle("-fx-font-size: 16px; -fx-font-weight: bold; -fx-text-fill: " + COLOR_GOLD + ";");

        TableView<Player> table = buildPlayerTable(gm.getRoster(), true);
        VBox.setVgrow(table, Priority.ALWAYS);

        panel.getChildren().addAll(title, table);
        contentArea.getChildren().setAll(panel);
    }

    // ════════════════════════════════════════════
    // FA 화면
    // ════════════════════════════════════════════
    private void showFA() {
        VBox panel = new VBox(12);
        panel.setPadding(new Insets(20));
        panel.setStyle(BG_DARK);

        Label title = new Label("💰 FA 시장");
        title.setStyle("-fx-font-size: 16px; -fx-font-weight: bold; -fx-text-fill: " + COLOR_GOLD + ";");

        Label budget = new Label("잔여 예산: $" + String.format("%.0f", gm.getBudget()) + "M");
        budget.setStyle("-fx-text-fill: " + COLOR_GREEN + "; -fx-font-size: 13px;");
        budget.setId("fa-budget");

        TableView<Player> table = new TableView<>();
        table.setStyle("-fx-background-color: #1a1a2e;");
        table.setColumnResizePolicy(TableView.CONSTRAINED_RESIZE_POLICY);

        TableColumn<Player, String> nameCol = new TableColumn<>("선수명");
        nameCol.setCellValueFactory(d -> new javafx.beans.property.SimpleStringProperty(d.getValue().getName()));
        TableColumn<Player, String> posCol = new TableColumn<>("포지션");
        posCol.setCellValueFactory(d -> new javafx.beans.property.SimpleStringProperty(d.getValue().getPos().toString()));
        posCol.setMaxWidth(60);
        TableColumn<Player, String> lgCol = new TableColumn<>("리그");
        lgCol.setCellValueFactory(d -> new javafx.beans.property.SimpleStringProperty(d.getValue().getLeague()));
        lgCol.setMaxWidth(70);
        TableColumn<Player, Number> ovrCol = new TableColumn<>("OVR");
        ovrCol.setCellValueFactory(d -> new javafx.beans.property.SimpleIntegerProperty(d.getValue().getOvr()));
        ovrCol.setMaxWidth(50);
        TableColumn<Player, String> salCol = new TableColumn<>("연봉");
        salCol.setCellValueFactory(d -> new javafx.beans.property.SimpleStringProperty("$" + d.getValue().getSalary() + "M"));
        salCol.setMaxWidth(70);
        TableColumn<Player, Number> yrsCol = new TableColumn<>("계약");
        yrsCol.setCellValueFactory(d -> new javafx.beans.property.SimpleIntegerProperty(d.getValue().getContract()));
        yrsCol.setMaxWidth(50);

        TableColumn<Player, Void> actionCol = new TableColumn<>("계약");
        actionCol.setCellFactory(col -> new TableCell<>() {
            final Button btn = new Button("계약");
            { btn.setStyle("-fx-background-color: " + COLOR_GOLD + "; -fx-text-fill: #000; -fx-cursor: hand; -fx-padding: 3 8;"); }
            @Override protected void updateItem(Void item, boolean empty) {
                super.updateItem(item, empty);
                if (empty) { setGraphic(null); return; }
                Player p = getTableView().getItems().get(getIndex());
                btn.setDisable(gm.getBudget() < p.getSalary());
                btn.setOnAction(e -> {
                    if (gm.signFA(p, p.getContract())) {
                        updateTitleBar();
                        showFA();
                    } else showAlert("예산 부족", "예산이 부족합니다!");
                });
                setGraphic(btn);
            }
        });

        table.getColumns().addAll(nameCol, posCol, lgCol, ovrCol, salCol, yrsCol, actionCol);
        table.getItems().addAll(gm.getFaPool());
        VBox.setVgrow(table, Priority.ALWAYS);

        panel.getChildren().addAll(title, budget, table);
        contentArea.getChildren().setAll(panel);
    }

    // ════════════════════════════════════════════
    // 드래프트 화면
    // ════════════════════════════════════════════
    private void showDraft() {
        VBox panel = new VBox(12);
        panel.setPadding(new Insets(20));
        panel.setStyle(BG_DARK);

        Label title = new Label("📋 드래프트");
        title.setStyle("-fx-font-size: 16px; -fx-font-weight: bold; -fx-text-fill: " + COLOR_GOLD + ";");
        Label picksLabel = new Label("남은 픽: " + gm.getDraftPicks() + "개");
        picksLabel.setStyle("-fx-text-fill: " + COLOR_BLUE + "; -fx-font-size: 13px;");

        TableView<Player> table = new TableView<>();
        table.setStyle("-fx-background-color: #1a1a2e;");
        table.setColumnResizePolicy(TableView.CONSTRAINED_RESIZE_POLICY);

        TableColumn<Player, String> nameCol = new TableColumn<>("선수명");
        nameCol.setCellValueFactory(d -> new javafx.beans.property.SimpleStringProperty(d.getValue().getName()));
        TableColumn<Player, String> posCol = new TableColumn<>("포지션");
        posCol.setCellValueFactory(d -> new javafx.beans.property.SimpleStringProperty(d.getValue().getPos().toString()));
        posCol.setMaxWidth(60);
        TableColumn<Player, Number> ovrCol = new TableColumn<>("OVR");
        ovrCol.setCellValueFactory(d -> new javafx.beans.property.SimpleIntegerProperty(d.getValue().getOvr()));
        ovrCol.setMaxWidth(55);
        TableColumn<Player, Number> potCol = new TableColumn<>("잠재력");
        potCol.setCellValueFactory(d -> new javafx.beans.property.SimpleIntegerProperty(d.getValue().getPotential()));
        potCol.setMaxWidth(60);

        TableColumn<Player, Void> actionCol = new TableColumn<>("지명");
        actionCol.setCellFactory(col -> new TableCell<>() {
            final Button btn = new Button("드래프트");
            { btn.setStyle("-fx-background-color: " + COLOR_GOLD + "; -fx-text-fill: #000; -fx-cursor: hand; -fx-padding: 3 8;"); }
            @Override protected void updateItem(Void item, boolean empty) {
                super.updateItem(item, empty);
                if (empty) { setGraphic(null); return; }
                Player p = getTableView().getItems().get(getIndex());
                btn.setDisable(gm.getDraftPicks() <= 0);
                btn.setOnAction(e -> {
                    if (gm.draftPlayer(p)) showDraft();
                    else showAlert("픽 없음", "드래프트 픽이 없습니다!");
                });
                setGraphic(btn);
            }
        });

        table.getColumns().addAll(nameCol, posCol, ovrCol, potCol, actionCol);
        table.getItems().addAll(gm.getDraftPool());
        VBox.setVgrow(table, Priority.ALWAYS);

        panel.getChildren().addAll(title, picksLabel, table);
        contentArea.getChildren().setAll(panel);
    }

    // ════════════════════════════════════════════
    // 순위표
    // ════════════════════════════════════════════
    private void showStandings() {
        VBox panel = new VBox(16);
        panel.setPadding(new Insets(20));
        panel.setStyle(BG_DARK);

        Label title = new Label("📊 리그 순위표");
        title.setStyle("-fx-font-size: 16px; -fx-font-weight: bold; -fx-text-fill: " + COLOR_GOLD + ";");

        HBox cols = new HBox(20);
        cols.getChildren().addAll(
            buildStandingsTable("🏟️ KBO 리그", gm.getKboStandings()),
            buildStandingsTable("🇯🇵 NPB 리그", gm.getNpbStandings()),
            buildStandingsTable("🌏 MLB 리그", gm.getMlbStandings())
        );
        HBox.setHgrow(cols.getChildren().get(0), Priority.ALWAYS);
        HBox.setHgrow(cols.getChildren().get(1), Priority.ALWAYS);
        HBox.setHgrow(cols.getChildren().get(2), Priority.ALWAYS);

        panel.getChildren().addAll(title, cols);
        ScrollPane sp = new ScrollPane(panel);
        sp.setFitToWidth(true);
        sp.setStyle("-fx-background-color: #0d0d0d; -fx-background: #0d0d0d;");
        contentArea.getChildren().setAll(sp);
    }

    private VBox buildStandingsTable(String leagueTitle, List<GameManager.TeamRecord> records) {
        VBox box = new VBox(0);
        box.setStyle(BG_PANEL + " -fx-border-color: #333;");

        Label lt = new Label(leagueTitle);
        lt.setStyle("-fx-text-fill: " + COLOR_GOLD + "; -fx-font-size: 12px; -fx-font-weight: bold; -fx-padding: 8 12;");
        box.getChildren().add(lt);

        HBox header = new HBox();
        header.setStyle("-fx-background-color: #0a0a1a; -fx-padding: 4 12;");
        for (String h : new String[]{"순위", "팀명", "승", "패", "승률"}) {
            Label l = new Label(h);
            l.setStyle("-fx-text-fill: " + COLOR_MUTED + "; -fx-font-size: 10px; -fx-min-width: " + (h.equals("팀명") ? "100" : "40") + "px;");
            header.getChildren().add(l);
        }
        box.getChildren().add(header);

        for (int i = 0; i < records.size(); i++) {
            GameManager.TeamRecord r = records.get(i);
            HBox row = new HBox();
            row.setStyle("-fx-padding: 5 12; -fx-border-color: #1e293b; -fx-border-width: 0 0 1 0;" +
                (r.isMyTeam() ? "-fx-background-color: rgba(245,166,35,0.08);" : ""));

            Label rank = new Label(String.valueOf(i+1));
            rank.setStyle("-fx-text-fill: " + COLOR_MUTED + "; -fx-font-size: 11px; -fx-min-width: 40px;");
            Label name = new Label(r.getName());
            name.setStyle("-fx-text-fill: " + (r.isMyTeam() ? COLOR_GOLD : "#e2e8f0") + "; -fx-font-size: 11px; -fx-min-width: 100px; -fx-font-weight: " + (r.isMyTeam() ? "bold" : "normal") + ";");
            Label wins = new Label(String.valueOf(r.getWins()));
            wins.setStyle("-fx-text-fill: " + COLOR_GREEN + "; -fx-font-size: 11px; -fx-min-width: 40px;");
            Label losses = new Label(String.valueOf(r.getLosses()));
            losses.setStyle("-fx-text-fill: " + COLOR_RED + "; -fx-font-size: 11px; -fx-min-width: 40px;");
            Label wr = new Label(r.getWinRateStr());
            wr.setStyle("-fx-text-fill: " + COLOR_MUTED + "; -fx-font-size: 11px; -fx-min-width: 50px;");

            row.getChildren().addAll(rank, name, wins, losses, wr);
            box.getChildren().add(row);
        }
        return box;
    }

    // ── 공통 유틸
    private TableView<Player> buildPlayerTable(List<Player> players, boolean showActions) {
        TableView<Player> table = new TableView<>();
        table.setStyle("-fx-background-color: #1a1a2e;");
        table.setColumnResizePolicy(TableView.CONSTRAINED_RESIZE_POLICY);

        TableColumn<Player, String> nameCol = new TableColumn<>("선수명");
        nameCol.setCellValueFactory(d -> new javafx.beans.property.SimpleStringProperty(d.getValue().getName()));
        TableColumn<Player, String> posCol = new TableColumn<>("포지션");
        posCol.setCellValueFactory(d -> new javafx.beans.property.SimpleStringProperty(d.getValue().getPos().toString()));
        posCol.setMaxWidth(65);
        TableColumn<Player, Number> ovrCol = new TableColumn<>("OVR");
        ovrCol.setCellValueFactory(d -> new javafx.beans.property.SimpleIntegerProperty(d.getValue().getEffectiveOvr()));
        ovrCol.setMaxWidth(55);
        TableColumn<Player, String> condCol = new TableColumn<>("컨디션");
        condCol.setCellValueFactory(d -> new javafx.beans.property.SimpleStringProperty(d.getValue().getCondition().toString()));
        condCol.setMaxWidth(80);
        TableColumn<Player, Number> fatCol = new TableColumn<>("피로도");
        fatCol.setCellValueFactory(d -> new javafx.beans.property.SimpleIntegerProperty(d.getValue().getFatigue()));
        fatCol.setMaxWidth(60);

        table.getColumns().addAll(nameCol, posCol, ovrCol, condCol, fatCol);

        if (showActions) {
            TableColumn<Player, Void> actionCol = new TableColumn<>("관리");
            actionCol.setCellFactory(col -> new TableCell<>() {
                final Button relBtn = new Button("방출");
                { relBtn.setStyle("-fx-background-color: " + COLOR_RED + "; -fx-text-fill: white; -fx-cursor: hand; -fx-padding: 3 8;"); }
                @Override protected void updateItem(Void item, boolean empty) {
                    super.updateItem(item, empty);
                    if (empty) { setGraphic(null); return; }
                    Player p = getTableView().getItems().get(getIndex());
                    relBtn.setOnAction(e -> {
                        Alert confirm = new Alert(Alert.AlertType.CONFIRMATION,
                            p.getName() + "을(를) 방출하시겠습니까?");
                        confirm.showAndWait().ifPresent(r -> {
                            if (r == ButtonType.OK) { gm.releasePlayer(p); updateTitleBar(); showRoster(); }
                        });
                    });
                    setGraphic(relBtn);
                }
            });
            table.getColumns().add(actionCol);
        }

        table.getItems().addAll(players);
        return table;
    }

    private String ovrColor(int ovr) {
        if (ovr >= 90) return COLOR_GOLD;
        if (ovr >= 80) return COLOR_GREEN;
        if (ovr >= 70) return COLOR_BLUE;
        return COLOR_MUTED;
    }

    private void lookup(VBox parent, String id, java.util.function.Consumer<Label> action) {
        parent.lookupAll("#" + id).forEach(n -> { if (n instanceof Label) action.accept((Label) n); });
    }

    private void showAlert(String title, String msg) {
        Alert alert = new Alert(Alert.AlertType.INFORMATION);
        alert.setTitle(title);
        alert.setHeaderText(null);
        alert.setContentText(msg);
        alert.showAndWait();
    }

}
