package com.baseball9.ui;

import com.baseball9.model.GameState;
import com.baseball9.model.Player;
import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.paint.Color;
import javafx.scene.text.Font;
import javafx.scene.text.FontWeight;

/** 야구장 다이어그램: 베이스 위 주자, B-S-O 표시등, 타자/투수 이름 */
public class FieldView extends Canvas {

    private GameState gs;

    public FieldView(double w, double h) {
        super(w, h);
        widthProperty().addListener((o, ov, nv) -> draw());
        heightProperty().addListener((o, ov, nv) -> draw());
    }

    public void update(GameState gs) {
        this.gs = gs;
        draw();
    }

    private void draw() {
        GraphicsContext g = getGraphicsContext2D();
        double w = getWidth(), h = getHeight();

        // 배경 (관중석 어둡게)
        g.setFill(Color.web("#06140a"));
        g.fillRect(0, 0, w, h);

        double cx = w / 2;
        double homeY = h * 0.82;
        double d = h * 0.22;                 // 베이스 간 거리
        double R = d * 3.2;                  // 외야 반지름

        // 외야 잔디 (상반원)
        g.setFill(Color.web("#14532d"));
        g.fillArc(cx - R, homeY - R, R * 2, R * 2, 0, 180, javafx.scene.shape.ArcType.ROUND);

        // 내야 흙
        double[] ix = {cx, cx + d * 1.1, cx, cx - d * 1.1};
        double[] iy = {homeY, homeY - d * 1.1, homeY - d * 2.2, homeY - d * 1.1};
        g.setFill(Color.web("#a16207"));
        g.fillPolygon(ix, iy, 4);

        // 내야 잔디 (안쪽 다이아몬드)
        double[] gx = {cx, cx + d, cx, cx - d};
        double[] gy = {homeY - d * 0.1, homeY - d, homeY - d * 2, homeY - d};
        g.setFill(Color.web("#15803d"));
        g.fillPolygon(gx, gy, 4);

        // 베이스 라인
        g.setStroke(Color.web("#e5e7eb"));
        g.setLineWidth(1.5);
        g.strokePolyline(new double[]{cx, cx + d, cx, cx - d, cx},
                         new double[]{homeY, homeY - d, homeY - 2 * d, homeY - d, homeY}, 5);

        // 베이스 (1루, 2루, 3루, 홈)
        double[][] bases = {{cx + d, homeY - d}, {cx, homeY - 2 * d}, {cx - d, homeY - d}};
        for (double[] b : bases) {
            g.setFill(Color.WHITE);
            g.fillRect(b[0] - 5, b[1] - 5, 10, 10);
        }
        g.setFill(Color.WHITE);
        g.fillPolygon(new double[]{cx - 6, cx + 6, cx + 6, cx, cx - 6},
                      new double[]{homeY - 4, homeY - 4, homeY + 3, homeY + 7, homeY + 3}, 5);

        if (gs == null) return;

        // 주자
        Player[] rn = gs.getRunners();
        for (int i = 0; i < 3; i++) {
            if (rn[i] == null) continue;
            double bx = bases[i][0], by = bases[i][1];
            g.setFill(Color.web("#f5a623"));
            g.fillOval(bx - 9, by - 9, 18, 18);
            g.setStroke(Color.web("#111827"));
            g.setLineWidth(1.5);
            g.strokeOval(bx - 9, by - 9, 18, 18);
            drawText(g, shortName(rn[i]), bx, by - 14, 11, Color.web("#fde68a"), true);
        }

        // 타자 / 투수 이름
        Player batter = gs.offense().currentBatter();
        Player pitcher = gs.defense().getPitcher();
        drawText(g, "타자  " + (batter == null ? "-" : batter.getName()), 8, 16, 12, Color.web("#e2e8f0"), false, true);
        drawText(g, "투수  " + (pitcher == null ? "-" : pitcher.getName()), 8, 32, 12, Color.web("#e2e8f0"), false, true);

        // B-S-O 표시등 (우하단)
        double lx = w - 118, ly = h - 58;
        g.setFill(Color.web("#94a3b8"));
        g.setFont(Font.font("System", FontWeight.BOLD, 12));
        g.fillText("B", lx, ly + 10);
        g.fillText("S", lx, ly + 28);
        g.fillText("O", lx, ly + 46);
        for (int i = 0; i < 4; i++) lamp(g, lx + 22 + i * 18, ly, i < gs.getBalls(), Color.web("#22c55e"), i < 4);
        for (int i = 0; i < 3; i++) lamp(g, lx + 22 + i * 18, ly + 18, i < gs.getStrikes(), Color.web("#facc15"), true);
        for (int i = 0; i < 3; i++) lamp(g, lx + 22 + i * 18, ly + 36, i < gs.getOuts(), Color.web("#ef4444"), true);

        // 이닝 정보 (좌상단 아래)
        String half = gs.isTop() ? "초 ▲" : "말 ▼";
        drawText(g, gs.getInning() + "회 " + half, 8, h - 10, 13, Color.web("#f5a623"), false, true);
    }

    private void lamp(GraphicsContext g, double x, double y, boolean on, Color c, boolean show) {
        if (!show) return;
        g.setFill(on ? c : Color.web("#1f2937"));
        g.fillOval(x, y + 2, 11, 11);
        g.setStroke(Color.web("#374151"));
        g.strokeOval(x, y + 2, 11, 11);
    }

    private void drawText(GraphicsContext g, String s, double x, double y, double size, Color c, boolean center) {
        drawText(g, s, x, y, size, c, center, false);
    }

    private void drawText(GraphicsContext g, String s, double x, double y, double size, Color c, boolean center, boolean left) {
        g.setFont(Font.font("System", FontWeight.BOLD, size));
        g.setFill(c);
        g.setTextAlign(center ? javafx.scene.text.TextAlignment.CENTER : javafx.scene.text.TextAlignment.LEFT);
        g.setTextBaseline(javafx.geometry.VPos.CENTER);
        g.fillText(s, x, y);
    }

    private String shortName(Player p) {
        if (p == null) return "";
        String n = p.getName();
        return n.length() > 4 ? n.substring(0, 4) : n;
    }
}
