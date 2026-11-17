"""리그 관리 (Java GameManager 포팅): 선수 풀, 로스터 구성, 경기 후 피로도, 전적."""
import random

from .models import Player
from .players_data import PLAYERS, KBO_TEAMS, NPB_TEAMS, MLB_TEAMS

PITCH_POS = ("SP", "RP")
ROSTER_POS = ["SP", "SP", "RP", "RP", "RP", "C", "1B", "2B", "3B", "SS", "OF", "OF", "OF", "DH", "DH"]
OPP_POS = ["SP", "RP", "RP", "C", "1B", "2B", "3B", "SS", "OF", "OF", "OF", "DH"]


def build_all_players():
    return [Player(*row) for row in PLAYERS]


def _candidates(pool, pos, used):
    return sorted((p for p in pool if p.pos == pos and p.id not in used), key=lambda p: -p.ovr)


def _fill(result, used, pool, pitchers, count):
    have = sum(1 for p in result if p.is_pitcher == pitchers)
    if have >= count:
        return
    extra = sorted((p for p in pool if p.is_pitcher == pitchers and p.id not in used), key=lambda p: -p.ovr)
    for p in extra:
        if have >= count:
            break
        used.add(p.id)
        result.append(p)
        have += 1


def build_auto_roster(all_players, min_ovr, max_ovr, rng=random):
    """투수 5명 + 야수 10명. 범위 안 선수가 부족하면 범위 밖에서 보충."""
    in_range = [p for p in all_players if min_ovr <= p.ovr <= max_ovr]
    result, used = [], set()
    for pos in ROSTER_POS:
        cands = _candidates(in_range, pos, used) or _candidates(all_players, pos, used)
        if not cands:
            continue
        pick = cands[rng.randrange(min(3, len(cands)))]
        used.add(pick.id)
        result.append(pick)
    _fill(result, used, all_players, False, 10)
    _fill(result, used, all_players, True, 5)
    return result


def build_opp_roster(all_players, exclude_ids, rng=random):
    """상대 팀: 야수 9명 + 투수 3명 (자기 팀 선수 제외)."""
    pool = [p for p in all_players if p.id not in exclude_ids]
    result, used = [], set()
    for pos in OPP_POS:
        cands = _candidates(pool, pos, used)
        if not cands:
            continue
        pick = cands[rng.randrange(min(3, len(cands)))]
        used.add(pick.id)
        result.append(pick)
    _fill(result, used, pool, False, 9)
    _fill(result, used, pool, True, 3)
    return result


def update_daily_condition(roster, rng=random):
    for p in roster:
        p.set_fatigue(p.fatigue - rng.randrange(8) - 3)          # 자연 회복
        roll = rng.random()
        if roll < 0.04:
            p.set_fatigue(p.fatigue + rng.randrange(16) + 15)
        elif roll < 0.08:
            p.set_fatigue(p.fatigue - rng.randrange(11) - 10)


def apply_post_game_fatigue(team, rng=random):
    for p in team.lineup:
        p.set_fatigue(p.fatigue + 4 + rng.randrange(6))
    for line in team.pitcher_lines:
        p = line.pitcher
        rate = 0.25 if p.pos == "SP" else 0.40
        p.set_fatigue(p.fatigue + round(line.pitches * rate))


def opponent_names():
    return KBO_TEAMS + NPB_TEAMS + MLB_TEAMS
