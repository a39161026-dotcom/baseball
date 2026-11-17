package com.baseball9.model;

public enum Condition {
    BEST("최상", "🔥", +5),
    GOOD("좋음", "😊", +2),
    NORMAL("보통", "😐", 0),
    BAD("나쁨", "😞", -3),
    WORST("부진", "💀", -7);

    private final String label;
    private final String emoji;
    private final int ovrBonus;

    Condition(String label, String emoji, int ovrBonus) {
        this.label = label;
        this.emoji = emoji;
        this.ovrBonus = ovrBonus;
    }

    public String getLabel() { return label; }
    public String getEmoji() { return emoji; }
    public int getOvrBonus() { return ovrBonus; }

    @Override
    public String toString() { return emoji + " " + label; }
}
