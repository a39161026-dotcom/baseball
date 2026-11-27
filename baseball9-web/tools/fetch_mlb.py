"""MLB 공식 Stats API 에서 시즌 타자/투수 기록과 선수 정보를 받아 JSON 으로 저장.
사용: python3 fetch_mlb.py 2025 2026 → ~/.cache/baseball9-data/recent/mlb_<year>.json"""
import json, os, sys, urllib.request

API = "https://statsapi.mlb.com/api/v1/"
OUT = os.path.join(os.path.expanduser("~"), ".cache", "baseball9-data", "recent")


def get(path):
    for i in range(3):
        try:
            return json.load(urllib.request.urlopen(API + path, timeout=90))
        except Exception:
            if i == 2:
                raise


def splits(group, year):
    out, off = [], 0
    while True:
        d = get("stats?stats=season&group=%s&season=%s&sportId=1&playerPool=ALL&limit=500&offset=%d" % (group, year, off))
        sp = d["stats"][0]["splits"]
        out += sp
        off += 500
        if len(sp) < 500:
            return out


def people(ids):
    ids = sorted(ids)
    res = {}
    for i in range(0, len(ids), 100):
        for p in get("people?personIds=" + ",".join(map(str, ids[i:i + 100])))["people"]:
            res[p["id"]] = {"name": p["fullName"], "first": p.get("firstName", ""), "last": p.get("lastName", ""),
                            "birth": (p.get("birthDate") or "0000")[:4], "country": p.get("birthCountry", ""),
                            "pos": p.get("primaryPosition", {}).get("abbreviation", ""),
                            "debut": (p.get("mlbDebutDate") or "")[:4]}
    return res


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    teams = {t["id"]: t["abbreviation"] for t in get("teams?sportId=1&season=2026")["teams"]}
    for y in sys.argv[1:]:
        bat = [s for s in splits("hitting", y) if s.get("team")]
        pit = [s for s in splits("pitching", y) if s.get("team")]
        ids = {s["player"]["id"] for s in bat + pit}
        res = {"bat": [{"id": s["player"]["id"], "team": s["team"]["id"], "stat": s["stat"]} for s in bat],
               "pit": [{"id": s["player"]["id"], "team": s["team"]["id"], "stat": s["stat"]} for s in pit],
               "people": {str(k): v for k, v in people(ids).items()}, "teams": teams}
        json.dump(res, open(os.path.join(OUT, "mlb_%s.json" % y), "w", encoding="utf-8"), ensure_ascii=False)
        print(y, len(bat), len(pit), len(ids), file=sys.stderr)
