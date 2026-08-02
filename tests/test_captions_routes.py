import os
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from src.web.app import create_app


def test_caption_listing_exposes_browser_served_image_url(tmp_path, monkeypatch):
    captions_dir = tmp_path / "captions"
    captions_dir.mkdir()
    image_path = captions_dir / "sample.jpg"
    image_path.write_bytes(b"fake image")

    yaml_path = captions_dir / "sample_caption.yml"
    yaml_path.write_text(
        yaml.safe_dump(
            {
                "image_filename": "sample.jpg",
                "image_path": str(image_path),
                "content": {},
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("CAPTIONS_FOLDER", str(captions_dir))
    app = create_app("config/config.yml")
    client = TestClient(app)

    response = client.get("/api/captions")

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["captions"][0]["image_url"] == "/captions/sample.jpg"
