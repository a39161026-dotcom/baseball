"""야구9단 매니저 — Flask 웹 버전. 게임 엔진은 game/ 패키지를 사용합니다."""
import random
import threading
import uuid

from flask import Flask, jsonify, request, send_from_directory

from game.engine import DIFFICULTY, PITCH_CALLS, GameEngine, MODE_AT_BAT, MODE_GAME, MODE_HALF, MODE_PITCH
from game.league import (apply_post_game_fatigue, build_all_players, build_auto_roster, build_opp_roster,
                         opponent_names, update_daily_condition)
from game.models import GameState, POS_LABEL

app = Flask(__name__, static_folder="static", static_url_path="")
LOCK = threading.Lock()


class League:
    """내 팀 + 전적 (Java GameManager 의 역할)"""

    def __init__(self):
        self.all_players = build_all_players()
        self.team_name = "나의 팀"
        self.roster = []
        self.wins = 0
        self.losses = 0
        self.recent = []      # [{opponent, result, score}]
        self.reset(75, 85)

    def reset(self, min_ovr, max_ovr):
        self.roster = build_auto_roster(self.all_players, min_ovr, max_ovr)
        self.wins = self.losses = 0
        self.recent = []
        update_daily_condition(self.roster)


LEAGUE = League()
GAMES = {}


class Game:
    def __init__(self, gs, engine, opponent_roster):
        self.gs = gs
        self.engine = engine
        self.opp_roster = opponent_roster
        self.finished = False


def find_player(players, pid):
    return next((p for p in players if p.id == pid), None)


def player_dict(p, line=None):
    d = p.to_dict()
    if line is not None:
        d.update({"pitches": line.pitches, "inn": line.innings_text, "hits": line.hits,
                  "runs": line.runs, "walks": line.walks, "ks": line.strikeouts})
    d["posLabel"] = POS_LABEL.get(p.pos, p.pos)
    return d


def linescore(team, cols):
    return [None if v is None else v for v in team.runs_by_inning] + [None] * (cols - len(team.runs_by_inning))


def state_dict(game):
    gs, eng = game.gs, game.engine
    mine, theirs = gs.mine, gs.theirs
    cols = max(9, len(mine.runs_by_inning), len(theirs.runs_by_inning))
    cur_slot = mine.current_slot if gs.top else -1
    attacking = gs.offense()
    defending = gs.defense()
    batter = attacking.current_batter()
    d = {
        "gameId": game.id,
        "opponent": gs.opponent,
        "myName": mine.name,
        "inning": gs.inning,
        "top": gs.top,
        "outs": gs.outs,
        "balls": gs.balls,
        "strikes": gs.strikes,
        "runners": [r.name if r is not None else None for r in gs.runners],
        "score": {"mine": mine.score, "theirs": theirs.score},
        "hits": {"mine": mine.hits, "theirs": theirs.hits},
        "innings": cols,
        "linescore": {"mine": linescore(mine, cols), "theirs": linescore(theirs, cols)},
        "pitchTotal": gs.pitch_total,
        "done": gs.done,
        "difficulty": eng.difficulty,
        "lineup": [dict(player_dict(p), current=(i == cur_slot)) for i, p in enumerate(mine.lineup)],
        "batter": player_dict(batter) if batter else None,
        "myPitcher": player_dict(mine.pitcher, mine.current_line()) if mine.pitcher else None,
        "oppPitcher": player_dict(theirs.pitcher, theirs.current_line()) if theirs.pitcher else None,
        "needsDecision": eng.needs_decision(),
        "decisionKind": ("offense" if gs.top else "defense") if eng.needs_decision() else None,
        "stealable": eng.stealable_bases(),
        "canBunt": eng.can_bunt(),
        "canIbb": eng.can_ibb(),
        "bench": [player_dict(p) for p in mine.bench()] if gs.top and not gs.done else [],
        "bullpen": [player_dict(p) for p in mine.bullpen()] if not gs.top and not gs.done else [],
        "pitchCall": eng.pitch_call,
        "pitchCalls": [{"id": k, "label": v} for k, v in PITCH_CALLS.items()],
        "record": {"wins": LEAGUE.wins, "losses": LEAGUE.losses},
        "defending": defending.name,
    }
    if gs.done:
        d["box"] = {
            "mine": [dict(player_dict(l.pitcher, l)) for l in mine.pitcher_lines],
            "theirs": [dict(player_dict(l.pitcher, l)) for l in theirs.pitcher_lines],
        }
    return d


def lines_out(lines):
    return [{"kind": k, "text": t} for k, t in lines]


def record_result(game):
    """경기 종료 시 1회만 전적/피로도 반영"""
    if game.finished:
        return
    game.finished = True
    gs = game.gs
    win = gs.mine.score > gs.theirs.score
    if win:
        LEAGUE.wins += 1
    else:
        LEAGUE.losses += 1
    LEAGUE.recent.append({"opponent": gs.opponent, "result": "승" if win else "패",
                          "score": f"{gs.mine.score}:{gs.theirs.score}"})
    apply_post_game_fatigue(gs.mine)


# ── 페이지 ──────────────────────────────────────────────
@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


# ── 리그 ────────────────────────────────────────────────
@app.get("/api/league")
def api_league():
    return jsonify({
        "teamName": LEAGUE.team_name,
        "record": {"wins": LEAGUE.wins, "losses": LEAGUE.losses},
        "roster": [p.to_dict() for p in LEAGUE.roster],
        "recent": LEAGUE.recent[-5:],
        "opponents": opponent_names(),
        "difficulties": [{"id": k, "label": v[1]} for k, v in DIFFICULTY.items()],
    })


@app.post("/api/league/reset")
def api_league_reset():
    body = request.get_json(silent=True) or {}
    lo, hi = int(body.get("minOvr", 75)), int(body.get("maxOvr", 85))
    with LOCK:
        LEAGUE.reset(lo, hi)
    return api_league()


# ── 경기 ────────────────────────────────────────────────
@app.post("/api/game")
def api_game_new():
    body = request.get_json(silent=True) or {}
    opp = body.get("opponent") or opponent_names()[0]
    difficulty = body.get("difficulty", "NORMAL")
    if difficulty not in DIFFICULTY:
        return jsonify({"error": "난이도가 올바르지 않습니다."}), 400

    with LOCK:
        roster = LEAGUE.roster
        pitchers = [p for p in roster if p.is_pitcher]
        if not pitchers:
            return jsonify({"error": "투수가 1명 이상 필요합니다."}), 400

        # 타순: 지정한 순서 우선, 없으면 OVR 높은 야수 9명
        ids = body.get("lineup")
        if ids:
            lineup = [find_player(roster, i) for i in ids]
            if len(lineup) != 9 or any(p is None or p.is_pitcher for p in lineup):
                return jsonify({"error": "타순은 야수 9명이어야 합니다."}), 400
        else:
            lineup = sorted((p for p in roster if not p.is_pitcher), key=lambda p: -p.eff_ovr)[:9]
        if len(lineup) < 9:
            return jsonify({"error": "타순은 야수 9명이 필요합니다."}), 400

        starter = find_player(roster, body.get("starter")) if body.get("starter") else None
        if starter is None or not starter.is_pitcher:
            starter = min(pitchers, key=lambda p: (p.pos != "SP", p.fatigue))

        opp_roster = build_opp_roster(LEAGUE.all_players, {p.id for p in roster}, random)
        opp_lineup = sorted((p for p in opp_roster if not p.is_pitcher), key=lambda p: -p.ovr)[:9]
        if len(opp_lineup) < 9:
            return jsonify({"error": "상대 팀 타자가 부족합니다."}), 400
        opp_starter = next((p for p in opp_roster if p.pos == "SP"),
                           next((p for p in opp_roster if p.is_pitcher), None))

        gs = GameState(LEAGUE.team_name, opp)
        gs.mine.lineup = list(lineup)
        gs.mine.roster = list(roster)
        gs.mine.pitcher = starter
        gs.theirs.lineup = opp_lineup
        gs.theirs.roster = opp_roster
        gs.theirs.pitcher = opp_starter

        engine = GameEngine(gs, difficulty=difficulty)
        game = Game(gs, engine, opp_roster)
        game.id = uuid.uuid4().hex[:10]
        GAMES[game.id] = game
        start_lines = engine.drain_queue()
        return jsonify({"state": state_dict(game), "lines": lines_out(start_lines)})


def get_game(gid):
    g = GAMES.get(gid)
    if g is None:
        return None, (jsonify({"error": "경기를 찾을 수 없습니다."}), 404)
    return g, None


@app.get("/api/game/<gid>")
def api_game_get(gid):
    g, err = get_game(gid)
    if err:
        return err
    return jsonify({"state": state_dict(g), "lines": []})


@app.post("/api/game/<gid>/advance")
def api_advance(gid):
    g, err = get_game(gid)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    mode = {"pitch": MODE_PITCH, "atbat": MODE_AT_BAT, "inning": MODE_HALF, "game": MODE_GAME}.get(body.get("mode"), MODE_PITCH)
    stop = bool(body.get("stopAtDecision"))
    with LOCK:
        if body.get("ack"):
            g.engine.ack_decision()
        if g.gs.done:
            return jsonify({"state": state_dict(g), "lines": [], "paused": False})
        if stop and g.engine.needs_decision():
            return jsonify({"state": state_dict(g), "lines": [], "paused": True})
        res = g.engine.run(mode, stop_at_decision=stop)
        lines = g.engine.drain_queue()
        all_lines = lines + res.lines
        if res.game_over:
            record_result(g)
        return jsonify({"state": state_dict(g), "lines": lines_out(all_lines), "paused": False,
                        "gameOver": res.game_over})


@app.post("/api/game/<gid>/order")
def api_order(gid):
    g, err = get_game(gid)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    kind = body.get("type")
    eng, gs = g.engine, g.gs
    ok = False
    with LOCK:
        if kind == "bunt":
            ok = eng.request_bunt()
        elif kind == "steal":
            ok = eng.request_steal(int(body.get("base", -1)))
        elif kind == "ibb":
            ok = eng.request_ibb()
        elif kind == "pinch_hit":
            sub = find_player(gs.mine.roster, body.get("id"))
            ok = sub is not None and eng.request_pinch_hit(sub)
        elif kind == "pinch_run":
            sub = find_player(gs.mine.roster, body.get("id"))
            ok = sub is not None and eng.request_pinch_run(int(body.get("base", -1)), sub)
        elif kind == "pitcher":
            nxt = find_player(gs.mine.roster, body.get("id"))
            ok = nxt is not None and eng.request_pitcher_change(nxt)
        elif kind == "pitch_call":
            ok = eng.set_pitch_call(body.get("call"))
        else:
            return jsonify({"error": "알 수 없는 지시입니다."}), 400
        lines = eng.drain_queue()
    if not ok:
        return jsonify({"error": "지금은 이 지시를 낼 수 없습니다.", "state": state_dict(g)}), 409
    return jsonify({"state": state_dict(g), "lines": lines_out(lines)})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
