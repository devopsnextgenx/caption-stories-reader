from pathlib import Path

from fastapi.testclient import TestClient

from src.web.app import create_app


def test_ui_pages_render_successfully():
    app = create_app("config/config.yml")
    client = TestClient(app)

    for path in ["/", "/admin", "/captions-studio", "/browse/captions", "/browse/xos"]:
        response = client.get(path)
        assert response.status_code == 200, f"Expected page {path} to render successfully"
        assert "text/html" in response.headers["content-type"]


def test_app_initializes_logging_file_on_startup():
    log_path = Path("logs/caption-stories-reader.log")
    if log_path.exists():
        log_path.unlink()

    create_app("config/config.yml")

    assert log_path.exists(), "Expected the startup logger to create the configured log file"
    assert log_path.stat().st_size >= 0
