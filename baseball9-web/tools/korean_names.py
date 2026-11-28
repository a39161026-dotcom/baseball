"""외국인 선수 이름을 한국어로 바꾸는 도구.

우선순위: ① KBO 한글 이름(같은 사람) ② 위키데이터 한국어 표기(같은 이름·출생연도) ③ 단어 사전(위키데이터에서 배운 이름 조각)
④ 규칙 기반 음역 — 일본어(헵번 로마자 → 국립국어원 일본어 표기법), 영어·스페인어(외래어 표기 근사)
"""
import json
import os
import re
import unicodedata
from collections import Counter, defaultdict

# ── 한글 조립 ────────────────────────────────────────────────
CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"]
CONS = set(CHO)
VOWS = set(JUNG)
CODA_OK = {"ㄱ", "ㄴ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ"}


def render(blocks):
    s = []
    for c, v, f in blocks:
        s.append(chr(0xAC00 + (CHO.index(c) * 21 + JUNG.index(v)) * 28 + (JONG.index(f) if f else 0)))
    return "".join(s)


def build(units):
    """음소 리스트 → 한글. 받침 표시는 ('코다', 'ㄴ') 튜플로 명시."""
    blocks = []
    i = 0
    while i < len(units):
        u = units[i]
        if isinstance(u, tuple):                      # 명시적 받침
            if blocks and not blocks[-1][2]:
                blocks[-1][2] = u[1]
            else:
                blocks.append(["ㅇ", "ㅡ", ""])
                blocks[-1][2] = u[1]
            i += 1
            continue
        nxt = units[i + 1] if i + 1 < len(units) else None
        if u in CONS:
            if nxt in VOWS and not isinstance(nxt, tuple):
                blocks.append([u, nxt, ""])
                i += 2
            else:
                blocks.append([u, "ㅡ", ""])
                i += 1
        else:
            blocks.append(["ㅇ", u, ""])
            i += 1
    return render(blocks)


# ── 일본어 (헵번 로마자) ─────────────────────────────────────
# 어두/어중 표기가 다른 행: か·た·ち·つ 행과 きゃ류
J_BASE = {
    "a": "아", "i": "이", "u": "우", "e": "에", "o": "오",
    "ka": ("가", "카"), "ki": ("기", "키"), "ku": ("구", "쿠"), "ke": ("게", "케"), "ko": ("고", "코"),
    "sa": "사", "shi": "시", "si": "시", "su": "스", "se": "세", "so": "소",
    "ta": ("다", "타"), "chi": ("지", "치"), "ti": ("지", "치"), "tsu": ("쓰", "츠"), "tu": ("쓰", "츠"), "te": ("데", "테"), "to": ("도", "토"),
    "na": "나", "ni": "니", "nu": "누", "ne": "네", "no": "노",
    "ha": "하", "hi": "히", "fu": "후", "hu": "후", "he": "헤", "ho": "호",
    "ma": "마", "mi": "미", "mu": "무", "me": "메", "mo": "모",
    "ya": "야", "yu": "유", "yo": "요",
    "ra": "라", "ri": "리", "ru": "루", "re": "레", "ro": "로",
    "wa": "와", "wo": "오",
    "ga": "가", "gi": "기", "gu": "구", "ge": "게", "go": "고",
    "za": "자", "ji": "지", "zi": "지", "zu": "즈", "ze": "제", "zo": "조",
    "da": "다", "di": "지", "du": "즈", "de": "데", "do": "도",
    "ba": "바", "bi": "비", "bu": "부", "be": "베", "bo": "보",
    "pa": "파", "pi": "피", "pu": "푸", "pe": "페", "po": "포",
    "kya": ("갸", "캬"), "kyu": ("규", "큐"), "kyo": ("교", "쿄"),
    "sha": "샤", "shu": "슈", "sho": "쇼", "she": "셰", "sya": "샤", "syu": "슈", "syo": "쇼",
    "cha": ("자", "차"), "chu": ("주", "추"), "cho": ("조", "초"), "che": ("제", "체"),
    "tya": ("자", "차"), "tyu": ("주", "추"), "tyo": ("조", "초"),
    "ja": "자", "ju": "주", "jo": "조", "je": "제", "jya": "자", "jyu": "주", "jyo": "조",
    "nya": "냐", "nyu": "뉴", "nyo": "뇨", "hya": "햐", "hyu": "휴", "hyo": "효",
    "mya": "먀", "myu": "뮤", "myo": "묘", "rya": "랴", "ryu": "류", "ryo": "료",
    "gya": "갸", "gyu": "규", "gyo": "교", "bya": "뱌", "byu": "뷰", "byo": "뵤", "pya": "퍄", "pyu": "퓨", "pyo": "표",
    "fa": "파", "fi": "피", "fe": "페", "fo": "포", "va": "바", "vu": "부",
    "ti": "티", "di": "디",
}
J_KEYS = sorted(J_BASE, key=lambda k: -len(k))


def _norm_roman(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("ō", "o").replace("ū", "u")
    return re.sub(r"[^a-z]", "", s)


def japanese_word(w):
    """한 단어(성 또는 이름)의 헵번 로마자 → 한글"""
    w = _norm_roman(w)
    w = re.sub(r"(ou|oo)", "o", w)                  # 장음은 적지 않음
    w = re.sub(r"oh(?![aiueo])", "o", w)
    w = re.sub(r"(uu)", "u", w)
    w = re.sub(r"(aa)", "a", w)
    w = re.sub(r"n'", "n", w)
    out = []
    i = 0
    first = True
    while i < len(w):
        # 촉음: 같은 자음 두 개 (kk, tt, pp, ss, cch → tch)
        if i + 1 < len(w) and w[i] == w[i + 1] and w[i] not in "aiueon":
            out.append(("코다", "ㅅ"))
            i += 1
            continue
        if w.startswith("tch", i):
            out.append(("코다", "ㅅ"))
            i += 1
            continue
        if w[i] == "n":
            nxt = w[i + 1] if i + 1 < len(w) else ""
            if nxt and nxt in "aiueo" or nxt == "y":
                # 'n' + 모음: 나행
                pass
            else:
                out.append(("코다", "ㄴ"))
                i += 1
                continue
        if w[i] == "m" and i + 1 < len(w) and w[i + 1] in "bmp":          # Shimbo → 신보
            out.append(("코다", "ㄴ"))
            i += 1
            continue
        hit = None
        for k in J_KEYS:
            if w.startswith(k, i):
                hit = k
                break
        if not hit:
            i += 1
            continue
        v = J_BASE[hit]
        if isinstance(v, tuple):
            v = v[0] if first and not out else v[1]
        out.append(v)
        i += len(hit)
        first = False
    # out 은 완성 글자 + 받침 표시 혼합 → 문자열 조립
    s = []
    for o in out:
        if isinstance(o, tuple):
            if s and s[-1] and 0xAC00 <= ord(s[-1][-1]) <= 0xD7A3 and (ord(s[-1][-1]) - 0xAC00) % 28 == 0:
                c = s[-1][-1]
                s[-1] = s[-1][:-1] + chr(ord(c) + JONG.index(o[1]))
            else:
                s.append("")
        else:
            s.append(o)
    return "".join(s)


def japanese_name(last, first):
    """한국 표기 순서: 성 이름 (오타니 쇼헤이)"""
    a, b = japanese_word(last), japanese_word(first)
    return " ".join(x for x in (a, b) if x)


# ── 영어·스페인어 ────────────────────────────────────────────
def _strip(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s


E_RULES = []         # (정규식, 음소 리스트 생성 함수 또는 리스트)


def _r(pat, units):
    E_RULES.append((re.compile(pat), units))


# 음소 약어: 자음/모음 한글 자모를 그대로 씀. ('코다','ㄱ') 은 받침
# 순서가 중요: 앞의 규칙이 먼저 매칭 (긴 것부터)
_r(r"tch", ["ㅊ"]); _r(r"dge", ["ㅈ", "ㅣ"]); _r(r"dg", ["ㅈ"])
_r(r"sch(?=[aeiou])", ["ㅅ", "ㅋ"]); _r(r"sch", ["ㅅ", "ㅋ"])
_r(r"ch(?=r)", ["ㅋ"]); _r(r"ch", ["ㅊ"])
_r(r"sh(?=[aeiou])", ["SH"]); _r(r"sh", ["ㅅ"])
_r(r"(?<![a-z])th", ["ㅌ"]); _r(r"th", ["ㅅ"])
_r(r"ph", ["ㅍ"]); _r(r"(?<![a-z])kn", ["ㄴ"]); _r(r"(?<![a-z])wr", ["ㄹ"]); _r(r"(?<![a-z])wh", ["w"])
_r(r"ck", [("코다", "ㄱ")]); _r(r"ght", ["ㅌ"]); _r(r"gh$", []); _r(r"gh(?=[tn])", [])
_r(r"qu(?=[aeiou])", ["ㅋ", "w"]); _r(r"q", ["ㅋ"])
_r(r"ng$", [("코다", "ㅇ")]); _r(r"ng(?=[bcdfgjklmnpqrstvwxz])", [("코다", "ㅇ")]); _r(r"ng", [("코다", "ㅇ"), "ㄱ"])
_r(r"nk", [("코다", "ㅇ"), "ㅋ"])
_r(r"x$", [("코다", "ㄱ"), "ㅅ"]); _r(r"x", [("코다", "ㄱ"), "ㅅ"])
_r(r"ll$", [("코다", "ㄹ")]); _r(r"ll", [("코다", "ㄹ"), "ㄹ"])
_r(r"(?<![a-z])mc", ["ㅁ", "ㅐ", ("코다", "ㄱ")]); _r(r"(?<![a-z])mac(?=[a-z]{3})", ["ㅁ", "ㅐ", ("코다", "ㄱ")])
_r(r"re$", ["ㅓ"]); _r(r"(?<=[aeiou])h(?![aeiouy])", []); _r(r"ve$", ["ㅂ"]); _r(r"(?<![a-z])c(?=[ei])", ["ㅅ"]); _r(r"c(?=[eiy])", ["ㅅ"]); _r(r"g(?=[ey])", ["ㅈ"]); _r(r"ie$", ["ㅣ"]); _r(r"(?<=[aeiouy])r(?![aeiouy])", [])
_r(r"(?<![a-z])ju(?=(st|dg|dd|ng|mp))", ["ㅈ", "ㅓ"])


def _vowel_rules():
    # 모음 군 (길이 순)
    for pat, u in [
        (r"eigh", ["ㅔ", "ㅣ"]), (r"igh", ["ㅏ", "ㅣ"]), (r"augh", ["ㅗ"]), (r"ough", ["ㅏ", "ㅜ"]),
        (r"eau", ["ㅗ"]), (r"ieu", ["ㅠ"]),
        (r"ea", ["ㅣ"]), (r"ee", ["ㅣ"]), (r"ie$", ["ㅣ"]), (r"ie", ["ㅣ"]), (r"ei", ["ㅏ", "ㅣ"]),
        (r"oo", ["ㅜ"]), (r"ou", ["ㅏ", "ㅜ"]), (r"ow$", ["ㅗ"]), (r"ow", ["ㅏ", "ㅜ"]), (r"oa", ["ㅗ"]), (r"oi", ["ㅗ", "ㅣ"]), (r"oy", ["ㅗ", "ㅣ"]),
        (r"au", ["ㅗ"]), (r"aw", ["ㅗ"]), (r"ai", ["ㅔ", "ㅣ"]), (r"ay", ["ㅔ", "ㅣ"]),
        (r"ew", ["ㅠ"]), (r"ue", ["ㅠ"]), (r"ui", ["ㅜ", "ㅣ"]),
        (r"ey$", ["ㅣ"]), (r"ey", ["ㅔ", "ㅣ"]), (r"y$", ["ㅣ"]),
    ]:
        _r(pat, u)


_vowel_rules()

SPANISH_COUNTRIES = {"DOM", "VEN", "CUB", "PUR", "MEX", "COL", "PAN", "NCA", "ESP", "BRA", "ARG", "PER", "ECU", "HON", "CRC", "NIC"}


def latin_word(w, spanish=False):
    w = _strip(w).lower()
    w = re.sub(r"[^a-z]", "", w)
    if not w:
        return ""
    if spanish:
        return _spanish_word(w)
    return _english_word(w)


def _english_word(w):
    # 어말 묵음 e (magic e): 앞 모음이 긴소리
    units = []
    i = 0
    n = len(w)
    magic = re.search(r"([aeiou])([^aeiouy])e$", w)
    while i < n:
        rest = w[i:]
        matched = False
        for pat, u in E_RULES:
            m = pat.match(w, i)
            if m:
                units.extend(u)
                i = max(m.end(), i + 1)
                matched = True
                break
        if matched:
            continue
        c = w[i]
        nxt = w[i + 1] if i + 1 < n else ""
        prv = w[i - 1] if i > 0 else ""
        if c in "aeiou":
            units.extend(_single_vowel(w, i, magic))
            i += 1
            continue
        if c == "y":
            units.extend(["ㅇ", "ㅣ"] if i == 0 else ["ㅣ"])
            i += 1
            continue
        if c == "r" and nxt not in tuple("aeiouy") :        # 모음 앞이 아니면 묵음
            i += 1
            continue
        if c == "w":
            units.append("w")
            i += 1
            continue
        units.append(_CONS_MAP.get(c, ""))
        # 이중 자음 (tt, ss, nn, mm, rr, bb...)은 하나로
        if nxt == c and c not in "aeiou":
            i += 1
        i += 1
    return _assemble_english(units, w)


_CONS_MAP = {"b": "ㅂ", "c": "ㅋ", "d": "ㄷ", "f": "ㅍ", "g": "ㄱ", "h": "ㅎ", "j": "ㅈ", "k": "ㅋ", "l": "ㄹ", "m": "ㅁ", "n": "ㄴ",
             "p": "ㅍ", "r": "ㄹ", "s": "ㅅ", "t": "ㅌ", "v": "ㅂ", "z": "ㅈ"}


def _single_vowel(w, i, magic):
    c = w[i]
    nxt = w[i + 1] if i + 1 < len(w) else ""
    nn = w[i + 2] if i + 2 < len(w) else ""
    prv = w[i - 1] if i > 0 else ""
    end = i == len(w) - 1
    if magic and i == magic.start(1) and c in "aio":            # a_e, i_e, o_e → 긴소리
        return {"a": ["ㅔ", "ㅣ"], "i": ["ㅏ", "ㅣ"], "o": ["ㅗ"]}[c]
    if c == "e" and end and i > 0:                                # 어말 묵음 e
        return []
    if c == "e" and nxt == "s" and i + 2 == len(w) and i > 0 and prv not in "aeiou":   # -es
        return ["ㅓ"] if False else []
    if c == "a":
        if nxt == "r":
            return ["ㅏ"]
        if nxt == "l" and nn in ("l", "k", "d", "t", "") and prv != "":
            return ["ㅗ"]
        if end:
            return ["ㅏ"]
        return ["ㅐ"]
    if c == "e":
        if nxt == "r" and (i + 2 >= len(w) or nn not in "aeiou"):
            return ["ㅓ"]
        return ["ㅔ"]
    if c == "i":
        if nxt == "r" and nn not in "aeiou":
            return ["ㅓ"]
        return ["ㅣ"]
    if c == "o":
        if nxt == "r" and (i + 2 >= len(w) or nn not in "aeiou"):
            return ["ㅗ"] if i + 2 < len(w) else ["ㅓ"]
        return ["ㅗ"]
    if c == "u":
        if nxt == "r" and nn not in "aeiou":
            return ["ㅓ"]
        if prv in ("l", "r", "j", "t", "d") and nxt in ("", "s", "k", "c", "m", "t", "d", "n", "b") and prv != "":
            return ["ㅜ"] if prv in "lrj" else ["ㅓ"]
        return ["ㅓ"]
    return []


def _assemble_english(units, w):
    # 'SH' 는 뒤 모음에 따라 샤/셰/시/쇼/슈
    seq = []
    j = 0
    while j < len(units):
        u = units[j]
        if u == "SH":
            nv = units[j + 1] if j + 1 < len(units) else None
            seq.append("ㅅ")
            if nv == "ㅏ":
                units[j + 1] = "ㅑ"
            elif nv == "ㅔ":
                units[j + 1] = "ㅖ"
            elif nv == "ㅗ":
                units[j + 1] = "ㅛ"
            elif nv in ("ㅜ", "ㅠ"):
                units[j + 1] = "ㅠ"
            elif nv == "ㅓ":
                units[j + 1] = "ㅕ"
            elif nv == "ㅐ":
                units[j + 1] = "ㅒ"
        elif u == "w":
            nv = units[j + 1] if j + 1 < len(units) else None
            # w + 모음: 와, 워, 위...
            m = {"ㅏ": "ㅘ", "ㅓ": "ㅝ", "ㅔ": "ㅞ", "ㅣ": "ㅟ", "ㅐ": "ㅙ"}
            if nv in m:
                seq.append("ㅇ")
                units[j + 1] = m[nv]
            elif nv == "ㅜ":
                seq.append("ㅇ")                      # wu → 우
            else:
                seq.append("ㅇ"); seq.append("ㅜ")
        else:
            seq.append(u)
        j += 1
    # 어말 단모음 + 파열음 받침 (맷·잭 …): 모음 + 'ㅌ'(끝) → ㅅ 받침 일부만 (tt, t 로 끝나는 짧은 이름)
    s = [x for x in seq if x != ""]
    if len(s) >= 2 and w.endswith(("tt", "t")) and s[-1] == "ㅌ" and s[-2] in VOWS and s[-2] in ("ㅐ", "ㅔ", "ㅗ", "ㅓ", "ㅣ") and w.endswith("tt"):
        s = s[:-1] + [("코다", "ㅅ")]
    if len(s) >= 2 and s[-1] in ("ㄴ", "ㅁ", "ㄹ") and s[-2] in VOWS:
        s = s[:-1] + [("코다", s[-1])]
    # 자음 + 'ㄹ/ㅁ/ㄴ' + 자음 → 앞 모음에 받침
    out = []
    for k, u in enumerate(s):
        nxt = s[k + 1] if k + 1 < len(s) else None
        prev = s[k - 1] if k > 0 else None
        if u in ("ㄹ", "ㅁ", "ㄴ") and prev in VOWS and (nxt in CONS or nxt is None) and not isinstance(nxt, tuple):
            out.append(("코다", u))
        else:
            out.append(u)
    return build(out)


def _spanish_word(w):
    units = []
    i = 0
    n = len(w)
    V = {"a": "ㅏ", "e": "ㅔ", "i": "ㅣ", "o": "ㅗ", "u": "ㅜ"}
    while i < n:
        rest = w[i:]
        c = w[i]
        if rest.startswith("ch"):
            units.append("ㅊ"); i += 2; continue
        if rest.startswith("ll"):
            units.extend(["ㅇ", "ㅣ"]) if False else None
            # ll → ㅣ + 모음 (야/예/요) : 직전 자음 없이 'ㅇ'+이중모음
            nv = w[i + 2] if i + 2 < n else ""
            if nv in V:
                units.append({"a": "ㅑ", "e": "ㅖ", "i": "ㅣ", "o": "ㅛ", "u": "ㅠ"}[nv]); i += 3; continue
            units.extend(["ㄹ"]); i += 2; continue
        if rest.startswith("rr"):
            units.append("ㄹ"); i += 2; continue
        if rest.startswith("qu") and i + 2 < n and w[i + 2] in "ei":
            units.append("ㅋ"); i += 2; continue
        if rest.startswith("gu") and i + 2 < n and w[i + 2] in "ei":
            units.append("ㄱ"); i += 2; continue
        if rest.startswith("gu") and i + 2 < n and w[i + 2] == "a":
            units.extend(["ㄱ", "ㅗ"]) if False else None
            units.append("ㄱ"); units.append("ㅘ"); i += 3; continue
        if c == "g" and i + 1 < n and w[i + 1] in "ei":
            units.append("ㅎ"); i += 1; continue
        if c == "c":
            units.append("ㅅ" if i + 1 < n and w[i + 1] in "ei" else "ㅋ"); i += 1; continue
        if c == "z" or c == "s":
            units.append("ㅅ"); i += 1; continue
        if c == "j":
            units.append("ㅎ"); i += 1; continue
        if c == "h":
            i += 1; continue
        if c == "v" or c == "b":
            units.append("ㅂ"); i += 1; continue
        if c == "y":
            units.extend(["ㅇ", "ㅣ"] if i == 0 and i + 1 < n else ["ㅣ"]); i += 1; continue
        if c in V:
            units.append(V[c]); i += 1; continue
        if c == "x":
            units.extend([("코다", "ㄱ"), "ㅅ"]); i += 1; continue
        if c == "w":
            units.append("ㅇ"); units.append("ㅜ"); i += 1; continue
        units.append(_CONS_MAP.get(c, "")); i += 1
    # 받침: 모음 뒤 ㄴ/ㄹ/ㅁ + 자음 또는 어말
    out = []
    s = [x for x in units if x != ""]
    for k, u in enumerate(s):
        nxt = s[k + 1] if k + 1 < len(s) else None
        prev = s[k - 1] if k > 0 else None
        if u in ("ㄹ", "ㅁ", "ㄴ") and prev in VOWS and (nxt in CONS or nxt is None) and not isinstance(nxt, tuple):
            out.append(("코다", u))
        elif u == "ㅅ" and prev in VOWS and nxt is None and False:
            out.append(("코다", "ㅅ"))
        else:
            out.append(u)
    # 'ㅔ'+'ㅅ' 어말(-ez, -es) 은 그대로 '에스'
    return build(out)


def western_name(first, last, spanish=False):
    f = " ".join(latin_word(x, spanish) for x in re.split(r"[\s\-]+", first.strip()) if x)
    l = " ".join(latin_word(x, spanish) for x in re.split(r"[\s\-]+", last.strip()) if x)
    return f"{f} {l}".strip()


# ── 사전 (위키데이터에서 배운 이름 조각) ────────────────────────
SUFFIX = {"jr", "sr", "ii", "iii", "iv"}


def key_token(t):
    t = _strip(t).lower()
    return re.sub(r"[^a-z]", "", t)


def learn_tokens(pairs):
    """pairs: [(영어 이름, 한글 이름)] → {영어 조각: 한글 조각} (조각 수가 같은 서양 이름만)"""
    votes = defaultdict(Counter)
    for en, ko in pairs:
        et = [t for t in re.split(r"[\s\-]+", re.sub(r"\(.*?\)|,.*$", "", en).strip()) if t and key_token(t) not in SUFFIX]
        kt = [t for t in re.split(r"[\s·\-]+", ko.strip()) if t and t not in ("주니어", "시니어")]
        if len(et) != len(kt) or not et:
            continue
        for a, b in zip(et, kt):
            k = key_token(a)
            if k and re.fullmatch(r"[가-힣]+", b):
                votes[k][b] += 1
    return {k: c.most_common(1)[0][0] for k, c in votes.items() if c.most_common(1)[0][1] >= 1}


def load_wikidata():
    p = os.path.join(os.path.expanduser("~"), ".cache", "baseball9-data", "recent", "wikidata_ko_players.json")
    if not os.path.exists(p):
        return []
    return json.load(open(p, encoding="utf-8"))


def strip_suffix(last):
    return re.sub(r"\s+(jr|sr|ii|iii|iv)\.?$", "", (last or "").strip(), flags=re.I)
