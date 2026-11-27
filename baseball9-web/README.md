# ⚾ 야구9단 매니저 (휴대폰·PC 브라우저용)

서버 없이 HTML 한 파일로 돌아가는 버전입니다. 게임 엔진은 JavaFX 버전 → Python(Flask) 버전을 그대로 JavaScript로 옮겼습니다.

- 게시된 링크: https://claude.ai/artifact/629y7xFCNY4Bh5MDLvjSSx
- `dist/play.html` 파일을 브라우저로 열어도 됩니다.

## 개발

```bash
node build.js            # src/ → dist/play.html (+ 로컬 확인용 dist/preview.html)
node --test tests/engine.test.js
```

- `src/engine.js` — 모델, 중계 멘트, 엔진, 로스터, API(dispatch)
- `src/players.js` — 선수 DB (Java PlayerDB 에서 변환)
- `src/play.src.html` — 화면 (휴대폰에서는 전광판 → 그라운드·중계 → 버튼 → 타순 순서)

경기 기록은 페이지를 새로 고치면 초기화됩니다.
