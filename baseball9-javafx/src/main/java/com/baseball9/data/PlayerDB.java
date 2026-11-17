package com.baseball9.data;

import com.baseball9.model.Player;
import com.baseball9.model.Position;
import java.util.ArrayList;
import java.util.List;

public class PlayerDB {

    public static List<Player> getAllPlayers() {
        List<Player> list = new ArrayList<>();

        // ── 국내 KBO ──
        list.add(new Player("선동열",   Position.SP,  "국내", 24, 99, 99, 4.5,  2, "해태타이거즈", 1986));
        list.add(new Player("최동원",   Position.SP,  "국내", 27, 97, 97, 4.0,  2, "롯데자이언츠", 1984));
        list.add(new Player("이승엽",   Position.B1,  "국내", 25, 96, 98, 8.0,  3, "삼성라이온즈", 1999));
        list.add(new Player("이종범",   Position.SS,  "국내", 24, 95, 97, 5.5,  3, "해태타이거즈", 1994));
        list.add(new Player("김도영",   Position.B3,  "국내", 22, 95, 99, 4.5,  1, "KIA타이거즈",  2024));
        list.add(new Player("이정후",   Position.OF,  "국내", 25, 93, 97, 18.0, 3, "키움히어로즈", 2023));
        list.add(new Player("코디 폰세",Position.SP,  "국내", 31, 94, 94, 20.0, 2, "KIA타이거즈",  2024));
        list.add(new Player("오승환",   Position.RP,  "국내", 25, 92, 93, 6.0,  3, "삼성라이온즈", 2007));
        list.add(new Player("박병호",   Position.B1,  "국내", 28, 91, 93, 8.0,  3, "넥센히어로즈", 2014));
        list.add(new Player("양의지",   Position.C,   "국내", 32, 90, 91, 20.0, 3, "NC다이노스",   2020));
        list.add(new Player("김동주",   Position.B1,  "국내", 28, 90, 92, 8.0,  3, "두산베어스",   2003));
        list.add(new Player("이대호",   Position.B1,  "국내", 22, 89, 96, 4.5,  2, "롯데자이언츠", 2003));
        list.add(new Player("원태인",   Position.SP,  "국내", 24, 87, 95, 5.0,  2, "삼성라이온즈", 2023));
        list.add(new Player("최형우",   Position.OF,  "국내", 34, 88, 88, 15.0, 3, "삼성라이온즈", 2015));
        list.add(new Player("양현종",   Position.SP,  "국내", 37, 86, 86, 18.0, 1, "KIA타이거즈",  2024));
        list.add(new Player("류현진",   Position.SP,  "국내", 20, 87, 97, 3.5,  2, "한화이글스",   2006));
        list.add(new Player("안우진",   Position.SP,  "국내", 24, 86, 94, 4.0,  2, "키움히어로즈", 2024));
        list.add(new Player("강백호",   Position.B1,  "국내", 26, 85, 91, 9.0,  2, "KT위즈",       2024));
        list.add(new Player("최정",     Position.B3,  "국내", 38, 85, 85, 20.0, 1, "SSG랜더스",    2024));
        list.add(new Player("노시환",   Position.B1,  "국내", 26, 85, 91, 7.0,  2, "한화이글스",   2024));
        list.add(new Player("송성문",   Position.B3,  "국내", 29, 87, 88, 15.0, 2, "키움히어로즈", 2024));
        list.add(new Player("김주원",   Position.SS,  "국내", 27, 84, 90, 8.0,  2, "NC다이노스",   2024));
        list.add(new Player("이재현",   Position.SS,  "국내", 21, 82, 95, 4.0,  2, "KIA타이거즈",  2024));
        list.add(new Player("문동주",   Position.SP,  "국내", 23, 82, 93, 5.0,  2, "한화이글스",   2024));
        list.add(new Player("김혜성",   Position.B2,  "국내", 25, 83, 90, 7.0,  2, "키움히어로즈", 2024));
        list.add(new Player("문보경",   Position.B3,  "국내", 26, 84, 90, 8.0,  2, "LG트윈스",     2024));
        list.add(new Player("정우영",   Position.RP,  "국내", 27, 82, 86, 7.0,  2, "LG트윈스",     2024));
        list.add(new Player("구자욱",   Position.OF,  "국내", 31, 83, 85, 16.0, 2, "삼성라이온즈", 2024));
        list.add(new Player("오지환",   Position.SS,  "국내", 35, 80, 80, 18.0, 2, "LG트윈스",     2024));
        list.add(new Player("박동원",   Position.C,   "국내", 29, 79, 82, 8.0,  2, "LG트윈스",     2024));

        // ── 일본 NPB ──
        list.add(new Player("야마모토 요시노부", Position.SP, "일본", 25, 97, 99, 32.0, 5, "로스앤젤레스 다저스", 2024));
        list.add(new Player("사사키 로키",       Position.SP, "일본", 22, 90, 99, 5.0,  2, "치바 롯데 마린스",   2023));
        list.add(new Player("이마나가 쇼타",     Position.SP, "일본", 29, 88, 91, 15.0, 3, "시카고 컵스",        2024));
        list.add(new Player("무라카미 무네타카", Position.B1, "일본", 23, 92, 97, 8.0,  3, "야쿠르트 스왈로즈",  2022));
        list.add(new Player("이치로",            Position.OF, "일본", 27, 96, 97, 8.0,  3, "오릭스 블루웨이브", 1999));
        list.add(new Player("다르빗슈 유",       Position.SP, "일본", 34, 92, 92, 16.0, 2, "샌디에이고 파드리스",2022));
        list.add(new Player("사카모토 하야토",   Position.SS, "일본", 28, 91, 93, 18.0, 3, "요미우리 자이언츠",  2023));
        list.add(new Player("곤도 켄스케",       Position.OF, "일본", 30, 88, 89, 15.0, 3, "후쿠오카 소프트뱅크",2023));
        list.add(new Player("요시다 마사타카",   Position.OF, "일본", 29, 88, 90, 15.0, 3, "보스턴 레드삭스",    2023));
        list.add(new Player("오카모토 카즈마",   Position.B1, "일본", 27, 87, 90, 12.0, 3, "요미우리 자이언츠",  2023));
        list.add(new Player("겐다 소스케",       Position.SS, "일본", 27, 82, 86, 8.0,  2, "사이타마 세이부",    2022));
        list.add(new Player("마키 슌사이",       Position.OF, "일본", 28, 84, 87, 10.0, 2, "요코하마 DeNA",      2022));

        // ── 해외 MLB ──
        list.add(new Player("쇼헤이 오타니",    Position.SP, "해외", 28, 99, 99, 46.0, 3, "로스앤젤레스 다저스",2023));
        list.add(new Player("로날드 아쿠냐 Jr", Position.OF, "해외", 24, 97, 98, 40.0, 4, "애틀란타 브레이브스",2023));
        list.add(new Player("애런 저지",        Position.OF, "해외", 31, 96, 96, 40.0, 4, "뉴욕 양키스",        2022));
        list.add(new Player("이치로 스즈키",    Position.OF, "해외", 31, 96, 97, 18.0, 3, "시애틀 매리너스",    2004));
        list.add(new Player("무키 베츠",        Position.OF, "해외", 30, 94, 94, 30.0, 4, "로스앤젤레스 다저스",2023));
        list.add(new Player("후안 소토",        Position.OF, "해외", 24, 95, 97, 32.0, 4, "샌디에이고 파드리스",2023));
        list.add(new Player("요르단 알바레즈",  Position.OF, "해외", 26, 94, 95, 28.0, 3, "휴스턴 애스트로스",  2022));
        list.add(new Player("존 람",            Position.SP, "해외", 27, 94, 94, 24.0, 3, "샌디에이고 파드리스",2022));
        list.add(new Player("프레디 프리먼",    Position.B1, "해외", 33, 92, 92, 27.0, 3, "로스앤젤레스 다저스",2023));
        list.add(new Player("놀란 아레나도",    Position.B3, "해외", 32, 91, 91, 35.0, 2, "세인트루이스 카디널스",2022));
        list.add(new Player("게릿 콜",          Position.SP, "해외", 32, 92, 92, 36.0, 3, "뉴욕 양키스",        2022));
        list.add(new Player("카를로스 코레아",  Position.SS, "해외", 28, 90, 90, 35.0, 6, "미네소타 트윈스",    2022));
        list.add(new Player("타티스 주니어",    Position.SS, "해외", 24, 92, 95, 34.0, 4, "샌디에이고 파드리스",2021));
        list.add(new Player("알렉스 브레그만",  Position.B3, "해외", 29, 89, 90, 24.0, 3, "휴스턴 애스트로스",  2022));
        list.add(new Player("호세 알투베",      Position.B2, "해외", 33, 88, 88, 29.0, 3, "휴스턴 애스트로스",  2022));
        list.add(new Player("마이크 트라웃",    Position.OF, "해외", 29, 96, 96, 37.0, 3, "로스앤젤레스 에인절스",2020));
        list.add(new Player("랜디 존슨",        Position.SP, "해외", 35, 98, 98, 15.0, 2, "애리조나 다이아몬드백스",1999));
        list.add(new Player("페드로 마르티네스",Position.SP, "해외", 31, 97, 97, 17.5, 3, "보스턴 레드삭스",    2003));
        list.add(new Player("김하성",           Position.SS, "해외", 28, 84, 88, 14.0, 3, "샌디에이고 파드리스",2023));
        list.add(new Player("류현진",           Position.SP, "해외", 36, 76, 76, 17.0, 2, "토론토 블루제이스",  2023));

        // ── 국가대표 ──
        list.add(new Player("류현진 (대표)",  Position.SP, "국가대표", 29, 92, 92, 0.0, 1, "대한민국 국가대표", 2013));
        list.add(new Player("양현종 (대표)",  Position.SP, "국가대표", 28, 88, 90, 0.0, 1, "대한민국 국가대표", 2015));
        list.add(new Player("이정후 (대표)",  Position.OF, "국가대표", 24, 90, 95, 0.0, 1, "대한민국 국가대표", 2023));
        list.add(new Player("김도영 (대표)",  Position.B3, "국가대표", 22, 93, 99, 0.0, 1, "대한민국 국가대표", 2024));
        list.add(new Player("오타니 (대표)",  Position.SP, "국가대표", 28, 99, 99, 0.0, 1, "일본 국가대표",     2023));
        list.add(new Player("야마모토 (대표)",Position.SP, "국가대표", 25, 95, 99, 0.0, 1, "일본 국가대표",     2023));
        list.add(new Player("저지 (대표)",    Position.OF, "국가대표", 30, 95, 95, 0.0, 1, "미국 국가대표",     2023));
        list.add(new Player("소토 (대표)",    Position.OF, "국가대표", 24, 94, 97, 0.0, 1, "도미니카 국가대표", 2023));
        list.add(new Player("아쿠냐 (대표)",  Position.OF, "국가대표", 24, 96, 98, 0.0, 1, "도미니카 국가대표", 2023));

        return list;
    }

    public static List<String> getKboTeams() {
        return List.of(
            "KIA타이거즈", "삼성라이온즈", "LG트윈스", "두산베어스",
            "KT위즈", "SSG랜더스", "롯데자이언츠", "한화이글스",
            "NC다이노스", "키움히어로즈"
        );
    }

    public static List<String> getNpbTeams() {
        return List.of(
            "요미우리 자이언츠", "한신 타이거즈", "요코하마 DeNA",
            "히로시마 도요 카프", "야쿠르트 스왈로즈", "주니치 드래곤즈",
            "후쿠오카 소프트뱅크", "오릭스 버팔로즈", "치바 롯데 마린스",
            "도호쿠 라쿠텐", "사이타마 세이부", "홋카이도 닛폰햄"
        );
    }

    public static List<String> getMlbTeams() {
        return List.of(
            "뉴욕 양키스", "로스앤젤레스 다저스", "보스턴 레드삭스",
            "시카고 컵스", "샌프란시스코 자이언츠", "애틀란타 브레이브스",
            "휴스턴 애스트로스", "샌디에이고 파드리스", "토론토 블루제이스",
            "뉴욕 메츠"
        );
    }
}
