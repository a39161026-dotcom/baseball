import random

import pytest

from game.engine import GameEngine, MODE_GAME, MODE_PITCH
from game.models import GameState, Player


def mk(name, pos, ovr, fatigue=0):
    p = Player(name, pos, "국내", 27, ovr, ovr, 1.0, 1, "T", 2024)
    p.set_fatigue(fatigue)
    return p


def new_game(ovr=75, seed=None):
    pos = ["C", "1B", "2B", "3B", "SS", "OF", "OF", "OF", "DH", "DH"]
    gs = GameState("우리", "상대")
    mine = [mk(f"우리{i}", p, ovr) for i, p in enumerate(pos)]
    theirs = [mk(f"상대{i}", p, ovr) for i, p in enumerate(pos)]
    mine += [mk("우리SP", "SP", ovr), mk("우리RP1", "RP", ovr), mk("우리RP2", "RP", ovr)]
    theirs += [mk("상대SP", "SP", ovr), mk("상대RP1", "RP", ovr), mk("상대RP2", "RP", ovr)]
    gs.mine.lineup = mine[:9]
    gs.mine.roster = mine
    gs.mine.pitcher = mine[10]
    gs.theirs.lineup = theirs[:9]
    gs.theirs.roster = theirs
    gs.theirs.pitcher = theirs[10]
    return gs, GameEngine(gs, seed=seed)


def test_outs_and_runners_stay_valid_and_games_finish_without_ties():
    for g in range(60):
        gs, e = new_game(75, seed=g)
        guard = 0
        while not gs.done and guard < 20000:
            guard += 1
            if e.needs_decision():
                e.ack_decision()
            e.step()
            assert 0 <= gs.outs <= 2
            rn = [r for r in gs.runners if r is not None]
            assert len(rn) == len({id(r) for r in rn}), "같은 선수가 두 베이스에 있음"
        assert gs.done
        assert gs.mine.score != gs.theirs.score


def test_run_to_end_reports_game_over():
    gs, e = new_game(80, seed=1)
    r = e.run(MODE_GAME)
    assert r.game_over and gs.done and gs.inning >= 9


def test_intentional_walk_with_first_base_empty_does_not_push_runners():
    gs, e = new_game(70, seed=3)
    gs.top = False
    second, third = gs.theirs.lineup[1], gs.theirs.lineup[2]
    gs.runners = [None, second, third]
    e = GameEngine(gs, seed=3)
    assert e.can_ibb()
    assert e.request_ibb()
    before = gs.theirs.score
    r = e.step()
    assert r.at_bat_ended
    assert gs.theirs.score == before
    assert gs.runners[0] is not None
    assert gs.runners[1] is second and gs.runners[2] is third


def test_steal_log_matches_runner_name():
    for g in range(40):
        gs, e = new_game(72, seed=100 + g)
        runner = None
        guard = 0
        while runner is None and guard < 500 and not gs.done:
            guard += 1
            e.run(MODE_PITCH)
            if gs.top and gs.runners[0] is not None and gs.runners[1] is None:
                runner = gs.runners[0]
        if runner is None:
            continue
        assert e.request_steal(0)
        r = e.step()
        texts = [t for _, t in r.lines if t.startswith("도루")]
        assert len(texts) == 1
        assert runner.name in texts[0]
        assert ("도루 성공" in texts[0]) != ("도루 실패" in texts[0])


def test_pinch_hit_replaces_current_batter():
    gs, e = new_game(75, seed=5)
    bench = mk("대타", "OF", 80)
    gs.mine.roster.append(bench)
    old = gs.mine.current_batter()
    assert e.request_pinch_hit(bench)
    assert gs.mine.current_batter() is bench
    assert all(p is not old for p in gs.mine.lineup)


def test_pitcher_change_uses_bullpen_and_removes_from_bullpen():
    gs, e = new_game(75, seed=6)
    gs.top = False
    rp = gs.mine.roster[11]
    assert any(rp is p for p in gs.mine.bullpen())
    assert e.request_pitcher_change(rp)
    assert gs.mine.pitcher is rp
    assert len(gs.mine.pitcher_lines) == 2
    assert not any(rp is p for p in gs.mine.bullpen())


def test_pitcher_change_rejects_starter():
    gs, e = new_game(75, seed=7)
    gs.top = False
    assert not e.request_pitcher_change(gs.mine.pitcher)


def test_decision_point_with_runners_and_ack():
    gs, e = new_game(75, seed=8)
    gs.runners[0] = gs.mine.lineup[0]
    assert e.needs_decision()
    e.ack_decision()
    assert not e.needs_decision()


def test_run_with_stop_at_decision_does_not_pitch():
    gs, e = new_game(75, seed=9)
    gs.runners[1] = gs.mine.lineup[0]
    before = gs.pitch_total
    e.run(MODE_PITCH, stop_at_decision=True)
    assert gs.pitch_total == before


def test_drain_queue_returns_start_line_once():
    gs, e = new_game(75, seed=10)
    lines = e.drain_queue()
    assert lines and "플레이 볼" in lines[0][1]
    assert e.drain_queue() == []
