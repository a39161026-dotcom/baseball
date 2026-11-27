# ⚾ 야구9단 매니저 (휴대폰·PC 브라우저용)

서버 없이 HTML 한 파일로 돌아가는 버전입니다. 게임 엔진은 JavaFX 버전 → Python(Flask) 버전을 그대로 JavaScript로 옮겼습니다.

- 게시된 링크: https://claude.ai/artifact/629y7xFCNY4Bh5MDLvjSSx
- `dist/play.html` 파일을 브라우저로 열어도 됩니다.

## 게임 구성 (야구9단 방식)

- **홈**: 오늘 경기, 오늘/7일 자동 진행, 다른 구장 결과, 상위 순위, 새 리그 설정(18/36/72/144경기)
- **경기**: 타순·선발 지정 후 투구 단위 중계로 직접 지휘 (번트·도루·대타·대주자·고의4구·투수교체·구종 사인)
- **순위 / 기록**: 10개 구단 순위표, 리그 리더(타율·홈런·타점·OPS·평균자책점·탈삼진·다승), 우리 팀 기록
- **훈련**: 경기마다 쌓이는 포인트로 능력치 +1(잠재력까지) 또는 휴식
- 선발 5인 로테이션, 투수 피로·회복, AI 구단 투수 운영
- 진행은 자동 저장 (claude.ai에서는 내 계정, 그 밖에서는 이 브라우저)

## 개발

```bash
node build.js            # src/ → dist/play.html (+ 로컬 확인용 dist/preview.html)
node --test tests/engine.test.js
```

- `src/engine.js` — 모델, 중계 멘트, 경기 엔진(타자·투수 기록 포함)
- `src/season.js` — 시즌 모드: 구단 구성, 일정, 순위, 기록, 훈련, 저장/불러오기, API(dispatch)
- `src/players.js` — 선수 DB (Java PlayerDB 에서 변환)
- `src/play.src.html` — 화면 (휴대폰에서는 전광판 → 그라운드·중계 → 버튼 → 타순 순서)

