"""KBO·NPB·MLB 전 선수 DB 생성기.

공개 데이터(frankmkpark/mnk_datasets: KBO 공식 기록, NPB/npbstats, MLB Lahman)를 받아
실제 시즌 기록에서 능력치(OVR)를 계산해 src/players.js 를 만듭니다.

  python3 tools/build_players.py            # 원본을 받아서(캐시 사용) 생성
  python3 tools/build_players.py --report   # 상위 선수·분포 확인 출력

능력치 계산
- 타자: 시즌 OPS+ = 100 * (OBP/리그OBP + SLG/리그SLG - 1). 200타석 이상 시즌 중 상위 3시즌 평균(전성기)과
  통산 OPS+ 를 7:3 으로 섞고, 통산 타석이 적으면 평균 쪽으로 당깁니다.  OVR = 68 + (값-100)*0.30
- 투수: 시즌 ERA+ = 100 * 리그ERA / ERA. 규정 시즌 상위 3시즌 평균과 통산 ERA+ 를 7:3, 이닝이 적으면 보정.
  불펜은 ERA+ 를 100 기준으로 40% 할인, 선발은 통산 이닝 보너스(최대 +8).  OVR = 68 + (값-100)*0.25
- 리그 수준 보정: MLB 0, NPB -3, KBO -6 (리그끼리 맞붙을 때 차이가 나도록)
"""
import csv
import io
import json
import math
import os
import sys
import urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recent
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get("BASEBALL_DATA_CACHE", os.path.join(os.path.expanduser("~"), ".cache", "baseball9-data"))
BASE = "https://media.githubusercontent.com/media/frankmkpark/mnk_datasets/main/"
FILES = {
    "kbo_people": "Source_Files/KBO/data/kbo_people.csv",
    "kbo_bat": "Source_Files/KBO/data/kbo_batting.csv",
    "kbo_pit": "Source_Files/KBO/data/kbo_pitching.csv",
    "kbo_fld": "Source_Files/KBO/data/kbo_fielding.csv",
    "npb_people": "KBO+NPB/npb_people.csv",
    "npb_bat": "KBO+NPB/npb_batting.csv",
    "npb_pit": "KBO+NPB/npb_pitching.csv",
    "mlb_people": "Source_Files/MLB/data/mlb_people.csv",
    "mlb_bat": "Source_Files/MLB/data/mlb_batting.csv",
    "mlb_pit": "Source_Files/MLB/data/mlb_pitching.csv",
    "mlb_fld": "Source_Files/MLB/data/mlb_fielding.csv",
}

# KBO 구단 코드 → 현재 10개 구단 (전신 포함). 해체 구단은 None
KBO_FRANCHISE = {
    "Haitai": "KIA타이거즈", "KIA": "KIA타이거즈", "Samsung": "삼성라이온즈", "MBC": "LG트윈스", "LG": "LG트윈스",
    "OB": "두산베어스", "Doosan": "두산베어스", "KT": "KT위즈", "SK": "SSG랜더스", "SSG": "SSG랜더스",
    "Lotte": "롯데자이언츠", "Binggrae": "한화이글스", "Hanwha": "한화이글스", "NC": "NC다이노스",
    "Woori": "키움히어로즈", "Nexen": "키움히어로즈", "Kiwoom": "키움히어로즈",
    "Sammi": None, "Chungbo": None, "Pacific": None, "Hyundai": None, "SBW": None,
}
KBO_TEAM_KOR = {"Sammi": "삼미", "Chungbo": "청보", "Pacific": "태평양", "Hyundai": "현대", "SBW": "쌍방울"}

# NPB: 옛 구단 코드 → 현재 12개 구단 (계보)
NPB_FRANCHISE = {
    "YOMIURI": "YOMIURI", "KYOJIN": "YOMIURI", "HANSHIN": "HANSHIN", "OSAKA": "HANSHIN",
    "CHUNICHI": "CHUNICHI", "NAGOYA": "CHUNICHI", "CHUBU NIPPON": "CHUNICHI",
    "DENA": "DENA", "YOKOHAMA": "DENA", "TAIYO": "DENA", "HIROSHIMA": "HIROSHIMA",
    "YAKULT": "YAKULT", "KOKUTETSU": "YAKULT", "SANKEI": "YAKULT", "ATOMS": "YAKULT",
    "SOFTBANK": "SOFTBANK", "DAIEI": "SOFTBANK", "NANKAI": "SOFTBANK",
    "NIPPON-HAM": "NIPPON-HAM", "TOEI": "NIPPON-HAM", "TOKYU": "NIPPON-HAM", "NITTAKU": "NIPPON-HAM", "KYUEI": "NIPPON-HAM",
    "LOTTE": "LOTTE", "ORIONS": "LOTTE", "DAIMAI": "LOTTE", "MAINICHI": "LOTTE",
    "ORIX": "ORIX", "HANKYU": "ORIX", "KINTETSU": "ORIX",
    "SEIBU": "SEIBU", "NISHITETSU": "SEIBU", "TAIHEIYO CLUB": "SEIBU", "CROWN LIGHTER": "SEIBU",
    "RAKUTEN": "RAKUTEN",
}
NPB_NAME = {
    "YOMIURI": "요미우리 자이언츠", "HANSHIN": "한신 타이거스", "CHUNICHI": "주니치 드래곤스", "DENA": "요코하마 DeNA 베이스타스",
    "HIROSHIMA": "히로시마 도요 카프", "YAKULT": "도쿄 야쿠르트 스왈로스", "SOFTBANK": "후쿠오카 소프트뱅크 호크스",
    "NIPPON-HAM": "홋카이도 닛폰햄 파이터스", "LOTTE": "지바 롯데 마린스", "ORIX": "오릭스 버펄로스",
    "RAKUTEN": "도호쿠 라쿠텐 골든이글스", "SEIBU": "사이타마 세이부 라이온스",
}
NPB_GROUP = {k: ("센트럴" if k in ("YOMIURI", "HANSHIN", "CHUNICHI", "DENA", "HIROSHIMA", "YAKULT") else "퍼시픽") for k in NPB_NAME}

# MLB: 옛 구단 코드 → 현재 30개 구단
MLB_NAME = {
    "ARI": "애리조나 다이아몬드백스", "ATL": "애틀랜타 브레이브스", "BAL": "볼티모어 오리올스", "BOS": "보스턴 레드삭스",
    "CHA": "시카고 화이트삭스", "CHN": "시카고 컵스", "CIN": "신시내티 레즈", "CLE": "클리블랜드 가디언스",
    "COL": "콜로라도 로키스", "DET": "디트로이트 타이거스", "HOU": "휴스턴 애스트로스", "KCA": "캔자스시티 로열스",
    "LAA": "LA 에인절스", "LAN": "LA 다저스", "MIA": "마이애미 말린스", "MIL": "밀워키 브루어스",
    "MIN": "미네소타 트윈스", "NYA": "뉴욕 양키스", "NYN": "뉴욕 메츠", "OAK": "오클랜드 애슬레틱스",
    "PHI": "필라델피아 필리스", "PIT": "피츠버그 파이리츠", "SDN": "샌디에이고 파드리스", "SEA": "시애틀 매리너스",
    "SFN": "샌프란시스코 자이언츠", "SLN": "세인트루이스 카디널스", "TBA": "탬파베이 레이스", "TEX": "텍사스 레인저스",
    "TOR": "토론토 블루제이스", "WAS": "워싱턴 내셔널스",
}
MLB_FRANCHISE = dict({k: k for k in MLB_NAME}, **{
    "WS1": "MIN", "NY1": "SFN", "BRO": "LAN", "PHA": "OAK", "KC1": "OAK", "BSN": "ATL", "ML1": "ATL",
    "SLA": "BAL", "MON": "WAS", "CAL": "LAA", "ANA": "LAA", "ML4": "MIL", "SE1": "MIL", "FLO": "MIA", "WS2": "TEX",
})
MLB_GROUP = {k: ("아메리칸" if k in ("BAL", "BOS", "NYA", "TBA", "TOR", "CHA", "CLE", "DET", "KCA", "MIN",
                                     "HOU", "LAA", "OAK", "SEA", "TEX") else "내셔널") for k in MLB_NAME}
KBO_GROUP = {n: ("드림" if n in ("삼성라이온즈", "롯데자이언츠", "두산베어스", "SSG랜더스", "KT위즈") else "나눔")
             for n in ["KIA타이거즈", "삼성라이온즈", "LG트윈스", "두산베어스", "KT위즈", "SSG랜더스",
                       "롯데자이언츠", "한화이글스", "NC다이노스", "키움히어로즈"]}

# 국적/출생국 표기 → 국가 코드
COUNTRY = {
    "korea": "KOR", "south korea": "KOR", "japan": "JPN", "usa": "USA", "united states": "USA",
    "dominica republic": "DOM", "dominican republic": "DOM", "d.r.": "DOM", "venezuela": "VEN", "cuba": "CUB",
    "puerto rico": "PUR", "p.r.": "PUR", "mexico": "MEX", "taiwan": "TPE", "canada": "CAN", "can": "CAN",
    "panama": "PAN", "netherlands": "NED", "curacao": "NED", "aruba": "NED", "australia": "AUS",
    "colombia": "COL", "nicaragua": "NCA", "china": "CHN", "brazil": "BRA",
}
COUNTRY_NAME = {"KOR": "대한민국", "JPN": "일본", "USA": "미국", "DOM": "도미니카공화국", "VEN": "베네수엘라",
                "PUR": "푸에르토리코", "CUB": "쿠바", "MEX": "멕시코", "TPE": "대만", "CAN": "캐나다", "PAN": "파나마",
                "NED": "네덜란드", "AUS": "호주", "COL": "콜롬비아", "NCA": "니카라과", "CHN": "중국", "BRA": "브라질"}
LEAGUE_LAST = {"KBO": 2026, "NPB": 2026, "MLB": 2026}
# 리그 수준 보정: 능력치는 각 리그 평균 대비로 계산되므로, 리그끼리 맞붙을 때(월드 리그·국가대표·영입)를 위해
# MLB 기준으로 NPB 와 KBO 를 낮춤. 리그 안의 순위는 바뀌지 않음.
LEAGUE_OFFSET = {"MLB": 0, "NPB": -3, "KBO": -6}


def country_of(v):
    return COUNTRY.get(str(v or "").strip().lower(), "")


def load(key):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, key + ".csv")
    if not os.path.exists(path):
        url = BASE + FILES[key].replace("+", "%2B")
        print("download", url, file=sys.stderr)
        with urllib.request.urlopen(url, timeout=120) as r, open(path, "wb") as f:
            f.write(r.read())
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    return rows if "--no-recent" in sys.argv else recent.patch(key, rows)


def num(v):
    if v is None:
        return 0.0
    v = str(v).strip()
    if v in ("", "-", "nan", "NaN", "None"):
        return 0.0
    try:
        return float(v)
    except ValueError:
        return 0.0


def kbo_ip(v):
    """'133 1/3' → 133.333"""
    v = (v or "").strip()
    if not v or v in ("-", "nan"):
        return 0.0
    parts = v.split()
    total = num(parts[0]) if "/" not in parts[0] else 0.0
    for p in parts:
        if "/" in p:
            a, b = p.split("/")
            total += num(a) / max(1.0, num(b))
    return total


def year_of(v):
    try:
        return int(float(str(v)[:4]))
    except ValueError:
        return 0


# ── 시즌 기록 정규화: (player, year) → 합계 ─────────────────────
def agg_batting(rows, pid_key, year_key, fmap):
    seasons = defaultdict(lambda: defaultdict(float))
    teams = {}
    for r in rows:
        pid, y = r[pid_key], year_of(r[year_key])
        if not pid or not y:
            continue
        s = seasons[(pid, y)]
        for k, src in fmap.items():
            s[k] += num(r.get(src))
        team = r.get("Team") or r.get("teamID")
        if team:
            teams[(pid, y)] = team
    return seasons, teams


def season_bat_derived(s):
    ab, h, bb, hbp, sf = s["AB"], s["H"], s["BB"], s.get("HBP", 0), s.get("SF", 0)
    tb = s["H"] + s["2B"] + 2 * s["3B"] + 3 * s["HR"]
    pa = s["PA"] if s.get("PA") else ab + bb + hbp + sf + s.get("SH", 0)
    obp_den = ab + bb + hbp + sf
    return pa, ((h + bb + hbp) / obp_den if obp_den else 0.0), (tb / ab if ab else 0.0)


def league_bat_avgs(seasons):
    tot = defaultdict(lambda: defaultdict(float))
    for (pid, y), s in seasons.items():
        t = tot[y]
        for k in ("AB", "H", "2B", "3B", "HR", "BB", "HBP", "SF"):
            t[k] += s.get(k, 0)
    out = {}
    for y, t in tot.items():
        _, obp, slg = season_bat_derived(dict(t, PA=0, SH=0))
        out[y] = (obp, slg)
    return out


def rate_batters(seasons, lg):
    per = defaultdict(list)       # pid -> [(year, pa, ops_plus)]
    for (pid, y), s in seasons.items():
        pa, obp, slg = season_bat_derived(s)
        if pa <= 0 or y not in lg or not lg[y][0] or not lg[y][1]:
            continue
        ops_plus = 100 * (obp / lg[y][0] + slg / lg[y][1] - 1)
        per[pid].append((y, pa, ops_plus))
    out = {}
    for pid, ss in per.items():
        total = sum(p for _, p, _ in ss)
        career = sum(p * o for _, p, o in ss) / total if total else 0
        qual = sorted([s for s in ss if s[1] >= 200], key=lambda s: -s[2])[:3]
        if qual:
            peak = sum(s[2] for s in qual) / len(qual)
            est = 0.7 * peak + 0.3 * career
            est = 80 + (est - 80) * math.sqrt(min(1.0, total / 1500))
            peak_year = qual[0][0]
        else:
            est = 70 + (career - 70) * total / (total + 400)
            peak_year = max(ss, key=lambda s: s[1])[0]
        ovr = round(68 + (est - 100) * 0.30)
        out[pid] = {"ovr": max(40, min(99, ovr)), "pa": total, "peak": peak_year,
                    "first": min(s[0] for s in ss), "last": max(s[0] for s in ss)}
    return out


def rate_pitchers(seasons, starters):
    """seasons: (pid,y) -> {IP, ER, G, GS}"""
    lg = defaultdict(lambda: [0.0, 0.0])
    for (pid, y), s in seasons.items():
        lg[y][0] += s["ER"]
        lg[y][1] += s["IP"]
    lg_era = {y: (9 * er / ip if ip else 0) for y, (er, ip) in lg.items()}
    per = defaultdict(list)
    for (pid, y), s in seasons.items():
        if s["IP"] <= 0 or not lg_era.get(y):
            continue
        era = 9 * s["ER"] / s["IP"]
        era_plus = min(300.0, 100 * lg_era[y] / max(era, 0.5))
        per[pid].append((y, s["IP"], era_plus, s["ER"], lg_era[y]))
    out = {}
    for pid, ss in per.items():
        ip = sum(s[1] for s in ss)
        er = sum(s[3] for s in ss)
        career = min(300.0, 100 * sum(s[1] * s[4] for s in ss) / max(9 * er, 1.0))
        sp = bool(starters.get(pid))
        need = 120 if sp else 50
        qual = sorted([s for s in ss if s[1] >= need], key=lambda s: -s[2])[:3]
        if qual:
            peak = sum(s[2] for s in qual) / len(qual)
            est = 0.7 * peak + 0.3 * career
            est = 85 + (est - 85) * math.sqrt(min(1.0, ip / 600))
            peak_year = qual[0][0]
        else:
            est = 75 + (career - 75) * ip / (ip + 80)
            peak_year = max(ss, key=lambda s: s[1])[0]
        if not sp:
            est = 100 + (est - 100) * 0.6     # 불펜은 짧은 이닝이라 ERA+ 가 부풀려짐 → 가치 할인
        else:
            est += min(8.0, ip / 500)         # 선발 이닝 소화(내구성) 보너스, 최대 +8
        ovr = round(68 + (est - 100) * 0.25)
        out[pid] = {"ovr": max(40, min(99, ovr)), "ip": ip, "peak": peak_year,
                    "first": min(s[0] for s in ss), "last": max(s[0] for s in ss)}
    return out


def _zstats(ms, keys):
    out = {}
    for k in keys:
        vals = [m[k] for m in ms]
        mu = sum(vals) / len(vals)
        sd = math.sqrt(sum((x - mu) ** 2 for x in vals) / len(vals)) or 1e-9
        out[k] = (mu, sd)
    return out


def _components(rows, keys, flip, min_n=25):
    """rows: [(pid, year, weight, {key: value})] → pid -> [rating per key]
    리그-시즌 분포(표본이 적으면 리그 전체 분포) 대비 z점수의 전성기 3시즌 + 통산 가중 평균 → 50 + 20z"""
    by = defaultdict(list)
    for pid, y, w, m in rows:
        by[y].append(m)
    pooled = _zstats([m for v in by.values() for m in v], keys) if rows else {}
    st = {y: (_zstats(v, keys) if len(v) >= min_n else pooled) for y, v in by.items()}
    per = defaultdict(list)
    for pid, y, w, m in rows:
        per[pid].append((w, {k: (m[k] - st[y][k][0]) / st[y][k][1] for k in keys}))
    out = {}
    for pid, ss in per.items():
        total = sum(w for w, _ in ss)
        res = []
        for k in keys:
            zs = sorted((z[k] for _, z in ss), reverse=True)[:3]
            peak = sum(zs) / len(zs)
            career = sum(w * z[k] for w, z in ss) / total
            z = (0.6 * peak + 0.4 * career) * min(1.0, math.sqrt(total / 1200))
            if k in flip:
                z = -z
            res.append(max(20, min(99, round(50 + 20 * z))))
        out[pid] = res
    return out


def bat_components(seasons):
    """타자 세부 능력치 [컨택, 파워, 선구, 주루] — 타율 / 순장타율(ISO) / 볼넷률 / (도루-2*도루실패+3루타)율"""
    rows = []
    for (pid, y), s in seasons.items():
        pa, _, _ = season_bat_derived(s)
        ab = s["AB"]
        if pa < 150 or not ab:
            continue
        h = s["H"]
        tb = h + s["2B"] + 2 * s["3B"] + 3 * s["HR"]
        rows.append((pid, y, pa, {"con": h / ab, "pow": (tb - h) / ab, "eye": s["BB"] / pa,
                                  "spd": (s.get("SB", 0) - 2 * s.get("CS", 0) + s["3B"]) / pa}))
    return _components(rows, ("con", "pow", "eye", "spd"), flip=())


def pit_components(seasons):
    """투수 세부 능력치 [탈삼진, 제구] — 삼진률(높을수록 좋음) / 볼넷률(낮을수록 좋음)"""
    rows = []
    for (pid, y), s in seasons.items():
        if s["IP"] < 40 or s["BF"] <= 0:
            continue
        rows.append((pid, y, s["IP"], {"k": s["SO"] / s["BF"], "ctl": s["BB"] / s["BF"]}))
    return _components(rows, ("k", "ctl"), flip=("ctl",))


def main_pos(counter, fallback):
    if not counter:
        return fallback
    pos = max(counter.items(), key=lambda kv: kv[1])[0]
    return pos


def norm_pos(p):
    p = (p or "").upper()
    if p in ("LF", "CF", "RF", "OF"):
        return "OF"
    if p in ("C", "1B", "2B", "3B", "SS", "DH"):
        return p
    return None


# ── 리그별 처리 ────────────────────────────────────────────────
def build_kbo():
    people = {r["PlayerID"]: r for r in load("kbo_people")}
    bat_rows = load("kbo_bat")
    bat, bat_team = agg_batting(bat_rows, "PlayerID", "Year",
                                {"PA": "PA", "AB": "AB", "H": "H", "2B": "2B", "3B": "3B", "HR": "HR", "BB": "BB", "G": "G",
                                 "SB": "SB", "CS": "CS", "SO": "SO"})
    lg = league_bat_avgs(bat)
    bat_r = rate_batters(bat, lg)
    bat_c = bat_components(bat)

    pit = defaultdict(lambda: defaultdict(float))
    pit_team = {}
    for r in load("kbo_pit"):
        pid, y = r["PlayerID"], year_of(r["Year"])
        if not pid or not y:
            continue
        s = pit[(pid, y)]
        s["IP"] += kbo_ip(r.get("IP"))
        s["ER"] += num(r.get("ER"))
        s["G"] += num(r.get("G"))
        s["SO"] += num(r.get("SO"))
        s["BB"] += num(r.get("BB"))
        s["BF"] += num(r.get("TBF"))
        pit_team[(pid, y)] = r.get("Team")
    ipg = defaultdict(lambda: [0.0, 0.0])
    for (pid, y), s in pit.items():
        ipg[pid][0] += s["IP"]
        ipg[pid][1] += s["G"]
    starters = {pid: (ip / g >= 3.5 if g else False) for pid, (ip, g) in ipg.items()}
    pit_r = rate_pitchers(pit, starters)
    pit_c = pit_components(pit)

    fld = defaultdict(lambda: defaultdict(float))
    for r in load("kbo_fld"):
        p = norm_pos(r.get("POS"))
        if p:
            fld[r["playerId"]][p] += num(r.get("G"))

    return assemble("K", "KBO", people, bat_r, pit_r, starters, fld, bat_team, pit_team,
                    name=lambda p: (p.get("Name") or "").strip(),
                    birth=lambda p: int(num(p.get("BirthYear"))) or None,
                    fallback_pos=lambda p: {"Catcher": "C", "Outfielder": "OF", "Infielder": "3B"}.get(p.get("Position"), "DH"),
                    team_name=lambda code: KBO_FRANCHISE.get(code) or KBO_TEAM_KOR.get(code) or code,
                    franchise=lambda code: KBO_FRANCHISE.get(code),
                    roman=lambda p: (p.get("LastNameEng") or "", p.get("FirstNameEng") or ""),
                    country=lambda p: country_of(p.get("Nationality")), bat_c=bat_c, pit_c=pit_c)


def build_npb():
    people = {r["playerID"]: r for r in load("npb_people")}
    rows = load("npb_bat")
    bat, bat_team = agg_batting(rows, "playerID", "yearID",
                                {"PA": "PA", "AB": "AB", "H": "H", "2B": "2B", "3B": "3B", "HR": "HR", "BB": "BB",
                                 "HBP": "HBP", "SF": "SF", "SH": "SH", "G": "G", "SB": "SB", "CS": "CS", "SO": "SO"})
    lg = league_bat_avgs(bat)
    bat_r = rate_batters(bat, lg)
    bat_c = bat_components(bat)
    fld = defaultdict(lambda: defaultdict(float))
    for r in rows:
        p = norm_pos(r.get("POS"))
        if p:
            fld[r["playerID"]][p] += num(r.get("G"))
    pit = defaultdict(lambda: defaultdict(float))
    pit_team = {}
    for r in load("npb_pit"):
        pid, y = r["playerID"], year_of(r["yearID"])
        s = pit[(pid, y)]
        s["IP"] += num(r.get("IPouts")) / 3
        s["ER"] += num(r.get("ER"))
        s["G"] += num(r.get("G"))
        s["GS"] += num(r.get("GS"))
        s["SO"] += num(r.get("SO"))
        s["BB"] += num(r.get("BB"))
        s["BF"] += num(r.get("BFP"))
        pit_team[(pid, y)] = r.get("teamID")
    gs = defaultdict(lambda: [0.0, 0.0])
    for (pid, y), s in pit.items():
        gs[pid][0] += s["GS"]
        gs[pid][1] += s["G"]
    starters = {pid: (a / b >= 0.5 if b else False) for pid, (a, b) in gs.items()}
    pit_r = rate_pitchers(pit, starters)
    pit_c = pit_components(pit)
    return assemble("N", "NPB", people, bat_r, pit_r, starters, fld, bat_team, pit_team,
                    name=lambda p: (p.get("nameGiven") or f"{p.get('nameFirst', '')} {p.get('nameLast', '')}").strip(),
                    birth=lambda p: int(num(p.get("birthYear"))) or None,
                    fallback_pos=lambda p: "DH",
                    team_name=lambda code: NPB_NAME.get(NPB_FRANCHISE.get(code, ""), code),
                    franchise=lambda code: NPB_NAME.get(NPB_FRANCHISE.get(code, "")),
                    roman=lambda p: (p.get("nameLast") or "", p.get("nameFirst") or ""),
                    country=lambda p: country_of(p.get("birthPlace")), bat_c=bat_c, pit_c=pit_c)


def build_mlb():
    people = {r["playerID"]: r for r in load("mlb_people")}
    bat, bat_team = agg_batting(load("mlb_bat"), "playerID", "yearID",
                                {"AB": "AB", "H": "H", "2B": "2B", "3B": "3B", "HR": "HR", "BB": "BB",
                                 "HBP": "HBP", "SF": "SF", "SH": "SH", "G": "G", "SB": "SB", "CS": "CS", "SO": "SO"})
    lg = league_bat_avgs(bat)
    bat_r = rate_batters(bat, lg)
    bat_c = bat_components(bat)
    pit = defaultdict(lambda: defaultdict(float))
    pit_team = {}
    for r in load("mlb_pit"):
        pid, y = r["playerID"], year_of(r["yearID"])
        s = pit[(pid, y)]
        s["IP"] += num(r.get("IPouts")) / 3
        s["ER"] += num(r.get("ER"))
        s["G"] += num(r.get("G"))
        s["GS"] += num(r.get("GS"))
        s["SO"] += num(r.get("SO"))
        s["BB"] += num(r.get("BB"))
        s["BF"] += num(r.get("BFP"))
        pit_team[(pid, y)] = r.get("teamID")
    gs = defaultdict(lambda: [0.0, 0.0])
    for (pid, y), s in pit.items():
        gs[pid][0] += s["GS"]
        gs[pid][1] += s["G"]
    starters = {pid: (a / b >= 0.5 if b else False) for pid, (a, b) in gs.items()}
    pit_r = rate_pitchers(pit, starters)
    pit_c = pit_components(pit)
    fld = defaultdict(lambda: defaultdict(float))
    for r in load("mlb_fld"):
        p = norm_pos(r.get("POS"))
        if p:
            fld[r["playerID"]][p] += num(r.get("G"))
    return assemble("M", "MLB", people, bat_r, pit_r, starters, fld, bat_team, pit_team,
                    name=lambda p: f"{p.get('nameFirst', '')} {p.get('nameLast', '')}".strip(),
                    birth=lambda p: int(num(p.get("birthYear"))) or None,
                    fallback_pos=lambda p: "DH",
                    team_name=lambda code: MLB_NAME.get(MLB_FRANCHISE.get(code, ""), code),
                    franchise=lambda code: MLB_NAME.get(MLB_FRANCHISE.get(code, "")),
                    roman=lambda p: (p.get("nameLast") or "", p.get("nameFirst") or ""),
                    country=lambda p: country_of(p.get("birthCountry")), bat_c=bat_c, pit_c=pit_c)


def assemble(prefix, league, people, bat_r, pit_r, starters, fld, bat_team, pit_team, name, birth, fallback_pos, team_name,
             franchise=lambda code: code, roman=lambda p: ("", ""), country=lambda p: "", bat_c=None, pit_c=None):
    bat_c, pit_c = bat_c or {}, pit_c or {}
    out = []
    for pid in set(bat_r) | set(pit_r):
        p = people.get(pid, {})
        nm = name(p) if p else ""
        if not nm:
            continue
        b, q = bat_r.get(pid), pit_r.get(pid)
        is_pitcher = q is not None and (b is None or q["ip"] * 3 > b["pa"])
        if is_pitcher:
            pos = "SP" if starters.get(pid) else "RP"
            r = q
            teams = [(y, t) for (i, y), t in pit_team.items() if i == pid]
        else:
            pos = main_pos(fld.get(pid), fallback_pos(p))
            if pos == "P":
                pos = "DH"
            r = b
            teams = [(y, t) for (i, y), t in bat_team.items() if i == pid]
        teams.sort()
        last_team = team_name(teams[-1][1]) if teams else ""
        # 최다 소속 구단(레전드 리그 배정용): 현재 구단 계보 기준
        cnt = defaultdict(int)
        for _, t in teams:
            f = franchise(t)
            if f:
                cnt[f] += 1
        most = max(cnt.items(), key=lambda kv: kv[1])[0] if cnt else ""
        by = birth(p) if p else None
        ovr = r["ovr"]
        pot = ovr
        if r["last"] >= 2025 and by and r["last"] - by <= 25:      # 젊은 현역: 성장 여지
            pot = min(97, ovr + 2 * (26 - (r["last"] - by)))
        rl, rf = roman(p) if p else ("", "")
        sub = (pit_c.get(pid) if is_pitcher else bat_c.get(pid)) or []
        out.append([prefix + pid, nm, pos, league, by or 0, ovr, pot, last_team, most, r["first"], r["last"], r["peak"],
                    country(p) if p else "", rl, rf, sub])
    return out


def dedupe_names(rows):
    """같은 리그 안 동명이인은 출생연도로 구분: 이승엽(76)"""
    seen = defaultdict(list)
    for r in rows:
        seen[(r[3], r[1])].append(r)
    for (_, nm), rs in seen.items():
        if len(rs) > 1:
            for r in rs:
                r[1] = f"{nm}({str(r[4])[-2:]})" if r[4] else f"{nm}({r[9]})"
    return rows


def norm_roman(s):
    """로마자 표기 흔들림 정규화: Hyeon-Jin / Hyun Jin / Shin-Soo / Sin-Su 를 비슷하게"""
    s = "".join(ch for ch in (s or "").lower() if ch.isalpha())
    for a, b in (("eo", "u"), ("oo", "u"), ("ou", "u"), ("oh", "o"), ("sh", "s"), ("ch", "c"), ("ae", "e"), ("wo", "u"), ("yu", "u")):
        s = s.replace(a, b)
    return s


def similar(a, b):
    """간단한 편집 거리 기반 유사도 (0~1)"""
    if not a or not b:
        return 0.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return 1 - prev[-1] / max(len(a), len(b))


def link_persons(rows):
    """리그가 다른 같은 사람(류현진 KBO ↔ Hyun Jin Ryu MLB)을 묶어 person 키와 국적을 맞춤.
    조건: 성 철자(정규화) 같음 + 출생연도 같음 + 이름 철자 유사도 0.6 이상."""
    groups = defaultdict(list)
    for r in rows:
        last, first = norm_roman(r[13]), norm_roman(r[14])
        if last and r[4]:
            groups[(last, r[4])].append(r)
    person = {r[0]: r[0] for r in rows}
    linked = 0
    rank = {"KBO": 0, "NPB": 1, "MLB": 2}
    taken = set()                          # (사람 키, 리그): 한 사람에게 리그당 한 명만
    for r in rows:
        taken.add((r[0], r[3]))
    for g in groups.values():
        if len({r[3] for r in g}) < 2:
            continue
        # NPB → MLB 순으로, 앞선 리그(KBO, NPB)에서 이름이 "가장" 비슷한 한 명과 묶음
        for b in sorted(g, key=lambda r: rank[r[3]]):
            cands = [(similar(norm_roman(a[14]), norm_roman(b[14])), a) for a in g
                     if rank[a[3]] < rank[b[3]] and (person[a[0]], b[3]) not in taken]
            if not cands:
                continue
            sim, a = max(cands, key=lambda c: c[0])
            if sim >= 0.6:
                person[b[0]] = person[a[0]]
                taken.add((person[a[0]], b[3]))
                linked += 1
    # 국적: 묶인 사람은 KBO 국적 > NPB > MLB 출생국 순으로 통일 (예: 이정후는 일본 출생이지만 KBO 국적은 한국)
    order = {"KBO": 0, "NPB": 1, "MLB": 2}
    best = {}
    for r in sorted(rows, key=lambda r: order[r[3]]):
        k = person[r[0]]
        if r[12] and k not in best:
            best[k] = r[12]
    members = defaultdict(int)
    for k in person.values():
        members[k] += 1
    for r in rows:
        k = person[r[0]]
        r[12] = best.get(k, r[12])
        # 일제강점기(1945년 이전) 한국·대만 출생 NPB 선수는 당시 일본 국적 (예: 후지모토 히데오)
        if r[3] == "NPB" and r[12] in ("KOR", "TPE") and r[4] and r[4] < 1945 and k == r[0]:
            r[12] = "JPN"
        r[13] = k if members[k] > 1 else 0      # 혼자인 선수는 키 생략(파일 크기 절약)
        del r[14]
    return linked


def main():
    rows = build_kbo() + build_npb() + build_mlb()
    for r in rows:
        off = LEAGUE_OFFSET[r[3]]
        r[5] = max(40, r[5] + off)
        r[6] = max(r[5], r[6] + off)
    linked = link_persons(rows)
    print(f"linked {linked} cross-league duplicates", file=sys.stderr)
    rows = dedupe_names(rows)
    rows.sort(key=lambda r: (r[3], -r[5], r[1]))
    header = ("// 선수 DB — tools/build_players.py 로 생성 (직접 수정하지 마세요)\n"
              "// 출처: KBO 공식 기록, NPB 공식/npbstats, MLB Lahman Database (frankmkpark/mnk_datasets 정리본)\n"
              "// [id, 이름, 포지션, 리그, 출생연도, OVR, 잠재력, 마지막 소속, 최다 소속 구단(계보), 첫 시즌, 마지막 시즌, 전성기 시즌, 국가, 동일인 키, 세부능력: 타자[컨택,파워,선구,주루] / 투수[탈삼진,제구]]\n")
    body = "const PLAYERS = [\n" + ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows) + "\n];\n"
    leagues = {
        "KBO": {"name": "KBO 리그", "last": LEAGUE_LAST["KBO"], "groups": ["드림", "나눔"],
                "teams": [{"name": n, "group": g} for n, g in KBO_GROUP.items()]},
        "NPB": {"name": "일본 프로야구", "last": LEAGUE_LAST["NPB"], "groups": ["센트럴", "퍼시픽"],
                "teams": [{"name": NPB_NAME[k], "group": NPB_GROUP[k]} for k in NPB_NAME]},
        "MLB": {"name": "메이저리그", "last": LEAGUE_LAST["MLB"], "groups": ["아메리칸", "내셔널"],
                "teams": [{"name": MLB_NAME[k], "group": MLB_GROUP[k]} for k in MLB_NAME]},
    }
    teams = ("const LEAGUES = " + json.dumps(leagues, ensure_ascii=False) + ";\n"
             "const COUNTRY_NAME = " + json.dumps(COUNTRY_NAME, ensure_ascii=False) + ";\n"
             "const KBO_TEAMS = LEAGUES.KBO.teams.map(t => t.name);\n")
    path = os.path.join(ROOT, "src", "players.js")
    with open(path, "w", encoding="utf-8") as f:
        f.write(header + body + teams)
    by = defaultdict(int)
    for r in rows:
        by[r[3]] += 1
    print(f"wrote {path}: {len(rows)} players {dict(by)} ({os.path.getsize(path) / 1024 / 1024:.2f} MB)")

    if "--report" in sys.argv:
        for lgname in ("KBO", "NPB", "MLB"):
            lr = [r for r in rows if r[3] == lgname]
            hit = [r for r in lr if r[2] not in ("SP", "RP")]
            pit = [r for r in lr if r[2] in ("SP", "RP")]
            print(f"\n[{lgname}] 타자 상위:", ", ".join(f"{r[1]} {r[5]}" for r in sorted(hit, key=lambda r: -r[5])[:12]))
            print(f"[{lgname}] 투수 상위:", ", ".join(f"{r[1]} {r[5]}" for r in sorted(pit, key=lambda r: -r[5])[:12]))
            dist = defaultdict(int)
            for r in lr:
                dist[r[5] // 10 * 10] += 1
            print(f"[{lgname}] OVR 분포:", dict(sorted(dist.items())))


if __name__ == "__main__":
    main()
