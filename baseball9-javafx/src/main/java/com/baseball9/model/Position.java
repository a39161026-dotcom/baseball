package com.baseball9.model;

public enum Position {
    SP("선발투수"), RP("불펜투수"), C("포수"),
    B1("1루수"), B2("2루수"), B3("3루수"), SS("유격수"),
    OF("외야수"), DH("지명타자");

    private final String label;
    Position(String label) { this.label = label; }
    public String getLabel() { return label; }

    public static Position fromString(String s) {
        return switch (s.toUpperCase()) {
            case "SP" -> SP; case "RP" -> RP; case "C" -> C;
            case "1B" -> B1; case "2B" -> B2; case "3B" -> B3;
            case "SS" -> SS; case "OF" -> OF; case "DH" -> DH;
            default -> OF;
        };
    }

    @Override
    public String toString() {
        return switch (this) {
            case B1 -> "1B"; case B2 -> "2B"; case B3 -> "3B";
            default -> name();
        };
    }
}
