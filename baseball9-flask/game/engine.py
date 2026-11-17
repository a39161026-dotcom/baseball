"""투구 단위 야구 엔진 (Java GameEngine 포팅). UI와 무관하게 동작합니다.

- step(): 투구 1구 (도루·번트·고의4구 등 선행 처리 포함)
- 감독 지시는 다음 투구 전에 반영됩니다.
- needs_decision(): 감독 판단이 필요한 타석 시작 시점인지 알려줍니다.
"""
import random

from . import commentary as C
from .models import Player, PitcherLine, GameState, clamp

DIFFICULTY = {"EASY": (0.82, "쉬움"), "NORMAL": (1.0, "보통"), "HARD": (1.18, "어려움")}
PITCH_CALLS = {"AUTO": "자동", "FASTBALL": "직구 위주", "BREAKING": "변화구 위주", "WASTE": "유인구(볼 유도)"}

# 진행 단위
MODE_PITCH, MODE_AT_BAT, MODE_HALF, MODE_GAME = "PITCH", "AT_BAT", "HALF_INNING", "GAME"


class StepResult:
    def __init__(self):
        self.lines = []            # [(kind, text)]
        self.at_bat_ended = False
        self.inning_changed = False
        self.game_over = False

    def add(self, kind, text):
        self.lines.append((kind, text))

    def merge(self, o):
        self.lines.extend(o.lines)
        self.at_bat_ended |= o.at_bat_ended
        self.inning_changed |= o.inning_changed
        self.game_over |= o.game_over


def _fallback_pitcher():
    return Player("대체 투수", "RP", "국내", 27, 55, 55, 1.0, 1, "-", 2024)


class GameEngine:
    def __init__(self, gs: GameState, seed=None, difficulty="NORMAL"):
        self.gs = gs
        self.rng = random.Random(seed)
        self.difficulty = difficulty
        self.pitch_call = "AUTO"
        self.pending_bunt = False
        self.pending_steal = -1
        self.pending_ibb = False
        self.queue = []
        self.at_bat_fresh = True
        self.decision_ack = False

        mine, theirs = gs.mine, gs.theirs
        for p in mine.lineup:
            p.set_hp(max(40, 100 - p.fatigue))
        if mine.pitcher is None:
            mine.pitcher = _fallback_pitcher()
        if theirs.pitcher is None:
            theirs.pitcher = _fallback_pitcher()
        self._introduce_pitcher(mine, mine.pitcher)
        self._introduce_pitcher(theirs, theirs.pitcher)
        mine.start_inning(1)
        self.queue.append(("NEUTRAL", C.game_start(gs)))

    # ── 기본 유틸 ─────────────────────────────────────────
    @property
    def opp_mult(self):
        return DIFFICULTY[self.difficulty][0]

    def _introduce_pitcher(self, t, p):
        p.set_hp(max(40, 100 - p.fatigue))
        t.pitcher = p
        t.pitcher_lines.append(PitcherLine(p))

    def drain_queue(self):
        out, self.queue = self.queue, []
        return out

    def needs_decision(self):
        gs = self.gs
        if gs.done or not self.at_bat_fresh or self.decision_ack:
            return False
        if gs.top:
            return gs.has_runners()
        p = gs.mine.pitcher
        return p is not None and p.hp < 45 and len(gs.mine.bullpen()) > 0

    def ack_decision(self):
        self.decision_ack = True

    def run(self, mode, stop_at_decision=False):
        all_ = StepResult()
        guard = 0
        while True:
            if stop_at_decision and self.needs_decision():
                break
            r = self.step()
            all_.merge(r)
            if r.game_over:
                break
            if mode == MODE_PITCH:
                break
            if mode == MODE_AT_BAT and r.at_bat_ended:
                break
            if mode == MODE_HALF and r.inning_changed:
                break
            guard += 1
            if guard >= 5000:
                break
        return all_

    # ── 진행 ──────────────────────────────────────────────
    def step(self):
        r = StepResult()
        gs = self.gs
        if gs.done:
            r.game_over = True
            return r
        for kind, text in self.queue:
            r.add(kind, text)
        self.queue = []

        off, dfn = gs.offense(), gs.defense()
        mine_bat = gs.top

        # (1) 상대 AI 투수 교체 (우리 공격 타석 시작)
        if self.at_bat_fresh and mine_bat:
            self._ai_pitcher_check(r)

        # (2) 타석 안내
        if self.at_bat_fresh:
            r.add("NEUTRAL", C.at_bat_intro(gs, off.current_batter(), dfn.pitcher, mine_bat))

        # (3) 고의4구
        if self.at_bat_fresh and mine_bat and self._ai_wants_ibb(off):
            r.add("MANAGER", C.ai_ibb())
            self._walk_and_end(r, off, dfn, True)
            self._finish(r)
            return r
        if not mine_bat and self.pending_ibb:
            self.pending_ibb = False
            r.add("MANAGER", "🚫 고의4구 지시")
            self._walk_and_end(r, off, dfn, True)
            self._finish(r)
            return r

        # (4) 도루
        if mine_bat and self.pending_steal >= 0:
            frm, self.pending_steal = self.pending_steal, -1
            r.add("MANAGER", "🏃 도루 사인!")
            self._attempt_steal(r, off, dfn, frm)
        elif not mine_bat:
            frm = self._ai_steal_base()
            if frm >= 0:
                self._attempt_steal(r, off, dfn, frm)
        if gs.outs >= 3:
            self._finish(r)
            return r

        # (5) 번트
        if mine_bat:
            bunt = self.pending_bunt
            self.pending_bunt = False
        else:
            bunt = self.at_bat_fresh and self._ai_wants_bunt(off.current_batter())
        if bunt:
            r.add("MANAGER", C.ai_bunt() if not mine_bat else "🥎 번트 사인 실행!")
            ended = self._do_bunt(r, off, dfn, off.current_batter())
            self.at_bat_fresh = False
            if ended:
                self._end_at_bat(r, off)
            self._finish(r)
            return r

        # (6) 투구
        batter = off.current_batter()
        pitcher = dfn.pitcher
        line = dfn.current_line()
        b_ovr = batter.eff_ovr
        if not mine_bat:
            b_ovr = int(b_ovr * self.opp_mult)
        p_ovr = self._pitcher_eff(pitcher)
        call = "AUTO" if mine_bat else self.pitch_call

        pitch = self._throw_pitch(b_ovr, p_ovr, call)
        self.at_bat_fresh = False
        line.add_pitch(0.6 if pitcher.pos == "SP" else 1.2)
        gs.pitch_total += 1

        if pitch == "BALL":
            gs.balls += 1
            r.add("PITCH", C.ball(self.rng) + self._count())
            if gs.balls >= 4:
                self._walk(r, off, dfn, batter, False)
                self._end_at_bat(r, off)
        elif pitch in ("WHIFF", "CALLED"):
            gs.strikes += 1
            text = C.whiff(self.rng) if pitch == "WHIFF" else C.called(self.rng)
            r.add("PITCH", text + self._count())
            if gs.strikes >= 3:
                self._strikeout(r, dfn, batter, pitch == "CALLED")
                self._end_at_bat(r, off)
        elif pitch == "FOUL":
            if gs.strikes < 2:
                gs.strikes += 1
            r.add("PITCH", C.foul(self.rng) + self._count())
        else:  # IN_PLAY
            self._contact(r, off, dfn, batter, b_ovr, p_ovr, call)
            self._end_at_bat(r, off)

        self._finish(r)
        return r

    def _count(self):
        return f"  [{self.gs.balls}-{self.gs.strikes}]"

    # ── 투구 결정 ─────────────────────────────────────────
    def _pitcher_eff(self, p):
        if p is None:
            return 50
        base = p.eff_ovr
        pen = min(15, (60 - p.hp) // 4) if p.hp < 60 else 0
        return max(30, base - pen)

    @staticmethod
    def _call_mods(call):
        return {"FASTBALL": (-0.04, -0.02, 0.03),
                "BREAKING": (0.02, 0.08, -0.03),
                "WASTE": (0.10, 0.06, -0.05)}.get(call, (0.0, 0.0, 0.0))

    def _throw_pitch(self, b_ovr, p_ovr, call):
        sp = (p_ovr - 50) / 50.0
        sb = (b_ovr - 50) / 50.0
        m = self._call_mods(call)
        p_ball = clamp(0.34 - 0.06 * sp + 0.02 * sb + m[0], 0.15, 0.50)
        if self.rng.random() < p_ball:
            return "BALL"
        two_strike = 0.10 if self.gs.strikes >= 2 else 0.0
        w = clamp(0.28 + 0.10 * sp - 0.07 * sb + m[1] + two_strike, 0.08, 0.50)
        f = clamp(0.30 - 0.02 * sb, 0.20, 0.38)
        c = 0.10
        tot = w + f + c
        if tot > 0.95:
            k = 0.95 / tot
            w, f, c = w * k, f * k, c * k
        q = self.rng.random()
        if q < w:
            return "WHIFF"
        if q < w + f:
            return "FOUL"
        if q < w + f + c:
            return "CALLED"
        return "IN_PLAY"

    # ── 타구 ──────────────────────────────────────────────
    def _contact(self, r, off, dfn, batter, b_ovr, p_ovr, call):
        sb = (b_ovr - 50) / 50.0
        sp = (p_ovr - 50) / 50.0
        hit_p = clamp(0.33 + 0.20 * sb - 0.15 * sp + self._call_mods(call)[2], 0.12, 0.55)
        u = self.rng.random()
        ct = "GROUND" if u < 0.44 else ("FLY" if u < 0.84 else "LINE")
        is_hit = self.rng.random() < hit_p
        if not is_hit:
            if ct == "GROUND":
                self._ground_out(r, off, dfn, batter)
            elif ct == "FLY":
                self._fly_out(r, off, dfn, batter)
            else:
                self._add_outs(dfn, 1)
                r.add("OUT", C.line_out())
            return
        hr = clamp(0.18 + 0.14 * sb - 0.05 * sp, 0.05, 0.35)
        v = self.rng.random()
        if ct == "GROUND":
            kind = "SINGLE" if v < 0.92 else "DOUBLE"
        elif v < hr:
            kind = "HOMER"
        elif v < hr + 0.25:
            kind = "DOUBLE"
        elif v < hr + 0.28:
            kind = "TRIPLE"
        else:
            kind = "SINGLE"
        self._hit(r, off, dfn, batter, kind)

    def _hit(self, r, off, dfn, batter, kind):
        if kind == "SINGLE":
            adv = [2 if self.rng.random() < 0.25 else 1, 2 if self.rng.random() < 0.55 else 1, 1]
            batter_adv = 1
        elif kind == "DOUBLE":
            adv = [3 if self.rng.random() < 0.40 else 2, 2, 1]
            batter_adv = 2
        elif kind == "TRIPLE":
            adv, batter_adv = [3, 2, 1], 3
        else:
            adv, batter_adv = [3, 2, 1], 4
        scorers = self._advance(adv, batter, batter_adv)
        off.hits += 1
        dfn.current_line().hits += 1
        r.add("HIT", C.hit(kind, self.rng, batter))
        if kind == "HOMER" and self.rng.random() < 0.5:
            r.add("COLOR", C.color_homer())
        self._score_runs(r, scorers)

    def _advance(self, adv, batter, batter_adv):
        old = self.gs.runners
        nb = [None, None, None]
        scored = []
        for i in (2, 1, 0):
            if old[i] is None:
                continue
            base = i + 1
            target = base + adv[i]
            if target >= 4:
                scored.append(old[i])
                continue
            while target > base and nb[target - 1] is not None:
                target -= 1
            nb[target - 1] = old[i]
        if batter_adv >= 4:
            scored.append(batter)
        elif batter_adv > 0:
            t = batter_adv
            while t > 1 and nb[t - 1] is not None:
                t -= 1
            nb[t - 1] = batter
        self.gs.runners = nb
        return scored

    def _ground_out(self, r, off, dfn, batter):
        rn = self.gs.runners
        before = self.gs.outs
        if rn[0] is not None and before <= 1 and self.rng.random() < 0.40:       # 병살
            runner = rn[0]
            rn[0] = None
            self._add_outs(dfn, 2)
            scorers = []
            if before == 0 and rn[2] is not None:
                scorers.append(rn[2])
                rn[2] = None
            if rn[1] is not None and rn[2] is None:
                rn[2], rn[1] = rn[1], None
            r.add("OUT", C.double_play(batter, runner))
            self._score_runs(r, scorers)
            return
        if rn[0] is not None and rn[1] is None and before <= 1 and self.rng.random() < 0.35:  # 야수선택
            rn[0] = batter
            self._add_outs(dfn, 1)
            r.add("OUT", C.fielders_choice(batter))
            return
        self._add_outs(dfn, 1)
        scorers = []
        if rn[2] is not None and before < 2 and self.rng.random() < 0.10:
            scorers.append(rn[2])
            rn[2] = None
        if rn[1] is not None and rn[2] is None and self.rng.random() < 0.25:
            rn[2], rn[1] = rn[1], None
        if rn[0] is not None and rn[1] is None and self.rng.random() < 0.20:
            rn[1], rn[0] = rn[0], None
        r.add("OUT", C.ground_out(self.rng))
        self._score_runs(r, scorers)

    def _fly_out(self, r, off, dfn, batter):
        rn = self.gs.runners
        before = self.gs.outs
        self._add_outs(dfn, 1)
        if rn[2] is not None and before < 2 and self.rng.random() < 0.55:
            runner = rn[2]
            rn[2] = None
            r.add("OUT", C.sac_fly(runner))
            self._score_runs(r, [runner])
            return
        r.add("OUT", C.fly_out(self.rng))

    def _walk(self, r, off, dfn, batter, intentional):
        rn = self.gs.runners
        scorers = []
        if rn[0] is None:
            rn[0] = batter
        elif rn[1] is None:
            rn[1], rn[0] = rn[0], batter
        elif rn[2] is None:
            rn[2], rn[1], rn[0] = rn[1], rn[0], batter
        else:
            scorers.append(rn[2])
            rn[2], rn[1], rn[0] = rn[1], rn[0], batter
        dfn.current_line().walks += 1
        r.add("WALK", C.intentional_walk(batter) if intentional else C.walk(batter))
        self._score_runs(r, scorers)

    def _walk_and_end(self, r, off, dfn, intentional):
        self._walk(r, off, dfn, off.current_batter(), intentional)
        self._end_at_bat(r, off)

    def _strikeout(self, r, dfn, batter, was_called):
        self._add_outs(dfn, 1)
        dfn.current_line().strikeouts += 1
        r.add("OUT", C.strikeout(self.rng, batter, was_called))

    def _attempt_steal(self, r, off, dfn, frm):
        rn = self.gs.runners
        to = frm + 1
        if frm < 0 or frm > 1 or rn[frm] is None or rn[to] is not None:
            return
        runner = rn[frm]
        p = clamp(0.50 + (runner.eff_ovr - 60) * 0.012, 0.35, 0.90)
        rn[frm] = None
        if self.rng.random() < p:
            rn[to] = runner
            r.add("STEAL", C.steal_safe(runner, to + 1))
        else:
            self._add_outs(dfn, 1)
            r.add("STEAL", C.steal_out(runner))

    def _do_bunt(self, r, off, dfn, batter):
        """번트. True 를 반환하면 타석 종료"""
        rn = self.gs.runners
        u = self.rng.random()
        dfn.current_line().add_pitch(1.2)
        self.gs.pitch_total += 1
        if u < 0.68:                                   # 희생번트 성공
            before = self.gs.outs
            self._add_outs(dfn, 1)
            scorers = [rn[2]] if rn[2] is not None else []
            if before >= 2:
                scorers = []
            self.gs.runners = [None, rn[0], rn[1]]
            r.add("OUT", C.sac_bunt(batter))
            self._score_runs(r, scorers)
            return True
        if u < 0.78:                                   # 번트 안타
            self._hit(r, off, dfn, batter, "SINGLE")
            return True
        if u < 0.88:                                   # 번트 파울 = 스트라이크
            self.gs.strikes += 1
            r.add("PITCH", C.bunt_foul() + self._count())
            if self.gs.strikes >= 3:
                self._strikeout(r, dfn, batter, False)
                return True
            return False
        self._add_outs(dfn, 1)                         # 번트 팝업
        r.add("OUT", C.bunt_pop())
        return True

    def _add_outs(self, dfn, n):
        self.gs.outs += n
        dfn.current_line().outs += n

    def _score_runs(self, r, scorers):
        if not scorers:
            return
        off, dfn = self.gs.offense(), self.gs.defense()
        n = len(scorers)
        off.score += n
        off.add_inning_runs(self.gs.inning, n)
        dfn.current_line().runs += n
        names = ", ".join(p.name for p in scorers)
        r.add("SCORE", C.score_line(names, self.gs))
        if self.gs.inning >= 8 and self.rng.random() < 0.4:
            r.add("COLOR", C.color_risp())

    # ── 흐름 ──────────────────────────────────────────────
    def _end_at_bat(self, r, off):
        off.advance_batter()
        self.gs.balls = 0
        self.gs.strikes = 0
        self.at_bat_fresh = True
        self.decision_ack = False
        self.pending_bunt = False
        self.pending_ibb = False
        self.pending_steal = -1
        r.at_bat_ended = True

    def _finish(self, r):
        gs = self.gs
        if gs.done:
            return
        if gs.outs >= 3:
            self._change_half(r)
        if not gs.done and gs.inning >= 9 and not gs.top and gs.theirs.score > gs.mine.score:
            self._end_game(r)                           # 9회 이후 말 공격 끝내기 = 즉시 종료

    def _change_half(self, r):
        gs = self.gs
        gs.outs = gs.balls = gs.strikes = 0
        gs.runners = [None, None, None]
        self.pending_bunt = False
        self.pending_steal = -1
        self.pending_ibb = False
        self.decision_ack = False
        self.at_bat_fresh = True
        if gs.top:
            gs.top = False
            gs.theirs.start_inning(gs.inning)
            r.add("INNING", C.bottom_start(gs))
        else:
            if gs.inning >= 9 and gs.mine.score != gs.theirs.score:
                self._end_game(r)
                return
            gs.inning += 1
            gs.top = True
            gs.mine.start_inning(gs.inning)
            r.add("INNING", C.top_start(gs))
        r.inning_changed = True

    def _end_game(self, r):
        self.gs.done = True
        r.game_over = True
        r.add("END", C.game_end(self.gs))

    # ── AI 감독 ───────────────────────────────────────────
    def _ai_pitcher_check(self, r):
        t = self.gs.theirs
        p = t.pitcher
        line = t.current_line()
        if p is None or line is None:
            return
        if not (p.hp <= 35 or line.pitches >= 100):
            return
        bullpen = t.bullpen()
        if not bullpen:
            return
        nxt = max(bullpen, key=lambda c: c.eff_ovr)
        r.add("MANAGER", C.ai_pitcher_change(p, nxt))
        self._introduce_pitcher(t, nxt)

    def _ai_wants_ibb(self, off):
        if self.gs.runners[0] is not None or self.gs.outs >= 2:
            return False
        b, nb = off.current_batter(), off.next_batter()
        return (b is not None and nb is not None and b.eff_ovr >= 80 and nb.eff_ovr < 68
                and self.rng.random() < 0.35)

    def _ai_wants_bunt(self, batter):
        return (self.gs.runners[0] is not None and self.gs.outs == 0 and batter is not None
                and batter.eff_ovr < 62 and self.rng.random() < 0.30)

    def _ai_steal_base(self):
        rn = self.gs.runners
        if self.gs.outs >= 2:
            return -1
        if rn[0] is not None and rn[1] is None and rn[0].eff_ovr >= 60 and self.rng.random() < 0.05:
            return 0
        if rn[1] is not None and rn[2] is None and rn[1].eff_ovr >= 60 and self.rng.random() < 0.02:
            return 1
        return -1

    # ── 감독 지시 (사용자) ────────────────────────────────
    def can_bunt(self):
        return not self.gs.done and self.gs.top and not self.pending_bunt

    def request_bunt(self):
        if not self.can_bunt():
            return False
        self.pending_bunt = True
        self.queue.append(("MANAGER", "🥎 번트 사인! 다음 투구에 번트를 댑니다"))
        return True

    def stealable_bases(self):
        gs = self.gs
        if gs.done or not gs.top or self.pending_steal >= 0:
            return []
        rn = gs.runners
        out = []
        if rn[0] is not None and rn[1] is None:
            out.append(0)
        if rn[1] is not None and rn[2] is None:
            out.append(1)
        return out

    def request_steal(self, frm):
        if frm not in self.stealable_bases():
            return False
        self.pending_steal = frm
        self.queue.append(("MANAGER", f"🏃 도루 사인! {self.gs.runners[frm].name} 다음 투구에 스타트"))
        return True

    def can_ibb(self):
        return not self.gs.done and not self.gs.top and self.gs.runners[0] is None and not self.pending_ibb

    def request_ibb(self):
        if not self.can_ibb():
            return False
        self.pending_ibb = True
        self.queue.append(("MANAGER", "🚫 고의4구 지시! 1루를 비웁니다"))
        return True

    def request_pinch_hit(self, sub):
        gs = self.gs
        if gs.done or not gs.top or not any(sub is p for p in gs.mine.bench()):
            return False
        t = gs.mine
        old = t.current_batter()
        t.lineup[t.current_slot] = sub
        gs.balls = gs.strikes = 0
        self.at_bat_fresh = True
        self.pending_bunt = False
        self.queue.append(("MANAGER", C.pinch_hit(old, sub)))
        return True

    def request_pinch_run(self, base, sub):
        gs = self.gs
        if gs.done or not gs.top or base not in (0, 1, 2):
            return False
        t = gs.mine
        old = gs.runners[base]
        if old is None or not any(sub is p for p in t.bench()):
            return False
        idx = next((i for i, p in enumerate(t.lineup) if p is old), -1)
        if idx < 0:
            return False
        t.lineup[idx] = sub
        gs.runners[base] = sub
        self.queue.append(("MANAGER", C.pinch_run(old, sub, base + 1)))
        return True

    def request_pitcher_change(self, nxt):
        gs = self.gs
        if gs.done or gs.top:
            return False
        t = gs.mine
        if not any(nxt is p for p in t.bullpen()):
            return False
        old = t.pitcher
        self._introduce_pitcher(t, nxt)
        self.queue.append(("MANAGER", C.pitcher_change(old, nxt)))
        return True

    def set_pitch_call(self, call):
        if call in PITCH_CALLS:
            self.pitch_call = call
            return True
        return False
