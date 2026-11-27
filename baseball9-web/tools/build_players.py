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
"""
import csv
import io
import json
import math
import os
import sys
import urllib.request
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


def load(key):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, key + ".csv")
    if not os.path.exists(path):
        url = BASE + FILES[key].replace("+", "%2B")
        print("download", url, file=sys.stderr)
        with urllib.request.urlopen(url, timeout=120) as r, open(path, "wb") as f:
            f.write(r.read())
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


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
                                {"PA": "PA", "AB": "AB", "H": "H", "2B": "2B", "3B": "3B", "HR": "HR", "BB": "BB", "G": "G"})
    lg = league_bat_avgs(bat)
    bat_r = rate_batters(bat, lg)

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
        pit_team[(pid, y)] = r.get("Team")
    ipg = defaultdict(lambda: [0.0, 0.0])
    for (pid, y), s in pit.items():
        ipg[pid][0] += s["IP"]
        ipg[pid][1] += s["G"]
    starters = {pid: (ip / g >= 3.5 if g else False) for pid, (ip, g) in ipg.items()}
    pit_r = rate_pitchers(pit, starters)

    fld = defaultdict(lambda: defaultdict(float))
    for r in load("kbo_fld"):
        p = norm_pos(r.get("POS"))
        if p:
            fld[r["playerId"]][p] += num(r.get("G"))

    return assemble("K", "KBO", people, bat_r, pit_r, starters, fld, bat_team, pit_team,
                    name=lambda p: (p.get("Name") or "").strip(),
                    birth=lambda p: int(num(p.get("BirthYear"))) or None,
                    fallback_pos=lambda p: {"Catcher": "C", "Outfielder": "OF", "Infielder": "3B"}.get(p.get("Position"), "DH"),
                    team_name=lambda code: KBO_FRANCHISE.get(code) or KBO_TEAM_KOR.get(code) or code)


def build_npb():
    people = {r["playerID"]: r for r in load("npb_people")}
    rows = load("npb_bat")
    bat, bat_team = agg_batting(rows, "playerID", "yearID",
                                {"PA": "PA", "AB": "AB", "H": "H", "2B": "2B", "3B": "3B", "HR": "HR", "BB": "BB",
                                 "HBP": "HBP", "SF": "SF", "SH": "SH", "G": "G"})
    lg = league_bat_avgs(bat)
    bat_r = rate_batters(bat, lg)
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
        pit_team[(pid, y)] = r.get("teamID")
    gs = defaultdict(lambda: [0.0, 0.0])
    for (pid, y), s in pit.items():
        gs[pid][0] += s["GS"]
        gs[pid][1] += s["G"]
    starters = {pid: (a / b >= 0.5 if b else False) for pid, (a, b) in gs.items()}
    pit_r = rate_pitchers(pit, starters)
    return assemble("N", "NPB", people, bat_r, pit_r, starters, fld, bat_team, pit_team,
                    name=lambda p: (p.get("nameGiven") or f"{p.get('nameFirst', '')} {p.get('nameLast', '')}").strip(),
                    birth=lambda p: int(num(p.get("birthYear"))) or None,
                    fallback_pos=lambda p: "DH", team_name=lambda code: code)


def build_mlb():
    people = {r["playerID"]: r for r in load("mlb_people")}
    bat, bat_team = agg_batting(load("mlb_bat"), "playerID", "yearID",
                                {"AB": "AB", "H": "H", "2B": "2B", "3B": "3B", "HR": "HR", "BB": "BB",
                                 "HBP": "HBP", "SF": "SF", "SH": "SH", "G": "G"})
    lg = league_bat_avgs(bat)
    bat_r = rate_batters(bat, lg)
    pit = defaultdict(lambda: defaultdict(float))
    pit_team = {}
    for r in load("mlb_pit"):
        pid, y = r["playerID"], year_of(r["yearID"])
        s = pit[(pid, y)]
        s["IP"] += num(r.get("IPouts")) / 3
        s["ER"] += num(r.get("ER"))
        s["G"] += num(r.get("G"))
        s["GS"] += num(r.get("GS"))
        pit_team[(pid, y)] = r.get("teamID")
    gs = defaultdict(lambda: [0.0, 0.0])
    for (pid, y), s in pit.items():
        gs[pid][0] += s["GS"]
        gs[pid][1] += s["G"]
    starters = {pid: (a / b >= 0.5 if b else False) for pid, (a, b) in gs.items()}
    pit_r = rate_pitchers(pit, starters)
    fld = defaultdict(lambda: defaultdict(float))
    for r in load("mlb_fld"):
        p = norm_pos(r.get("POS"))
        if p:
            fld[r["playerID"]][p] += num(r.get("G"))
    return assemble("M", "MLB", people, bat_r, pit_r, starters, fld, bat_team, pit_team,
                    name=lambda p: f"{p.get('nameFirst', '')} {p.get('nameLast', '')}".strip(),
                    birth=lambda p: int(num(p.get("birthYear"))) or None,
                    fallback_pos=lambda p: "DH", team_name=lambda code: code)


def assemble(prefix, league, people, bat_r, pit_r, starters, fld, bat_team, pit_team, name, birth, fallback_pos, team_name):
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
        # 최다 소속 구단(레전드 리그 배정용, KBO 만)
        most = ""
        if league == "KBO":
            cnt = defaultdict(int)
            for _, t in teams:
                f = KBO_FRANCHISE.get(t)
                if f:
                    cnt[f] += 1
            most = max(cnt.items(), key=lambda kv: kv[1])[0] if cnt else ""
        by = birth(p) if p else None
        ovr = r["ovr"]
        pot = ovr
        if r["last"] >= 2024 and by and r["last"] - by <= 25:      # 젊은 현역: 성장 여지
            pot = min(97, ovr + 2 * (26 - (r["last"] - by)))
        out.append([prefix + pid, nm, pos, league, by or 0, ovr, pot, last_team, most, r["first"], r["last"], r["peak"]])
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


def main():
    rows = build_kbo() + build_npb() + build_mlb()
    rows = dedupe_names(rows)
    rows.sort(key=lambda r: (r[3], -r[5], r[1]))
    header = ("// 선수 DB — tools/build_players.py 로 생성 (직접 수정하지 마세요)\n"
              "// 출처: KBO 공식 기록, NPB 공식/npbstats, MLB Lahman Database (frankmkpark/mnk_datasets 정리본)\n"
              "// [id, 이름, 포지션, 리그, 출생연도, OVR, 잠재력, 마지막 소속, KBO 최다 소속 구단, 첫 시즌, 마지막 시즌, 전성기 시즌]\n")
    body = "const PLAYERS = [\n" + ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows) + "\n];\n"
    teams = ("const KBO_TEAMS = " + json.dumps(["KIA타이거즈", "삼성라이온즈", "LG트윈스", "두산베어스", "KT위즈", "SSG랜더스",
                                                  "롯데자이언츠", "한화이글스", "NC다이노스", "키움히어로즈"], ensure_ascii=False) + ";\n"
             "const NPB_TEAMS = [];\nconst MLB_TEAMS = [];\n")
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
