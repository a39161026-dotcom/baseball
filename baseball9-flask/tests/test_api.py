import pytest

from app import app


@pytest.fixture
def client():
    app.config["TESTING"] = True
    return app.test_client()


def test_index_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "야구9단" in r.get_data(as_text=True)


def test_full_game_flow(client):
    r = client.post("/api/game", json={"opponent": "NC다이노스", "difficulty": "NORMAL"})
    assert r.status_code == 200
    gid = r.get_json()["state"]["gameId"]
    r = client.post(f"/api/game/{gid}/advance", json={"mode": "game", "ack": True})
    body = r.get_json()
    assert body["state"]["done"] is True
    assert body["state"]["score"]["mine"] != body["state"]["score"]["theirs"]
    assert "box" in body["state"]


def test_pause_and_reject_invalid_order(client):
    gid = client.post("/api/game", json={}).get_json()["state"]["gameId"]
    paused = False
    for _ in range(400):
        body = client.post(f"/api/game/{gid}/advance",
                           json={"mode": "pitch", "stopAtDecision": True}).get_json()
        if body["paused"]:
            paused = True
            break
    assert paused, "판단 지점에서 멈춰야 함"
    r = client.post(f"/api/game/{gid}/order", json={"type": "unknown"})
    assert r.status_code == 400
    r = client.post(f"/api/game/{gid}/order", json={"type": "ibb"})
    assert r.status_code in (200, 409)


def test_unknown_game_is_404(client):
    assert client.get("/api/game/nope").status_code == 404
