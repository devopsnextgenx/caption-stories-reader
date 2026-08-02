import os
import sys
from pathlib import Path

from src.admin.config_manager import ConfigManager
from src.main import main


def test_config_manager_resolves_project_relative_paths_from_any_cwd(tmp_path, monkeypatch):
    project_root = Path(__file__).resolve().parents[1]
    repo_config = project_root / "config" / "config.yml"

    assert repo_config.exists(), "Expected repository config file to exist"

    monkeypatch.chdir(tmp_path)

    manager = ConfigManager("config/config.yml")

    assert os.path.isabs(manager.config_path)
    assert manager.config_path == str(repo_config)
    assert manager.get_api_config().get("port") == 8989


def test_main_reloads_only_src_and_config_dirs(monkeypatch):
    project_root = Path(__file__).resolve().parents[1]
    expected_reload_dirs = [str(project_root / "src"), str(project_root / "config")]
    captured = {}

    class DummyConfigManager:
        def __init__(self, config_path):
            self.config_path = config_path

        def setup_logging(self):
            return None

        def get_api_config(self):
            return {"host": "0.0.0.0", "port": 8989, "reload": True}

    def fake_run(app_or_target, **kwargs):
        captured["app_or_target"] = app_or_target
        captured["kwargs"] = kwargs

    monkeypatch.setattr("src.main.ConfigManager", DummyConfigManager)
    monkeypatch.setattr("src.main.create_app", lambda config_path: object())
    monkeypatch.setattr("src.main.uvicorn.run", fake_run)
    monkeypatch.setattr(sys, "argv", ["caption-stories-reader", "--config", "config/config.yml"])

    main()

    assert captured["kwargs"]["reload"] is True
    assert captured["kwargs"]["reload_dirs"] == expected_reload_dirs
