"""경기 데이터 모델 (Java model 패키지 대응)."""
import uuid

PITCHER_POS = ("SP", "RP")
POS_LABEL = {"SP": "선발투수", "RP": "불펜투수", "C": "포수", "1B": "1루수", "2B": "2루수",
             "3B": "3루수", "SS": "유격수", "OF": "외야수", "DH": "지명타자"}


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def condition_of(fatigue):
    """피로도 -> (라벨, 이모지, OVR 보정)"""
    if fatigue <= 15:
        return ("최상", "🔥", 5)
    if fatigue <= 35:
        return ("좋음", "😊", 2)
    if fatigue <= 60:
        return ("보통", "😐", 0)
    if fatigue <= 80:
        return ("나쁨", "😞", -3)
    return ("부진", "💀", -7)


class Player:
    def __init__(self, name, pos, league, age, ovr, potential, salary, contract, team, era):
        self.id = uuid.uuid4().hex[:8]
        self.name = name
        self.pos = pos
        self.league = league
        self.age = age
        self.ovr = ovr
        self.potential = potential
        self.salary = salary
        self.contract = contract
        self.team = team
        self.era = era
        self.fatigue = 0      # 0~100 (경기 간 누적)
        self.hp = 100         # 경기 중 체력
        self.injury = False

    @property
    def is_pitcher(self):
        return self.pos in PITCHER_POS

    @property
    def condition(self):
        return condition_of(self.fatigue)

    @property
    def eff_ovr(self):
        return min(99, max(40, self.ovr + self.condition[2]))

    def set_fatigue(self, v):
        self.fatigue = clamp(int(v), 0, 100)

    def set_hp(self, v):
        self.hp = clamp(int(v), 0, 100)

    def to_dict(self):
        return {"id": self.id, "name": self.name, "pos": self.pos, "ovr": self.ovr,
                "effOvr": self.eff_ovr, "fatigue": self.fatigue, "hp": self.hp,
                "condition": self.condition[0], "team": self.team, "league": self.league}


class PitcherLine:
    """투수 한 명의 경기 기록 + 이번 경기 체력 소모"""

    def __init__(self, pitcher):
        self.pitcher = pitcher
        self.entry_hp = pitcher.hp
        self.stamina = 0.0
        self.pitches = 0
        self.outs = 0
        self.hits = 0
        self.runs = 0
        self.walks = 0
        self.strikeouts = 0

    def add_pitch(self, drain):
        self.pitches += 1
        self.stamina += drain
        self.pitcher.set_hp(self.entry_hp - round(self.stamina))

    @property
    def innings_text(self):
        return f"{self.outs // 3}.{self.outs % 3}"


class TeamState:
    def __init__(self, name, user):
        self.name = name
        self.user = user
        self.lineup = []
        self.roster = []
        self.batter_idx = 0
        self.pitcher = None
        self.pitcher_lines = []
        self.runs_by_inning = []     # None = 아직 공격 안 함
        self.score = 0
        self.hits = 0

    @property
    def current_slot(self):
        return self.batter_idx % len(self.lineup) if self.lineup else 0

    def current_batter(self):
        return self.lineup[self.current_slot] if self.lineup else None

    def next_batter(self):
        return self.lineup[(self.current_slot + 1) % len(self.lineup)] if self.lineup else None

    def advance_batter(self):
        self.batter_idx += 1

    def current_line(self):
        return self.pitcher_lines[-1] if self.pitcher_lines else None

    def bench(self):
        return [p for p in self.roster if not p.is_pitcher and not any(p is q for q in self.lineup)]

    def bullpen(self):
        out = []
        for p in self.roster:
            if not p.is_pitcher or p is self.pitcher:
                continue
            if any(l.pitcher is p for l in self.pitcher_lines):
                continue
            out.append(p)
        return out

    def start_inning(self, inning):
        while len(self.runs_by_inning) < inning:
            self.runs_by_inning.append(None)
        if self.runs_by_inning[inning - 1] is None:
            self.runs_by_inning[inning - 1] = 0

    def add_inning_runs(self, inning, n):
        self.start_inning(inning)
        self.runs_by_inning[inning - 1] += n


class GameState:
    def __init__(self, my_name, opponent):
        self.opponent = opponent
        self.inning = 1
        self.top = True          # True = 우리 공격(초), False = 상대 공격(말)
        self.outs = 0
        self.balls = 0
        self.strikes = 0
        self.runners = [None, None, None]   # 1루, 2루, 3루
        self.mine = TeamState(my_name, True)
        self.theirs = TeamState(opponent, False)
        self.done = False
        self.pitch_total = 0

    def offense(self):
        return self.mine if self.top else self.theirs

    def defense(self):
        return self.theirs if self.top else self.mine

    def has_runners(self):
        return any(r is not None for r in self.runners)
