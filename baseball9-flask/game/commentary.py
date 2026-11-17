"""한국어 야구 중계 멘트 (Java Commentary 대응). 같은 상황도 여러 표현 중 무작위로 고릅니다."""


def pick(rng, *xs):
    return xs[rng.randrange(len(xs))]


def nm(p):
    return "???" if p is None else p.name


def runners_text(rn):
    s = [str(i + 1) for i in range(3) if rn[i] is not None]
    if not s:
        return "주자 없음"
    if len(s) == 3:
        return "만루"
    return "·".join(s) + "루"


def situation(gs):
    return f"{gs.inning}회{'초' if gs.top else '말'} · {gs.outs}아웃 · {runners_text(gs.runners)}"


def score_text(gs):
    return f"{gs.mine.name} {gs.mine.score} : {gs.theirs.score} {gs.opponent}"


def game_start(gs):
    return (f"⚾ 플레이 볼! {gs.mine.name} vs {gs.opponent} 경기를 시작합니다. "
            f"선발 {nm(gs.mine.pitcher)} / {nm(gs.theirs.pitcher)}")


def at_bat_intro(gs, batter, pitcher, mine_bat):
    head = f"[{situation(gs)}] "
    if mine_bat:
        return (head + f"🎙 타석에 {nm(batter)} ({batter.pos}, OVR {batter.eff_ovr})! "
                f"마운드에는 {nm(pitcher)} 투수입니다.")
    return head + f"🎙 {nm(pitcher)} 투수, 상대 타자 {nm(batter)} ({batter.pos}) 상대로 승부합니다."


def top_start(gs):
    return f"▲ {gs.inning}회 초 {gs.mine.name} 공격 · {score_text(gs)}"


def bottom_start(gs):
    return f"▼ {gs.inning}회 말 {gs.opponent} 공격 · {score_text(gs)}"


def game_end(gs):
    winner = gs.mine.name if gs.mine.score > gs.theirs.score else gs.opponent
    return f"🏁 경기 종료! {winner} 승리 — 최종 {gs.mine.score} : {gs.theirs.score}"


def ball(rng):
    return pick(rng, "볼", "볼! 바깥쪽으로 빠집니다", "볼 판정, 공이 높았습니다", "공이 빠집니다, 볼")


def whiff(rng):
    return pick(rng, "헛스윙! 스트라이크", "스윙! 방망이가 공을 못 따라갑니다", "헛스윙, 빠른 승부!")


def called(rng):
    return pick(rng, "스트라이크 콜! 존 한가운데 걸쳤습니다", "꽉 찬 스트라이크 판정")


def foul(rng):
    return pick(rng, "파울, 커트해 냅니다", "파울! 방망이 끝에 걸렸습니다", "파울 — 끈질긴 승부입니다")


def bunt_foul():
    return "번트 실패, 스트라이크 판정"


def ground_out(rng):
    return pick(rng, "땅볼, 내야수가 잡아 1루에 송구... 아웃!", "내야 땅볼, 깔끔하게 처리합니다. 아웃!")


def fly_out(rng):
    return pick(rng, "뜬공, 외야수가 뒤로 물러나 잡습니다. 아웃!", "높이 뜬 공, 외야 정면에서 잡힙니다. 아웃!")


def line_out():
    return "라인드라이브! 야수 정면으로 빨려 들어갑니다. 아웃!"


def sac_fly(runner):
    return f"희생플라이! {nm(runner)} 홈으로 쇄도, 득점!"


def double_play(batter, runner):
    return f"병살타! {nm(batter)}의 땅볼, 2루를 거쳐 1루까지... {nm(runner)}과 타자 모두 아웃!"


def fielders_choice(batter):
    return f"야수 선택! 2루에서 포스아웃, {nm(batter)} 1루 세이프"


def sac_bunt(batter):
    return f"희생번트 성공! {nm(batter)} 자신을 희생하고 주자를 진루시킵니다"


def bunt_pop():
    return "번트 실패! 뜬공이 됩니다. 포수가 잡아 아웃!"


def hit(kind, rng, batter):
    if kind == "SINGLE":
        return pick(rng, f"내야를 뚫는 안타! {nm(batter)} 1루 세이프",
                    "중전 안타! 주자들이 움직입니다", "좌전 안타, 1루 베이스를 밟습니다")
    if kind == "DOUBLE":
        return pick(rng, "우익선상을 가르는 2루타!", "외야 갭을 꿰뚫는 2루타!")
    if kind == "TRIPLE":
        return "3루타! 외야가 뚫렸습니다, 세 베이스를 달립니다!"
    return pick(rng, "홈런!!! 담장을 넘어갑니다!", "쭉쭉 뻗어 나간 타구, 홈런입니다!", "홈런!! 관중석이 환호합니다!")


def walk(batter):
    return f"{nm(batter)} 볼넷, 1루로 걸어 나갑니다"


def intentional_walk(batter):
    return f"고의사구! {nm(batter)} 1루로 걸어 나갑니다"


def strikeout(rng, batter, was_called):
    if was_called:
        return pick(rng, "삼진! 존을 지나간 공에 꼼짝 못 합니다", "스트라이크 아웃, 콜 삼진!")
    return pick(rng, "삼진! 헛스윙으로 돌아섭니다", "스트라이크 아웃! 방망이 한 번 못 내밉니다")


def steal_safe(runner, to_base):
    return f"도루 성공! {nm(runner)} {to_base}루 세이프"


def steal_out(runner):
    return f"도루 실패! 포수 송구, {nm(runner)} 아웃!"


def score_line(names, gs):
    return f"🔔 득점! {names} 홈을 밟습니다 · {score_text(gs)}"


def ai_pitcher_change(old, new):
    return f"📢 상대 감독, 투수 교체: {nm(old)} → {nm(new)} 등판"


def ai_ibb():
    return "📢 상대 배터리, 고의사구를 택합니다"


def ai_bunt():
    return "📢 상대 감독, 번트 작전 사인!"


def pinch_hit(old, sub):
    return f"🔁 대타 교체: {nm(old)} → {nm(sub)} 타석에 들어섭니다"


def pinch_run(old, sub, base):
    return f"🏃 대주자 투입: {nm(old)} → {nm(sub)} ({base}루)"


def pitcher_change(old, new):
    return f"🔄 투수 교체: {nm(old)} → {nm(new)} ({new.pos})"


def color_tired(p):
    return f"💬 해설: {nm(p)} 선수 구위가 떨어졌네요. 체력이 한계에 가까워 보입니다."


def color_risp():
    return "💬 해설: 득점권 찬스! 한 점이 승부를 가를 수 있는 상황입니다."


def color_homer():
    return "💬 해설: 시원한 한 방입니다, 흐름이 확 바뀌네요."
