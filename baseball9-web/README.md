# ⚾ 야구9단 매니저 (휴대폰·PC 브라우저용)

서버 없이 HTML 한 파일로 돌아가는 버전입니다. 게임 엔진은 JavaFX 버전 → Python(Flask) 버전을 그대로 JavaScript로 옮겼습니다.

- 게시된 링크: https://claude.ai/artifact/629y7xFCNY4Bh5MDLvjSSx
- `dist/play.html` 파일을 브라우저로 열어도 됩니다.

## 게임 구성 (야구9단 방식)

- **홈**: 오늘 경기, 오늘/7일 자동 진행, 다른 구장 결과, 상위 순위, 새 리그 설정(18/36/72/144경기)
- **경기**: 타순·선발 지정 후 투구 단위 중계로 직접 지휘 (번트·도루·대타·대주자·고의4구·투수교체·구종 사인)
- **순위 / 기록**: 10개 구단 순위표, 리그 리더(타율·홈런·타점·OPS·평균자책점·탈삼진·다승), 우리 팀 기록
- **훈련**: 경기마다 쌓이는 포인트로 능력치 +1(잠재력까지) 또는 휴식
- **영입**: KBO·NPB·MLB 역대 선수 31,600명 중 검색해서 훈련 포인트로 영입, 훈련 탭에서 방출
- 리그: KBO(10팀) / NPB(12팀) / MLB(30팀) / 월드 리그(세 리그 강팀 12팀). 선수 기준은 현역(마지막 시즌 소속) 또는 역대 레전드(가장 오래 뛴 구단, 전신 포함)
- 올스타전: 시즌 중반, 팬 투표(능력치+시즌 성적)로 뽑은 두 그룹(드림/나눔, 센트럴/퍼시픽, 아메리칸/내셔널, 아시아/아메리카)
- 국가대표 대회: 8개국 조별리그 → 4강 → 결승. 현역 대표 또는 역대 드림팀. 국적(KBO)·출생국(NPB·MLB) 기준, 리그를 오간 선수는 한 사람으로 묶음
- 선발 5인 로테이션, 투수 피로·회복, AI 구단 투수 운영
- 진행은 자동 저장 (claude.ai에서는 내 계정, 그 밖에서는 이 브라우저)

## 선수 데이터

`src/players.js` 는 `tools/build_players.py` 가 공개 기록에서 만듭니다 (KBO 3,420명 · NPB 7,304명 · MLB 20,876명).

- 출처: KBO 공식 기록(1982–2025), NPB 공식·npbstats, MLB [Lahman Database](https://sabr.org/lahman-database/) (CC BY-SA 3.0) — [frankmkpark/mnk_datasets](https://github.com/frankmkpark/mnk_datasets) 정리본
- 타자 능력치: 리그 평균 대비 OPS(OPS+) 전성기 3시즌 + 통산, 타석이 적으면 평균 쪽 보정
- 투수 능력치: 리그 평균 대비 평균자책점(ERA+) 전성기 3시즌 + 통산, 불펜은 할인, 선발은 이닝 보너스
- 리그 수준 보정: MLB 0, NPB −3, KBO −6 (리그끼리 맞붙을 때 차이가 나도록, 리그 안 순위는 그대로)
- 동일인 판정: 리그가 다른 기록(류현진 KBO ↔ Hyun Jin Ryu MLB)을 성 + 출생연도 + 이름 철자 유사도로 묶음 (1,393건)
- 국적: KBO 국적 우선, 그 외 출생국. 1945년 이전 한국·대만 출생 NPB 선수는 일본
- 한계: 주루·수비·컨택은 반영하지 않아 이치로 같은 유형은 낮게 나옵니다

```bash
python3 tools/build_players.py --report   # 원본 CSV 를 받아(캐시) players.js 재생성 + 상위 선수 확인
```

## 개발

```bash
node build.js            # src/ → dist/play.html (+ 로컬 확인용 dist/preview.html)
node --test tests/engine.test.js
```

- `src/engine.js` — 모델, 중계 멘트, 경기 엔진(타자·투수 기록 포함)
- `src/season.js` — 시즌 모드: 구단 구성, 일정, 순위, 기록, 훈련, 저장/불러오기, API(dispatch)
- `src/players.js` — 선수 DB (Java PlayerDB 에서 변환)
- `src/play.src.html` — 화면 (휴대폰에서는 전광판 → 그라운드·중계 → 버튼 → 타순 순서)

