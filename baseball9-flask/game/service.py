"""게임 서비스 (Flask 없이 동작). 서버(app.py)와 브라우저(Pyodide) 양쪽에서 같은 코드를 씁니다.

dispatch(method, path, body) -> (status_code, payload_dict)
"""
import random
import threading
import uuid

from .engine import DIFFICULTY, PITCH_CALLS, GameEngine, MODE_AT_BAT, MODE_GAME, MODE_HALF, MODE_PITCH
from .league import (apply_post_game_fatigue, build_all_players, build_auto_roster, build_opp_roster,
                     opponent_names, update_daily_condition)
from .models import GameState, POS_LABEL

LOCK = threading.Lock()


class League:
    """내 팀 + 전적 (Java GameManager 의 역할)"""

    def __init__(self):
        self.all_players = build_all_players()
        self.team_name = "나의 팀"
        self.roster = []
        self.wins = 0
        self.losses = 0
        self.recent = []
        self.reset(75, 85)

    def reset(self, min_ovr, max_ovr):
        self.roster = build_auto_roster(self.all_players, min_ovr, max_ovr)
        self.wins = self.losses = 0
        self.recent = []
        update_daily_condition(self.roster)


LEAGUE = League()
GAMES = {}


class Game:
    def __init__(self, gid, gs, engine, opp_roster):
        self.id = gid
        self.gs = gs
        self.engine = engine
        self.opp_roster = opp_roster
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
    return list(team.runs_by_inning) + [None] * (cols - len(team.runs_by_inning))


def state_dict(game):
    gs, eng = game.gs, game.engine
    mine, theirs = gs.mine, gs.theirs
    cols = max(9, len(mine.runs_by_inning), len(theirs.runs_by_inning))
    cur_slot = mine.current_slot if gs.top else -1
    batter = gs.offense().current_batter()
    needs = eng.needs_decision()
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
        "needsDecision": needs,
        "decisionKind": ("offense" if gs.top else "defense") if needs else None,
        "stealable": eng.stealable_bases(),
        "canBunt": eng.can_bunt(),
        "canIbb": eng.can_ibb(),
        "bench": [player_dict(p) for p in mine.bench()] if gs.top and not gs.done else [],
        "bullpen": [player_dict(p) for p in mine.bullpen()] if not gs.top and not gs.done else [],
        "pitchCall": eng.pitch_call,
        "pitchCalls": [{"id": k, "label": v} for k, v in PITCH_CALLS.items()],
        "record": {"wins": LEAGUE.wins, "losses": LEAGUE.losses},
        "defending": gs.defense().name,
    }
    if gs.done:
        d["box"] = {
            "mine": [player_dict(l.pitcher, l) for l in mine.pitcher_lines],
            "theirs": [player_dict(l.pitcher, l) for l in theirs.pitcher_lines],
        }
    return d


def lines_out(lines):
    return [{"kind": k, "text": t} for k, t in lines]


def record_result(game):
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


def league_view():
    return {
        "teamName": LEAGUE.team_name,
        "record": {"wins": LEAGUE.wins, "losses": LEAGUE.losses},
        "roster": [p.to_dict() for p in LEAGUE.roster],
        "recent": LEAGUE.recent[-5:],
        "opponents": opponent_names(),
        "difficulties": [{"id": k, "label": v[1]} for k, v in DIFFICULTY.items()],
    }


def reset_league(body):
    lo, hi = int(body.get("minOvr", 75)), int(body.get("maxOvr", 85))
    with LOCK:
        LEAGUE.reset(lo, hi)
    return 200, league_view()


def new_game(body):
    opp = body.get("opponent") or opponent_names()[0]
    difficulty = body.get("difficulty", "NORMAL")
    if difficulty not in DIFFICULTY:
        return 400, {"error": "난이도가 올바르지 않습니다."}
    with LOCK:
        roster = LEAGUE.roster
        pitchers = [p for p in roster if p.is_pitcher]
        if not pitchers:
            return 400, {"error": "투수가 1명 이상 필요합니다."}

        ids = body.get("lineup")
        if ids:
            lineup = [find_player(roster, i) for i in ids]
            if len(lineup) != 9 or any(p is None or p.is_pitcher for p in lineup):
                return 400, {"error": "타순은 야수 9명이어야 합니다."}
        else:
            lineup = sorted((p for p in roster if not p.is_pitcher), key=lambda p: -p.eff_ovr)[:9]
        if len(lineup) < 9:
            return 400, {"error": "타순은 야수 9명이 필요합니다."}

        starter = find_player(roster, body.get("starter")) if body.get("starter") else None
        if starter is None or not starter.is_pitcher:
            starter = min(pitchers, key=lambda p: (p.pos != "SP", p.fatigue))

        opp_roster = build_opp_roster(LEAGUE.all_players, {p.id for p in roster}, random)
        opp_lineup = sorted((p for p in opp_roster if not p.is_pitcher), key=lambda p: -p.ovr)[:9]
        if len(opp_lineup) < 9:
            return 400, {"error": "상대 팀 타자가 부족합니다."}
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
        game = Game(uuid.uuid4().hex[:10], gs, engine, opp_roster)
        GAMES[game.id] = game
        start_lines = engine.drain_queue()
        return 200, {"state": state_dict(game), "lines": lines_out(start_lines)}


def advance(gid, body):
    g = GAMES.get(gid)
    if g is None:
        return 404, {"error": "경기를 찾을 수 없습니다."}
    mode = {"pitch": MODE_PITCH, "atbat": MODE_AT_BAT, "inning": MODE_HALF, "game": MODE_GAME}.get(
        body.get("mode"), MODE_PITCH)
    stop = bool(body.get("stopAtDecision"))
    with LOCK:
        if body.get("ack"):
            g.engine.ack_decision()
        if g.gs.done:
            return 200, {"state": state_dict(g), "lines": [], "paused": False}
        if stop and g.engine.needs_decision():
            return 200, {"state": state_dict(g), "lines": [], "paused": True}
        res = g.engine.run(mode, stop_at_decision=stop)
        lines = g.engine.drain_queue()
        if res.game_over:
            record_result(g)
        return 200, {"state": state_dict(g), "lines": lines_out(lines + res.lines), "paused": False,
                     "gameOver": res.game_over}


def order(gid, body):
    g = GAMES.get(gid)
    if g is None:
        return 404, {"error": "경기를 찾을 수 없습니다."}
    kind = body.get("type")
    eng, gs = g.engine, g.gs
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
            return 400, {"error": "알 수 없는 지시입니다."}
        lines = eng.drain_queue()
    if not ok:
        return 409, {"error": "지금은 이 지시를 낼 수 없습니다.", "state": state_dict(g)}
    return 200, {"state": state_dict(g), "lines": lines_out(lines)}


def dispatch(method, path, body=None):
    """경로와 메서드에 맞춰 처리. 반환: (상태코드, 응답 dict)"""
    body = body or {}
    parts = [p for p in path.split("/") if p]          # ['api', 'game', <gid>, 'advance']
    if parts[:1] != ["api"]:
        return 404, {"error": "not found"}
    if method == "GET" and parts == ["api", "league"]:
        return 200, league_view()
    if method == "POST" and parts == ["api", "league", "reset"]:
        return reset_league(body)
    if method == "POST" and parts == ["api", "game"]:
        return new_game(body)
    if len(parts) >= 3 and parts[1] == "game":
        gid = parts[2]
        if method == "GET" and len(parts) == 3:
            g = GAMES.get(gid)
            if g is None:
                return 404, {"error": "경기를 찾을 수 없습니다."}
            return 200, {"state": state_dict(g), "lines": []}
        if method == "POST" and len(parts) == 4 and parts[3] == "advance":
            return advance(gid, body)
        if method == "POST" and len(parts) == 4 and parts[3] == "order":
            return order(gid, body)
    return 404, {"error": "not found"}
