package com.baseball9.ui;

import com.baseball9.engine.GameEngine;
import com.baseball9.engine.GameManager;
import com.baseball9.engine.GameEngine.Kind;
import com.baseball9.engine.GameEngine.Line;
import com.baseball9.engine.GameEngine.Mode;
import com.baseball9.engine.GameEngine.PitchCall;
import com.baseball9.engine.GameEngine.StepResult;
import com.baseball9.model.*;
import javafx.animation.KeyFrame;
import javafx.animation.Timeline;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.text.Font;
import javafx.scene.text.FontWeight;
import javafx.util.Duration;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 경기 화면: 중계 로그 + 야구장 다이어그램 + 감독 지시 버튼.
 * 자동 중계는 감독 판단 시점(주자 상황 / 투수 체력 저하)에서 멈춥니다.
 */
public class GameScreen extends BorderPane {

    private static final String BG_DARK  = "-fx-background-color: #0d0d0d;";
    private static final String BG_PANEL = "-fx-background-color: #1a1a2e;";
    private static final String BTN_BASE = "-fx-font-size: 12px; -fx-padding: 7 12; -fx-cursor: hand; -fx-text-fill: white;";
    private static final String GOLD = "#f5a623";
    private static final String MUTED = "#64748b";

    private final GameManager gm;
    private final GameEngine engine;
    private final GameState gs;
    private final Consumer<GameState> onGameOver;
    private boolean finished = false;

    // 위젯
    private final VBox scoreTop = new VBox(6);
    private final FieldView field = new FieldView(600, 220);
    private final VBox logBox = new VBox(3);
    private final ScrollPane logScroll = new ScrollPane(logBox);
    private final VBox rightPanel = new VBox(10);
    private final Label banner = new Label();
    private final Button autoBtn = new Button("▶ 자동 중계");
    private final ComboBox<String> speedBox = new ComboBox<>();
    private final ComboBox<PitchCall> callBox = new ComboBox<>();
    private final Button btnBunt = orderButton("🥎 번트");
    private final Button btnSteal = orderButton("🏃 도루");
    private final Button btnPinchHit = orderButton("🔁 대타");
    private final Button btnPinchRun = orderButton("🏃 대주자");
    private final Button btnIbb = orderButton("🚫 고의4구");
    private final Button btnPitcher = orderButton("🔄 투수 교체");

    private Timeline timeline;
    private boolean autoRunning = false;
    private int speedMs = 900;

    public GameScreen(GameManager gm, GameEngine engine, GameState gs, Consumer<GameState> onGameOver) {
        this.gm = gm;
        this.engine = engine;
        this.gs = gs;
        this.onGameOver = onGameOver;

        setStyle(BG_DARK);
        setTop(buildTop());
        setCenter(buildCenter());
        setRight(buildRight());
        setBottom(buildBottom());

        timeline = buildTimeline();

        for (Line l : engine.drainQueue()) appendLine(l);
        refresh();
    }

    // ════════════════════════════════════════════════════
    // 레이아웃
    // ════════════════════════════════════════════════════

    private VBox buildTop() {
        scoreTop.setPadding(new Insets(6, 16, 6, 16));
        scoreTop.setStyle("-fx-background-color: #001800; -fx-border-color: #16a34a; -fx-border-width: 0 0 2 0;");
        return scoreTop;
    }

    private VBox buildCenter() {
        VBox center = new VBox(10);
        center.setPadding(new Insets(8, 12, 8, 12));
        center.setStyle(BG_DARK);

        field.setHeight(220);
        field.widthProperty().bind(logScroll.widthProperty());   // 다이어그램 폭 = 중앙 영역 폭
        VBox.setVgrow(logScroll, Priority.ALWAYS);
        logBox.setPadding(new Insets(8));
        logBox.setStyle("-fx-background-color: #000e00;");
        logScroll.setFitToWidth(true);
        logScroll.setStyle("-fx-background: #000e00; -fx-background-color: #000e00; -fx-border-color: #14532d;");
        logScroll.setMinHeight(120);

        center.getChildren().addAll(field, logScroll);
        return center;
    }

    private ScrollPane buildRight() {
        rightPanel.setPadding(new Insets(12));
        rightPanel.setPrefWidth(240);
        rightPanel.setStyle(BG_PANEL + " -fx-border-color: #333; -fx-border-width: 0 0 0 1;");
        ScrollPane sp = new ScrollPane(rightPanel);
        sp.setFitToWidth(true);
        sp.setPrefWidth(250);
        sp.setStyle("-fx-background: #1a1a2e; -fx-background-color: #1a1a2e;");
        return sp;
    }

    private VBox buildBottom() {
        // 판단 배너
        banner.setWrapText(true);
        banner.setMaxWidth(Double.MAX_VALUE);
        banner.setPadding(new Insets(6, 12, 6, 12));
        banner.setStyle("-fx-font-size: 12px; -fx-font-weight: bold; -fx-text-fill: #0d0d0d;");

        // 재생 조작
        Button oneBtn = playButton("▶ 한 구", "#334155");
        Button atBatBtn = playButton("⏭ 한 타석", "#334155");
        Button inningBtn = playButton("⏩ 이닝", "#334155");
        Button gameBtn = playButton("🏁 끝까지", "#7c2d12");

        autoBtn.setStyle(BTN_BASE + " -fx-background-color: #117a65; -fx-font-weight: bold;");
        autoBtn.setOnAction(e -> toggleAuto());

        speedBox.getItems().addAll("느리게", "보통", "빠르게");
        speedBox.setValue("보통");
        speedBox.setStyle("-fx-font-size: 12px;");
        speedBox.setOnAction(e -> {
            String v = speedBox.getValue();
            speedMs = "느리게".equals(v) ? 1600 : "빠르게".equals(v) ? 400 : 900;
            boolean was = autoRunning;
            stopAuto();
            timeline = buildTimeline();
            if (was) startAuto();
        });

        oneBtn.setOnAction(e -> { pauseAuto(); engine.ackDecision(); consume(engine.run(Mode.PITCH)); });
        atBatBtn.setOnAction(e -> { pauseAuto(); engine.ackDecision(); consume(engine.run(Mode.AT_BAT)); });
        inningBtn.setOnAction(e -> { pauseAuto(); engine.ackDecision(); consume(engine.run(Mode.HALF_INNING, true)); });
        gameBtn.setOnAction(e -> { pauseAuto(); engine.ackDecision(); consume(engine.run(Mode.GAME)); });

        HBox play = new HBox(8, oneBtn, atBatBtn, inningBtn, autoBtn, new Label("속도"), speedBox, gameBtn);
        play.setAlignment(Pos.CENTER_LEFT);
        for (javafx.scene.Node n : play.getChildren()) if (n instanceof Label l) l.setStyle("-fx-text-fill: #94a3b8; -fx-font-size: 12px;");

        // 감독 지시
        btnBunt.setOnAction(e -> {
            pauseAuto();
            engine.requestBunt();
            flushQueue();
            refresh();
        });
        btnSteal.setOnAction(e -> {
            pauseAuto();
            List<Integer> bases = engine.stealableBases();
            if (bases.isEmpty()) return;
            Integer from = choose("도루 사인", "도루를 시도할 주자를 고르세요",
                bases, b -> (b + 1) + "루 주자 " + gs.getRunners()[b].getName() + " → " + (b + 2) + "루");
            if (from != null) engine.requestSteal(from);
            flushQueue();
            refresh();
        });
        btnPinchHit.setOnAction(e -> {
            pauseAuto();
            Player sub = choose("대타", "타석에 세울 벤치 선수를 고르세요",
                gs.getMine().bench(), GameScreen::playerLabel);
            if (sub != null) engine.requestPinchHit(sub);
            flushQueue();
            refresh();
        });
        btnPinchRun.setOnAction(e -> {
            pauseAuto();
            List<Integer> bases = new ArrayList<>();
            for (int i = 0; i < 3; i++) if (gs.getRunners()[i] != null) bases.add(i);
            Integer base = choose("대주자", "교체할 주자를 고르세요", bases,
                b -> (b + 1) + "루 주자 " + gs.getRunners()[b].getName());
            if (base != null) {
                Player sub = choose("대주자", "투입할 벤치 선수를 고르세요",
                    gs.getMine().bench(), GameScreen::playerLabel);
                if (sub != null) engine.requestPinchRun(base, sub);
            }
            flushQueue();
            refresh();
        });
        btnIbb.setOnAction(e -> {
            pauseAuto();
            engine.requestIntentionalWalk();
            flushQueue();
            refresh();
        });
        btnPitcher.setOnAction(e -> {
            pauseAuto();
            Player next = choose("투수 교체", "교체 투수를 고르세요",
                gs.getMine().bullpen(),
                p -> playerLabel(p) + "  · 체력 " + p.getHp() + " · 피로 " + p.getFatigue());
            if (next != null) engine.requestPitcherChange(next);
            flushQueue();
            refresh();
        });

        callBox.getItems().addAll(PitchCall.values());
        callBox.setValue(engine.getPitchCall());
        callBox.setPrefWidth(140);
        callBox.setOnAction(e -> {
            if (callBox.getValue() != null) engine.setPitchCall(callBox.getValue());
        });
        Label callLabel = new Label("구종 사인(수비)");
        callLabel.setStyle("-fx-text-fill: #94a3b8; -fx-font-size: 12px;");

        HBox orders = new HBox(8, btnBunt, btnSteal, btnPinchHit, btnPinchRun, btnIbb, btnPitcher, callLabel, callBox);
        orders.setAlignment(Pos.CENTER_LEFT);

        VBox bottom = new VBox(8, banner, play, orders);
        bottom.setPadding(new Insets(6, 16, 8, 16));
        bottom.setStyle("-fx-background-color: #0a0a1a; -fx-border-color: #333; -fx-border-width: 1 0 0 0;");
        return bottom;
    }

    private Timeline buildTimeline() {
        Timeline t = new Timeline(new KeyFrame(Duration.millis(speedMs), e -> autoTick()));
        t.setCycleCount(Timeline.INDEFINITE);
        return t;
    }

    private static Button orderButton(String text) {
        Button b = new Button(text);
        b.setStyle(BTN_BASE + " -fx-background-color: #7c4a03;");
        return b;
    }

    private static Button playButton(String text, String color) {
        Button b = new Button(text);
        b.setStyle(BTN_BASE + " -fx-background-color: " + color + ";");
        return b;
    }

    // ════════════════════════════════════════════════════
    // 진행
    // ════════════════════════════════════════════════════

    private void toggleAuto() {
        if (finished) return;
        if (autoRunning) {
            stopAuto();
        } else {
            engine.ackDecision();     // 판단 지점에서 재개하는 경우 이번 타석은 그대로 진행
            startAuto();
        }
        refresh();
    }

    private void startAuto() {
        autoRunning = true;
        autoBtn.setText("⏸ 일시정지");
        autoBtn.setStyle(BTN_BASE + " -fx-background-color: #922b21; -fx-font-weight: bold;");
        timeline.play();
    }

    private void stopAuto() {
        autoRunning = false;
        timeline.stop();
        autoBtn.setText("▶ 자동 중계");
        autoBtn.setStyle(BTN_BASE + " -fx-background-color: #117a65; -fx-font-weight: bold;");
    }

    private void pauseAuto() {
        if (autoRunning) stopAuto();
    }

    private void autoTick() {
        if (finished) { stopAuto(); return; }
        if (engine.needsDecision()) {        // 감독 판단 지점: 자동 중계 일시정지
            stopAuto();
            refresh();
            return;
        }
        consume(engine.run(Mode.PITCH));
    }

    private void consume(StepResult r) {
        for (Line l : r.getLines()) appendLine(l);
        refresh();
        if (r.isGameOver() && !finished) {
            finished = true;
            stopAuto();
            onGameOver.accept(gs);
        }
    }

    private void flushQueue() {
        for (Line l : engine.drainQueue()) appendLine(l);
    }

    /** 경기 끝까지 바로 진행 (자동 경기 버튼용) */
    public void runToEnd() {
        pauseAuto();
        engine.ackDecision();
        consume(engine.run(Mode.GAME));
    }

    // ════════════════════════════════════════════════════
    // 화면 갱신
    // ════════════════════════════════════════════════════

    private void refresh() {
        scoreTop.getChildren().setAll(buildScoreboard(), linescore(gs));
        field.update(gs);
        refreshRight();
        refreshBanner();
        refreshOrderButtons();
    }

    private VBox buildScoreboard() {
        TeamState me = gs.getMine(), them = gs.getTheirs();
        Label myName = new Label(me.getName());
        myName.setStyle("-fx-text-fill: #4ade80; -fx-font-size: 14px; -fx-font-weight: bold;");
        Label mySc = new Label(String.valueOf(me.getScore()));
        mySc.setStyle("-fx-text-fill: #4ade80; -fx-font-size: 24px; -fx-font-weight: bold;");
        Label colon = new Label(":");
        colon.setStyle("-fx-text-fill: #166534; -fx-font-size: 22px;");
        Label thSc = new Label(String.valueOf(them.getScore()));
        thSc.setStyle("-fx-text-fill: #4ade80; -fx-font-size: 24px; -fx-font-weight: bold;");
        Label theirName = new Label(gs.getOpponent());
        theirName.setStyle("-fx-text-fill: #4ade80; -fx-font-size: 14px; -fx-font-weight: bold;");

        Label state = new Label(gs.getInning() + "회" + (gs.isTop() ? "초 ▲ 공격" : "말 ▼ 공격")
            + "   |   " + gs.getOuts() + "아웃   B" + gs.getBalls() + " S" + gs.getStrikes()
            + "   |   투구 " + gs.getPitchTotal());
        state.setStyle("-fx-text-fill: #86efac; -fx-font-size: 12px;");

        HBox row = new HBox(14, myName, mySc, colon, thSc, theirName);
        row.setAlignment(Pos.CENTER);
        VBox box = new VBox(4, row, state);
        box.setAlignment(Pos.CENTER);
        return box;
    }

    /** 이닝별 득점판 (공용: 경기 화면 / 결과 화면) */
    public static GridPane linescore(GameState gs) {
        TeamState me = gs.getMine(), them = gs.getTheirs();
        int cols = Math.max(9, Math.max(me.getInningCount(), them.getInningCount()));

        GridPane g = new GridPane();
        g.setHgap(6);
        g.setVgap(3);
        g.setAlignment(Pos.CENTER);
        g.setPadding(new Insets(6));
        g.setStyle(BG_PANEL);

        Label hdrTeam = cell("팀", MUTED, 90, true);
        g.add(hdrTeam, 0, 0);
        for (int i = 0; i < cols; i++) g.add(cell(String.valueOf(i + 1), MUTED, 22, true), i + 1, 0);
        g.add(cell("R", GOLD, 28, true), cols + 1, 0);
        g.add(cell("H", GOLD, 28, true), cols + 2, 0);

        addLinescoreRow(g, 1, me, cols);
        addLinescoreRow(g, 2, them, cols);
        return g;
    }

    private static void addLinescoreRow(GridPane g, int row, TeamState t, int cols) {
        String n = t.getName().length() > 6 ? t.getName().substring(0, 6) : t.getName();
        g.add(cell(n, "#e2e8f0", 90, false), 0, row);
        for (int i = 0; i < cols; i++) {
            Integer r = t.getInningRuns(i);
            g.add(cell(r == null ? "" : String.valueOf(r), "#e2e8f0", 22, false), i + 1, row);
        }
        g.add(cell(String.valueOf(t.getScore()), "#4ade80", 28, true), cols + 1, row);
        g.add(cell(String.valueOf(t.getHits()), "#e2e8f0", 28, true), cols + 2, row);
    }

    private static Label cell(String text, String color, double minW, boolean bold) {
        Label l = new Label(text);
        l.setMinWidth(minW);
        l.setPrefWidth(minW);
        l.setAlignment(Pos.CENTER);
        l.setStyle("-fx-text-fill: " + color + "; -fx-font-size: 12px;"
            + (bold ? " -fx-font-weight: bold;" : ""));
        return l;
    }

    private void refreshRight() {
        rightPanel.getChildren().clear();
        TeamState me = gs.getMine(), them = gs.getTheirs();

        // 우리 타순
        rightPanel.getChildren().add(sectionTitle("📋 우리 타순"));
        for (int i = 0; i < me.getLineup().size(); i++) {
            Player p = me.getLineup().get(i);
            boolean cur = gs.isTop() && i == me.currentSlot();
            Label row = new Label(String.format("%s %d. %s [%s]  %d",
                cur ? "▶" : " ", i + 1, p.getName(), p.getPos(), p.getEffectiveOvr()));
            row.setStyle("-fx-text-fill: " + (cur ? GOLD : "#e2e8f0") + "; -fx-font-size: 11px;"
                + (cur ? " -fx-font-weight: bold;" : ""));
            rightPanel.getChildren().add(row);
        }

        // 우리 투수
        rightPanel.getChildren().add(sectionTitle("⚾ 우리 투수"));
        rightPanel.getChildren().add(pitcherInfo(me, "#4ade80"));

        // 상대 투수
        rightPanel.getChildren().add(sectionTitle("⚾ 상대 투수"));
        rightPanel.getChildren().add(pitcherInfo(them, "#fca5a5"));
    }

    private Label sectionTitle(String s) {
        Label l = new Label(s);
        l.setStyle("-fx-text-fill: " + GOLD + "; -fx-font-size: 12px; -fx-font-weight: bold;");
        VBox.setMargin(l, new Insets(6, 0, 0, 0));
        return l;
    }

    private VBox pitcherInfo(TeamState t, String color) {
        VBox box = new VBox(2);
        Player p = t.getPitcher();
        PitcherLine line = t.currentLine();
        if (p == null || line == null) {
            box.getChildren().add(new Label("-"));
            return box;
        }
        Label name = new Label(p.getName() + " (" + p.getPos() + ")");
        name.setStyle("-fx-text-fill: " + color + "; -fx-font-size: 12px; -fx-font-weight: bold;");

        String hpColor = p.getHp() > 60 ? "#4ade80" : p.getHp() > 35 ? GOLD : "#ef4444";
        Label hp = new Label("체력 " + p.getHp() + "%   피로 " + p.getFatigue() + "%");
        hp.setStyle("-fx-text-fill: " + hpColor + "; -fx-font-size: 11px;");

        Label stat = new Label(String.format("%s이닝 · %d구 · %d피안타 · %d실점 · %d삼진 · %d볼넷",
            line.getInningsText(), line.getPitches(), line.getHits(), line.getRuns(),
            line.getStrikeouts(), line.getWalks()));
        stat.setWrapText(true);
        stat.setStyle("-fx-text-fill: #94a3b8; -fx-font-size: 10px;");

        box.getChildren().addAll(name, hp, stat);
        return box;
    }

    private void refreshBanner() {
        if (finished) {
            banner.setText("🏁 경기 종료");
            banner.setStyle("-fx-font-size: 12px; -fx-font-weight: bold; -fx-text-fill: #0d0d0d; -fx-background-color: " + GOLD + ";");
            return;
        }
        if (autoRunning) {
            banner.setText("▶ 자동 중계 중 — 감독 판단이 필요하면 자동으로 멈춥니다");
            banner.setStyle("-fx-font-size: 12px; -fx-font-weight: bold; -fx-text-fill: #e2e8f0; -fx-background-color: #134e4a;");
            return;
        }
        if (engine.needsDecision()) {
            String msg = gs.isTop()
                ? "🧠 주자 상황입니다! 번트·도루·대타·대주자를 판단하거나 ‘▶ 한 구’로 진행하세요"
                : "🧠 우리 투수 체력이 떨어졌습니다. 투수 교체를 고려하거나 ‘▶ 한 구’로 진행하세요";
            banner.setText(msg);
            banner.setStyle("-fx-font-size: 12px; -fx-font-weight: bold; -fx-text-fill: #0d0d0d; -fx-background-color: " + GOLD + ";");
            return;
        }
        banner.setText(gs.isTop() ? "⚾ 공격 중 — 감독 사인을 낼 수 있습니다" : "⚾ 수비 중 — 구종 사인과 투수 교체를 지시할 수 있습니다");
        banner.setStyle("-fx-font-size: 12px; -fx-text-fill: #94a3b8; -fx-background-color: #111827;");
    }

    private void refreshOrderButtons() {
        boolean over = gs.isDone();
        boolean atk = gs.isTop();
        btnBunt.setDisable(over || !engine.canBunt());
        btnSteal.setDisable(over || engine.stealableBases().isEmpty());
        btnPinchHit.setDisable(over || !atk || gs.getMine().bench().isEmpty());
        btnPinchRun.setDisable(over || !atk || !gs.hasRunners() || gs.getMine().bench().isEmpty());
        btnIbb.setDisable(over || !engine.canIntentionalWalk());
        btnPitcher.setDisable(over || atk || gs.getMine().bullpen().isEmpty());
        callBox.setDisable(over || atk);
    }

    // ════════════════════════════════════════════════════
    // 중계 로그
    // ════════════════════════════════════════════════════

    private void appendLine(Line l) {
        if (l.getKind() == Kind.INNING) {
            Label sep = new Label("──────────────────────────────────────");
            sep.setStyle("-fx-text-fill: #14532d; -fx-font-size: 10px;");
            logBox.getChildren().add(sep);
        }
        Label lab = new Label(l.getText());
        lab.setWrapText(true);
        lab.setMaxWidth(Double.MAX_VALUE);
        lab.setStyle(styleOf(l.getKind()));
        logBox.getChildren().add(lab);

        while (logBox.getChildren().size() > 600) logBox.getChildren().remove(0);
        Platform.runLater(() -> logScroll.setVvalue(1.0));
    }

    private static String styleOf(Kind k) {
        String base = "-fx-font-family: 'monospace'; -fx-font-size: 12px; ";
        return switch (k) {
            case HIT     -> base + "-fx-text-fill: #4ade80; -fx-font-weight: bold;";
            case SCORE   -> base + "-fx-text-fill: #ef4444; -fx-font-weight: bold;";
            case WALK    -> base + "-fx-text-fill: #38bdf8;";
            case STEAL   -> base + "-fx-text-fill: #facc15;";
            case MANAGER -> base + "-fx-text-fill: " + GOLD + "; -fx-font-weight: bold;";
            case COLOR   -> base + "-fx-text-fill: #a78bfa; -fx-font-style: italic;";
            case INNING  -> base + "-fx-text-fill: #fb923c; -fx-font-weight: bold;";
            case END     -> base + "-fx-text-fill: " + GOLD + "; -fx-font-size: 15px; -fx-font-weight: bold;";
            case NEUTRAL -> base + "-fx-text-fill: #94a3b8;";
            case OUT     -> base + "-fx-text-fill: #cbd5e1;";
            default      -> base + "-fx-text-fill: #e2e8f0;";
        };
    }

    // ════════════════════════════════════════════════════
    // 선택 다이얼로그
    // ════════════════════════════════════════════════════

    private static String playerLabel(Player p) {
        return p.getName() + " (" + p.getPos() + ") OVR " + p.getEffectiveOvr();
    }

    /** 목록에서 하나 고르기. 취소하면 null */
    private <T> T choose(String title, String header, List<T> items, Function<T, String> label) {
        if (items == null || items.isEmpty()) return null;
        List<String> labels = items.stream().map(label).collect(Collectors.toList());
        ChoiceDialog<String> d = new ChoiceDialog<>(labels.get(0), labels);
        d.setTitle(title);
        d.setHeaderText(header);
        d.setContentText("선택:");
        d.getDialogPane().setStyle("-fx-background-color: #1a1a2e;");
        Optional<String> res = d.showAndWait();
        return res.map(s -> items.get(labels.indexOf(s))).orElse(null);
    }
}
