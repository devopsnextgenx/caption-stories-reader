from pathlib import Path

import yaml

from fastapi.testclient import TestClient

from src.web.app import create_app


def test_ui_pages_render_successfully():
    app = create_app("config/config.yml")
    client = TestClient(app)

    for path in ["/", "/admin", "/captions-studio", "/browse/captions", "/browse/xos", "/stories"]:
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


def test_stories_page_uses_story_page_post_navigation(tmp_path, monkeypatch):
    story_root = tmp_path / "story-site"
    story_dir = story_root / "stories" / "thread-1"
    yml_dir = story_dir / "ymls"
    imgs_dir = story_dir / "imgs"
    yml_dir.mkdir(parents=True)
    imgs_dir.mkdir(parents=True)

    (story_dir / "thumbnail.jpg").write_bytes(b"story-thumb")
    (story_dir / "1.png").write_bytes(b"page-thumb")
    (imgs_dir / "1_local.jpg").write_bytes(b"page-local")

    page_payload = {
        "metadata": {"page_number": 1},
        "images": ["https://example.com/page-root.jpg"],
        "posts": [
            {
                "post_id": 1,
                "content": "Story body for post one",
                "is_comment": False,
                "tags": ["family", "drama"],
                "images": ["https://example.com/post-image.jpg"],
                "statistics": {"word_count": 5, "char_count": 24},
            },
            {
                "post_id": 2,
                "content": "Story body for post two",
                "is_comment": True,
                "statistics": {"word_count": 5, "char_count": 24},
            },
        ],
    }
    (yml_dir / "page_1.yml").write_text(yaml.safe_dump(page_payload, sort_keys=False), encoding="utf-8")

    monkeypatch.setenv("STORIES_FOLDER", str(story_root))
    app = create_app("config/config.yml")
    client = TestClient(app)

    response = client.get("/stories?story=thread-1&page=1&post=1")

    assert response.status_code == 200
    assert "Stories Reader" in response.text
    assert "Thread 1" in response.text
    assert "Page 1" in response.text
    assert "Post 1" in response.text
    assert "Story body for post one" in response.text
    assert "family" in response.text
    assert "/stories/stories/thread-1/thumbnail.jpg" in response.text
    assert "/stories/stories/thread-1/1.png" in response.text
    assert "/stories/stories/thread-1/imgs/1_local.jpg" in response.text
