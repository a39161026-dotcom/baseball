# ⚾ 야구9단 매니저 (Flask)

JavaFX 버전(`../baseball9-javafx`)의 경기 엔진과 화면을 Flask 웹 앱으로 옮긴 버전입니다.

## 실행

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python app.py              # http://127.0.0.1:5000
pytest                     # 엔진 + API 테스트
```

## 구조

- `game/engine.py` — 투구 단위 시뮬레이션, 감독 지시 (JavaFX GameEngine 포팅)
- `game/commentary.py` — 한국어 중계 멘트
- `game/models.py` — Player, TeamState, PitcherLine, GameState
- `game/league.py` — 로스터 구성, 상대팀, 경기 후 피로도
- `game/players_data.py` — 선수 DB (Java PlayerDB 자동 변환)
- `app.py` — Flask API (`/api/league`, `/api/game`, `/api/game/<id>/advance`, `/api/game/<id>/order`)
- `static/index.html` — 단일 페이지 화면 (셋업 / 경기 / 결과)

## 메모

- 게임 상태는 서버 메모리에만 있습니다. 서버를 재시작하면 진행 중인 경기와 전적이 초기화됩니다.
- 단일 사용자 용도입니다. 여러 사람이 동시에 쓰는 배포에는 DB 저장이 필요합니다.
