"""NPB 공식 사이트(영문)에서 구단별 타자/투수 기록을 받아 JSON 으로 저장.
사용: python3 fetch_npb.py 2025 2026 → ~/.cache/baseball9-data/recent/npb_<year>.json"""
import re, sys, os, json, html, urllib.request

OUT = os.path.join(os.path.expanduser("~"), ".cache", "baseball9-data", "recent")
TEAMS = {"g": "YOMIURI", "t": "HANSHIN", "d": "CHUNICHI", "db": "DENA", "c": "HIROSHIMA", "s": "YAKULT",
         "h": "SOFTBANK", "f": "NIPPON-HAM", "l": "SEIBU", "m": "LOTTE", "b": "ORIX", "e": "RAKUTEN"}


def table(url):
    h = urllib.request.urlopen(url, timeout=60).read().decode("utf-8", "replace")
    heads = [re.sub(r"<[^>]+>|\s+", "", x) for x in re.findall(r"<th[^>]*>(.*?)</th>", h, re.S)]
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", h, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(cells) < 15:
            continue
        if cells[0] in ("", "*", "+", "-") and re.search(r"[A-Za-z]", cells[1]):   # 구형 표: 좌/우/양타 표시 칸
            cells = cells[1:]
        rows.append(cells)
    return [x for x in heads if x], rows


def roster(code):
    """구단 로스터(현재): [(구분, 이름, 생년)] — 구분은 PITCHERS/CATCHERS/INFIELDERS/OUTFIELDERS"""
    h = urllib.request.urlopen("https://npb.jp/bis/eng/teams/rst_%s.html" % code, timeout=60).read().decode("utf-8", "replace")
    out, sec = [], ""
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", h, re.S):
        m = re.search(r'<a name="[a-z]+">([A-Z ]+)</a>', tr)
        if m:
            sec = m.group(1).strip()
            continue
        c = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(c) >= 3 and "rosterRegister" in tr and sec and sec != "MANAGERS":
            by = re.search(r"(\d{4})", c[2])
            out.append([sec, c[1], int(by.group(1)) if by else 0])
    return out


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for y in sys.argv[1:]:
        res = {}
        for kind, pre in (("bat", "idb1"), ("pit", "idp1")):
            res[kind] = []
            for code, team in TEAMS.items():
                heads, rows = table("https://npb.jp/bis/eng/%s/stats/%s_%s.html" % (y, pre, code))
                res[kind + "_heads"] = heads
                res[kind] += [[team] + r for r in rows]
        if y == sys.argv[-1]:
            res["roster"] = {team: roster(code) for code, team in TEAMS.items()}
        json.dump(res, open(os.path.join(OUT, "npb_%s.json" % y), "w", encoding="utf-8"), ensure_ascii=False)
        print(y, len(res["bat"]), len(res["pit"]), res["bat_heads"][:6], res["pit_heads"], file=sys.stderr)
