"""공식 사이트(MLB Stats API, KBO, NPB)에서 받은 최신 시즌 기록을 build_players.py 의 기본 데이터에 덧씌움.

fetch_mlb.py / fetch_npb.py / fetch_kbo.py 로 받은 JSON(~/.cache/baseball9-data/recent)을 읽어서
기본 CSV 와 같은 모양의 행으로 바꿔 줍니다. build_players.load() 가 patch(key, rows) 를 호출합니다.
 - MLB : 기본 데이터 이후 시즌(2025~) 추가
 - KBO/NPB : 기본 데이터는 2025년 8월 스냅샷이라 2025 시즌 행을 버리고 2025~ 전체 시즌 기록으로 교체
"""
import json, os, re, sys, unicodedata, zlib
from collections import defaultdict

RECENT = os.path.join(os.path.expanduser("~"), ".cache", "baseball9-data", "recent")
FIRST_YEAR = 2025          # 이 해부터 최신 데이터로 교체/추가


def _load(name):
    p = os.path.join(RECENT, name)
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def _year_of(v):
    try:
        return int(float(str(v)[:4]))
    except ValueError:
        return 0


def _norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z]", "", s)


def _norm_jp(s):
    """일본어 로마자 표기 흔들림(Ohno/Ono, Yuuki/Yuki)을 줄임"""
    s = _norm(s)
    for a, b in (("ou", "o"), ("oh", "o"), ("uu", "u"), ("ei", "e")):
        s = s.replace(a, b)
    return s


def _strip_suffix(last):
    return re.sub(r"\s+(jr|sr|ii|iii|iv)\.?$", "", (last or "").strip(), flags=re.I)


def _dedupe_rows(rows, key):
    seen, out = set(), []
    for r in rows:
        k = key(r)
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


STATE = {}
REPORT = defaultdict(list)


# ══ MLB ═══════════════════════════════════════════════════════
MLB_TEAM = {"ARI": "ARI", "AZ": "ARI", "ATL": "ATL", "BAL": "BAL", "BOS": "BOS", "CWS": "CHA", "CHC": "CHN", "CIN": "CIN",
            "CLE": "CLE", "COL": "COL", "DET": "DET", "HOU": "HOU", "KC": "KCA", "LAA": "LAA", "LAD": "LAN", "MIA": "MIA",
            "MIL": "MIL", "MIN": "MIN", "NYY": "NYA", "NYM": "NYN", "ATH": "OAK", "OAK": "OAK", "PHI": "PHI", "PIT": "PIT",
            "SD": "SDN", "SEA": "SEA", "SF": "SFN", "STL": "SLN", "TB": "TBA", "TEX": "TEX", "TOR": "TOR", "WSH": "WAS"}
MLB_POS = {"LF": "LF", "CF": "CF", "RF": "RF", "OF": "OF", "C": "C", "1B": "1B", "2B": "2B", "3B": "3B", "SS": "SS",
           "DH": "DH", "TWP": "DH"}


def _mlb_years():
    out = {}
    for y in range(FIRST_YEAR, 2100):
        d = _load("mlb_%d.json" % y)
        if d is None:
            break
        out[y] = d
    return out


def _mlb_index(people_rows):
    idx = defaultdict(list)
    for r in people_rows:
        by = r.get("birthYear") or ""
        first, last = _norm(r.get("nameFirst")), _norm(_strip_suffix(r.get("nameLast")))
        idx[("full", first, last, by)].append(r["playerID"])
        idx[("init", first[:1], last, by)].append(r["playerID"])
        idx[("last4", first, last[:4], by)].append(r["playerID"])
        idx[("given", _norm(r.get("nameGiven")), by)].append(r["playerID"])
    return idx


def _mlb_match(p, idx):
    by = (p.get("birth") or "")[:4]
    first, last = _norm(p.get("first")), _norm(_strip_suffix(p.get("last")))
    for k in (("full", first, last, by), ("init", first[:1], last, by), ("last4", first, last[:4], by),
              ("given", _norm(p.get("name")), by)):
        c = idx.get(k)
        if c:
            return c[0]
    return None


def _mlb_prepare(people_rows):
    years = _mlb_years()
    if not years:
        STATE["mlb"] = None
        return people_rows
    idx = _mlb_index(people_rows)
    mapping, new_people, existing = {}, [], {r["playerID"] for r in people_rows}
    info = {}
    for d in years.values():
        for pid, p in d["people"].items():
            info[pid] = p
    cur = {}
    for y in sorted(years):
        for pid, p in years[y]["people"].items():
            cur[pid] = p
    for pid, p in cur.items():
        m = _mlb_match(p, idx)
        if m:
            mapping[pid] = m
        else:
            nid = "mlbam%s" % pid
            mapping[pid] = nid
            if nid not in existing:
                new_people.append({"playerID": nid, "birthYear": (p.get("birth") or "0")[:4], "nameFirst": p.get("first", ""),
                                   "nameLast": p.get("last", ""), "nameGiven": p.get("name", ""),
                                   "birthCountry": p.get("country", ""), "debut": p.get("debut", "")})
                existing.add(nid)
                if p.get("debut") and int(p["debut"] or 0) < FIRST_YEAR:
                    REPORT["mlb_unmatched_veteran"].append((p["name"], p["birth"], p["debut"]))
    STATE["mlb"] = {"years": years, "map": mapping}
    return people_rows + new_people


def _mlb_rows(kind):
    st = STATE.get("mlb")
    out = []
    if not st:
        return out
    for y, d in st["years"].items():
        teams = d["teams"]
        # 같은 해 여러 팀을 거친 선수는 마지막 팀이 뒤로 가도록(합산 후 마지막 팀이 소속으로 쓰임). Stats API 는 시간순이라 그대로 둠
        for s in d[kind]:
            pid = st["map"].get(str(s["id"]))
            if not pid:
                continue
            code = MLB_TEAM.get(teams.get(str(s["team"]), ""), "")
            if not code:
                continue
            x = s["stat"]
            if kind == "bat":
                out.append({"playerID": pid, "yearID": y, "teamID": code, "AB": x.get("atBats", 0), "H": x.get("hits", 0),
                            "2B": x.get("doubles", 0), "3B": x.get("triples", 0), "HR": x.get("homeRuns", 0),
                            "BB": x.get("baseOnBalls", 0), "HBP": x.get("hitByPitch", 0), "SF": x.get("sacFlies", 0),
                            "SH": x.get("sacBunts", 0), "G": x.get("gamesPlayed", 0), "SB": x.get("stolenBases", 0),
                            "CS": x.get("caughtStealing", 0), "SO": x.get("strikeOuts", 0)})
            else:
                out.append({"playerID": pid, "yearID": y, "teamID": code, "IPouts": x.get("outs", 0), "ER": x.get("earnedRuns", 0),
                            "G": x.get("gamesPitched", x.get("gamesPlayed", 0)), "GS": x.get("gamesStarted", 0),
                            "SO": x.get("strikeOuts", 0), "BB": x.get("baseOnBalls", 0), "BFP": x.get("battersFaced", 0)})
    return out


def _mlb_fld():
    st = STATE.get("mlb")
    out = []
    if not st:
        return out
    for y, d in st["years"].items():
        for s in d["bat"]:
            pid = st["map"].get(str(s["id"]))
            pos = MLB_POS.get(d["people"].get(str(s["id"]), {}).get("pos", ""))
            if pid and pos and s["stat"].get("atBats", 0) >= 20:
                out.append({"playerID": pid, "yearID": y, "POS": pos, "G": s["stat"].get("gamesPlayed", 0)})
    return out


# ══ KBO ═══════════════════════════════════════════════════════
KBO_TEAM = {"삼성": "Samsung", "KT": "KT", "KIA": "KIA", "LG": "LG", "두산": "Doosan", "SSG": "SSG", "롯데": "Lotte",
            "한화": "Hanwha", "NC": "NC", "키움": "Kiwoom"}
KBO_TEAM_FULL = {"삼성 라이온즈": "삼성", "KT 위즈": "KT", "KIA 타이거즈": "KIA", "LG 트윈스": "LG", "두산 베어스": "두산",
                 "SSG 랜더스": "SSG", "롯데 자이언츠": "롯데", "한화 이글스": "한화", "NC 다이노스": "NC", "키움 히어로즈": "키움"}
KBO_POS = {"포수": "Catcher", "외야수": "Outfielder", "내야수": "Infielder", "투수": "Pitcher"}


def _kbo_years():
    out = {}
    for y in range(FIRST_YEAR, 2100):
        d = _load("kbo_%d.json" % y)
        if d is None:
            break
        if not d["bat1"]["rows"]:
            continue
        out[y] = d
    return out


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _kbo_bat_rows(d, y):
    by_key = {}
    for r in d["bat1"]["rows"]:
        by_key[(r[-1], r[2])] = {"b1": r}
    for r in d["bat2"]["rows"]:
        by_key.setdefault((r[-1], r[2]), {})["b2"] = r
    for r in d["run"]["rows"]:
        by_key.setdefault((r[-1], r[2]), {})["run"] = r
    out = []
    for (pid, team), v in by_key.items():
        b1 = v.get("b1")
        if not b1 or team not in KBO_TEAM:
            continue
        # bat1: 순위,선수명,팀명,AVG,G,PA,AB,R,H,2B,3B,HR,TB,RBI,SAC,SF
        row = {"PlayerID": pid, "Year": y, "Team": KBO_TEAM[team], "G": b1[4], "PA": b1[5], "AB": b1[6], "H": b1[8],
               "2B": b1[9], "3B": b1[10], "HR": b1[11], "BB": None, "SO": None, "SB": 0, "CS": 0}
        if v.get("b2"):     # 순위,선수명,팀명,AVG,BB,IBB,HBP,SO,...
            row["BB"], row["SO"] = v["b2"][4], v["b2"][7]
        if v.get("run"):    # 순위,선수명,팀명,G,SBA,SB,CS,...
            row["SB"], row["CS"] = v["run"][5], v["run"][6]
        out.append(row)
    return out


def _kbo_pit_rows(d, y):
    out = []
    t2 = {(r[-1], r[2]): r for r in d["pit2"]["rows"]}
    for r in d["pit1"]["rows"]:
        pid, team = r[-1], r[2]
        if team not in KBO_TEAM:
            continue
        # pit1: 순위,선수명,팀명,ERA,G,W,L,SV,HLD,WPCT,IP,H,HR,BB,HBP,SO,R,ER,WHIP
        p2 = t2.get((pid, team))
        tbf = _f(p2[8]) if p2 else 0
        out.append({"PlayerID": pid, "Year": y, "Team": KBO_TEAM[team], "G": r[4], "IP": r[10], "BB": r[13], "SO": r[15],
                    "ER": r[17], "TBF": tbf})
    return out


def _kbo_prepare(people_rows):
    years = _kbo_years()
    if not years:
        STATE["kbo"] = None
        return people_rows
    details = _load("kbo_people_recent.json") or {}
    existing = {r["PlayerID"] for r in people_rows}
    bat, pit = [], []
    for y, d in years.items():
        bat += _kbo_bat_rows(d, y)
        pit += _kbo_pit_rows(d, y)
    # 시즌 중 팀을 옮긴 선수: 현재 팀(상세 페이지 기준)의 행이 마지막에 오도록 정렬
    latest = max(years)
    cur = {pid: KBO_TEAM_FULL.get(v.get("team", ""), "") for pid, v in details.items()}

    def order(r):
        return (r["PlayerID"], r["Year"], 1 if KBO_TEAM.get(cur.get(r["PlayerID"], "")) == r["Team"] else 0)
    bat.sort(key=order)
    pit.sort(key=order)
    STATE["kbo"] = {"bat": bat, "pit": pit}
    new = []
    for pid in {r["PlayerID"] for r in bat + pit} - existing:
        v = details.get(pid)
        if not v or not v.get("name"):
            REPORT["kbo_nodetail"].append(pid)
            continue
        pos = KBO_POS.get(v.get("pos", ""), "Infielder")
        foreign = not re.search(r"(초|중|고)", v.get("career", ""))
        new.append({"PlayerID": pid, "Name": v["name"], "Nationality": "" if foreign else "Korea", "Position": pos,
                    "BirthYear": v.get("birth") or "", "LastNameEng": "", "FirstNameEng": ""})
    return people_rows + new


def _kbo_fill_bb_so(base_rows, new_rows):
    """볼넷·삼진 표를 못 받은 시즌(2025)은 기본 데이터(2025 중반까지)의 타석당 비율로 추정, 없으면 선수 통산 → 리그 평균"""
    acc = defaultdict(lambda: [0.0, 0.0, 0.0])
    tot = [0.0, 0.0, 0.0]
    for r in base_rows:
        pa = _f(r.get("PA"))
        if pa <= 0:
            continue
        a = acc[(r["PlayerID"], _year_of(r.get("Year")))]
        c = acc[(r["PlayerID"], 0)]
        for t in (a, c):
            t[0] += pa; t[1] += _f(r.get("BB")); t[2] += _f(r.get("SO"))
        if _year_of(r.get("Year")) >= 2015:
            tot[0] += pa; tot[1] += _f(r.get("BB")); tot[2] += _f(r.get("SO"))
    lg = (tot[1] / tot[0], tot[2] / tot[0]) if tot[0] else (0.09, 0.18)
    n = 0
    for r in new_rows:
        if r["BB"] is not None:
            continue
        pa = _f(r["PA"])
        a = acc.get((r["PlayerID"], r["Year"]))
        if not a or a[0] < 40:
            a = acc.get((r["PlayerID"], 0))
        rate = (a[1] / a[0], a[2] / a[0]) if a and a[0] >= 40 else lg
        r["BB"], r["SO"] = round(pa * rate[0]), round(pa * rate[1])
        n += 1
    REPORT["kbo_bb_so_estimated"].append(n)


# ══ NPB ═══════════════════════════════════════════════════════
NPB_SEC_POS = {"PITCHERS": "P", "CATCHERS": "C", "INFIELDERS": "SS", "OUTFIELDERS": "OF"}


def _npb_split(name):
    if "," in name:
        last, first = [x.strip() for x in name.split(",", 1)]
    else:
        parts = name.split()
        last, first = parts[0], " ".join(parts[1:])
    return last, first


def _npb_ip_outs(v):
    v = (v or "").strip()
    m = re.match(r"^(\d+)(?:\s+(\d)/3)?$", v)
    if m:
        return int(m.group(1)) * 3 + int(m.group(2) or 0)
    m = re.match(r"^(\d+)\.(\d)$", v)
    if m:
        return int(m.group(1)) * 3 + int(m.group(2))
    return int(_f(v) * 3)


def _npb_prepare(people_rows):
    years = {}
    for y in range(FIRST_YEAR, 2100):
        d = _load("npb_%d.json" % y)
        if d is None:
            break
        years[y] = d
    if not years:
        STATE["npb"] = None
        return people_rows
    latest = max(years)
    roster = years[latest].get("roster", {})
    # 기본 인물 색인
    idx = defaultdict(list)
    for r in people_rows:
        idx[(_norm_jp(r.get("nameLast")), _norm_jp(r.get("nameFirst")))].append(r)
    by_last = defaultdict(list)
    for r in people_rows:
        by_last[(_norm_jp(r.get("nameLast")), r.get("birthYear"))].append(r)
    ros = {}
    for team, lst in roster.items():
        for sec, name, born in lst:
            ros[(team, _norm(name))] = (sec, born, name)

    def resolve(team, name):
        last, first = _npb_split(name)
        key = (_norm_jp(last), _norm_jp(first))
        sec, born, _ = ros.get((team, _norm(name)), ("", 0, ""))
        cands = idx.get(key, [])
        if born:
            c = [r for r in cands if str(born) == r.get("birthYear")]
            if not c:                      # 철자가 조금 다른 경우: 성 + 출생연도 + 이름 유사도
                c = [r for r in by_last.get((key[0], str(born)), [])
                     if _sim(_norm_jp(r.get("nameFirst")), key[1]) >= 0.7]
            cands = c
        elif len(cands) > 1:
            cands = []
        if cands:
            return cands[0]["playerID"], born or int(cands[0].get("birthYear") or 0), sec, last, first, False
        pid = "9%d" % (zlib.crc32(("%s|%s|%s" % (last, first, born)).encode()) % 10 ** 8)
        return pid, born, sec, last, first, True

    new_people, seen_new = [], set()
    bat, pit, fld = [], [], []
    for y, d in years.items():
        for kind in ("bat", "pit"):
            heads = d[kind + "_heads"]
            col = {h: i + 1 for i, h in enumerate(heads[1:])}     # row = [team, name, ...]
            for r in d[kind]:
                team, name = r[0], r[1]
                if not name:
                    continue
                pid, born, sec, last, first, is_new = resolve(team, name)
                if is_new and pid not in seen_new:
                    seen_new.add(pid)
                    new_people.append({"playerID": pid, "birthYear": born or "", "nameLast": last, "nameFirst": first,
                                       "nameGiven": "%s %s" % (first, last), "birthPlace": "Japan", "Position": sec})
                    if y == latest and (kind == "bat" and _f(r[col["PA"] + 1]) >= 100):
                        REPORT["npb_new_regular"].append((name, team, born))
                g = lambda h: r[col[h] + 1] if h in col and col[h] + 1 < len(r) else 0
                if kind == "bat":
                    bat.append({"playerID": pid, "yearID": y, "teamID": team, "POS": NPB_SEC_POS.get(sec, "") if is_new and sec != "PITCHERS" else "",
                                "G": g("G"), "PA": g("PA"), "AB": g("AB"), "H": g("H"), "2B": g("2B"), "3B": g("3B"),
                                "HR": g("HR"), "BB": g("BB"), "HBP": g("HBP") or g("HP"), "SF": g("SF"), "SH": g("SH"),
                                "SB": g("SB"), "CS": g("CS"), "SO": g("SO")})
                else:
                    outs = _npb_ip_outs(g("IP"))
                    gm = _f(g("G"))
                    pit.append({"playerID": pid, "yearID": y, "teamID": team, "G": gm,
                                "GS": gm if gm and outs / 3 / gm >= 3.5 else 0,      # 선발 수는 표에 없어 이닝/경기로 추정
                                "IPouts": outs, "ER": g("ER"), "SO": g("SO"), "BB": g("BB"), "BFP": g("BF")})
    STATE["npb"] = {"bat": bat, "pit": pit}
    return people_rows + new_people


def _sim(a, b):
    if not a or not b:
        return 0.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return 1 - prev[-1] / max(len(a), len(b))


# ══ 진입점 ════════════════════════════════════════════════════
def patch(key, rows):
    """build_players.load(key) 가 읽은 기본 행에 최신 기록을 덧씌워 돌려줌"""
    if key == "mlb_people":
        return _mlb_prepare(rows)
    if key == "mlb_bat":
        return rows + _mlb_rows("bat")
    if key == "mlb_pit":
        return rows + _mlb_rows("pit")
    if key == "mlb_fld":
        return rows + _mlb_fld()
    if key == "kbo_people":
        return _kbo_prepare(rows)
    if key in ("kbo_bat", "kbo_pit"):
        st = STATE.get("kbo")
        if not st:
            return rows
        keep = [r for r in rows if _year_of(r.get("Year")) < FIRST_YEAR]
        if key == "kbo_bat":
            _kbo_fill_bb_so(rows, st["bat"])
        return keep + st["bat" if key == "kbo_bat" else "pit"]
    if key == "npb_people":
        return _npb_prepare(rows)
    if key in ("npb_bat", "npb_pit"):
        st = STATE.get("npb")
        if not st:
            return rows
        keep = [r for r in rows if _year_of(r.get("yearID")) < FIRST_YEAR]
        return keep + st["bat" if key == "npb_bat" else "pit"]
    return rows


def report():
    for k, v in REPORT.items():
        print("[recent]", k, len(v), v[:12], file=sys.stderr)
