"""KBO 공식 사이트에서 시즌별 타자/투수 기록을 받아 JSON 으로 저장 (ASP.NET 폼 전송 방식).
사용: python3 fetch_kbo.py 2025 2026  → ~/.cache/baseball9-data/recent/kbo_<year>.json"""
import re, sys, os, json, urllib.request, urllib.parse, http.cookiejar, html

P = "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$"
BASE = "https://www.koreabaseball.com/Record/Player/"
OUT = os.path.join(os.path.expanduser("~"), ".cache", "baseball9-data", "recent")
TEAMS = ["SS", "KT", "HT", "LG", "OB", "SK", "LT", "NC", "HH", "WO"]


class Page:
    def __init__(self, path):
        self.url = BASE + path
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.html = self.op.open(self.url, timeout=40).read().decode("utf-8", "replace")

    def post(self, season, team="", page=1, target=None):
        d = {}
        for m in re.finditer(r'<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"', self.html):
            d[m.group(1)] = html.unescape(m.group(2))
        d.update({P + "ddlSeason$ddlSeason": str(season), P + "ddlSeries$ddlSeries": "0",
                  P + "ddlTeam$ddlTeam": team, P + "ddlPos$ddlPos": "", P + "hfPage": str(page),
                  "__EVENTTARGET": target or (P + "ddlTeam$ddlTeam"), "__EVENTARGUMENT": ""})
        data = urllib.parse.urlencode(d).encode()
        self.html = self.op.open(urllib.request.Request(self.url, data=data), timeout=60).read().decode("utf-8", "replace")
        return self.html


def parse(h):
    t = re.search(r'<table[^>]*class="tData[^"]*"[^>]*>(.*?)</table>', h, re.S)
    if not t:
        return [], []
    body = t.group(1)
    heads = [re.sub(r"<[^>]+>|\s+", "", x) for x in re.findall(r"<th[^>]*>(.*?)</th>", body, re.S)]
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if not cells:
            continue
        pid = re.search(r"playerId=(\d+)", tr)
        rows.append([re.sub(r"<[^>]+>", "", c).strip() for c in cells] + [pid.group(1) if pid else ""])
    return heads, rows


def grab(path, season):
    out = []
    pg = Page(path)
    heads = []
    for team in TEAMS:
        for _ in range(4):
            h = pg.post(season, team)
            if parse(h)[1]:
                break
            pg = Page(path)
        for page in range(1, 6):
            if page > 1:
                h = pg.post(season, team, page, target=P + "ucPager$btnNo%d" % page)
            heads, rows = parse(h)
            if not rows or (out and rows and out[-1][1:3] == rows[-1][1:3] and False):
                break
            out += [r for r in rows if r not in out]
            if len(rows) < 30:
                break
    return heads, out


if __name__ == "__main__" and sys.argv[1:] == ["details"]:
    pass
elif __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for y in sys.argv[1:]:
        res = {}
        for key, path in (("bat1", "HitterBasic/Basic1.aspx"), ("bat2", "HitterBasic/Basic2.aspx"),
                          ("pit1", "PitcherBasic/Basic1.aspx"), ("pit2", "PitcherBasic/Basic2.aspx"),
                          ("run", "Runner/Basic.aspx")):
            heads, rows = grab(path, y)
            res[key] = {"heads": heads, "rows": rows}
            print(y, key, len(rows), heads[:8], file=sys.stderr)
        json.dump(res, open(os.path.join(OUT, "kbo_%s.json" % y), "w", encoding="utf-8"), ensure_ascii=False)


# ── 선수 상세(생년·포지션·현재 팀): 기존 DB에 없는 신인/외국인, 시즌 중 팀을 옮긴 선수용 ─────
def detail(pid, kind="Hitter"):
    url = "https://www.koreabaseball.com/Record/Player/%sDetail/Basic.aspx?playerId=%s" % (kind, pid)
    h = urllib.request.urlopen(url, timeout=40).read().decode("utf-8", "replace")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", h, flags=re.S)
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t))
    out = {}
    m = re.search(r"기록실 (.+?) 선수명: (\S+)", t)
    if m:
        out["team"], out["name"] = m.group(1), m.group(2)
    m = re.search(r"생년월일: (\d{4})년", t)
    out["birth"] = int(m.group(1)) if m else 0
    m = re.search(r"포지션: (\S+?)\(", t)
    out["pos"] = m.group(1) if m else ""
    m = re.search(r"경력: (.+?) 입단 계약금", t)
    out["career"] = m.group(1) if m else ""
    return out


def fetch_details():
    """기본 DB(kbo_people.csv)에 없는 선수 + 최신 시즌에 두 팀 이상에서 뛴 선수의 상세 정보를 kbo_people_recent.json 으로 저장"""
    import csv, time
    cache = os.environ.get("BASEBALL_DATA_CACHE", os.path.join(os.path.expanduser("~"), ".cache", "baseball9-data"))
    base = {r["PlayerID"] for r in csv.DictReader(open(os.path.join(cache, "kbo_people.csv"), encoding="utf-8-sig"))}
    path = os.path.join(OUT, "kbo_people_recent.json")
    have = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    want = {}
    for fn in sorted(os.listdir(OUT)):
        if not re.match(r"kbo_\d{4}\.json$", fn):
            continue
        d = json.load(open(os.path.join(OUT, fn), encoding="utf-8"))
        latest = fn
        for key, kind in (("bat1", "Hitter"), ("pit1", "Pitcher")):
            teams = {}
            for r in d[key]["rows"]:
                teams.setdefault(r[-1], set()).add(r[2])
            for pid, ts in teams.items():
                if pid not in base or len(ts) > 1:
                    want.setdefault(pid, kind)
    todo = [p for p in want if p not in have]
    print("details:", len(want), "todo", len(todo), file=sys.stderr)
    for i, pid in enumerate(todo):
        for _ in range(3):
            try:
                have[pid] = detail(pid, want[pid])
                if not have[pid].get("name"):
                    have[pid] = detail(pid, "Pitcher" if want[pid] == "Hitter" else "Hitter")
                break
            except Exception as e:
                time.sleep(2)
        if i % 20 == 0:
            json.dump(have, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(have, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    print("saved", len(have), file=sys.stderr)


if __name__ == "__main__" and sys.argv[1:] == ["details"]:
    fetch_details()
