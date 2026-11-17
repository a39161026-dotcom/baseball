"""야구9단 매니저 — Flask 웹 버전 (로컬 서버용). 실제 로직은 game/service.py 에 있습니다."""
from flask import Flask, jsonify, request, send_from_directory

from game import service

app = Flask(__name__, static_folder="static", static_url_path="")


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/<path:rest>", methods=["GET", "POST"])
def api(rest):
    body = request.get_json(silent=True) or {}
    status, payload = service.dispatch(request.method, request.path, body)
    return jsonify(payload), status


if __name__ == "__main__":
    app.run(debug=True, port=5000)
