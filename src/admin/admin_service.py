"""Admin service for system statistics, indexing tasks, and configuration administration."""

import os
import glob
import logging
import requests
from typing import Dict, Any, List
from pathlib import Path


class AdminService:
    """Service providing administrative actions, system health checks, and stats."""

    def __init__(self, config_manager):
        """Initialize AdminService.

        Args:
            config_manager: ConfigManager instance.
        """
        self.config_manager = config_manager
        self.logger = logging.getLogger(__name__)

    def get_system_status(self) -> Dict[str, Any]:
        """Check status of underlying services (Ollama, Qdrant, data directory)."""
        ollama_cfg = self.config_manager.get_ollama_config()
        ollama_host = ollama_cfg.get("host", "http://localhost:11434")

        # Check Ollama
        ollama_connected = False
        ollama_models: List[str] = []
        try:
            resp = requests.get(f"{ollama_host}/api/tags", timeout=3)
            if resp.status_code == 200:
                ollama_connected = True
                data = resp.json()
                ollama_models = [m.get("name") for m in data.get("models", [])]
        except Exception as e:
            self.logger.warning("Ollama health check failed: %s", e)

        # Check Qdrant
        qdrant_cfg = self.config_manager.get_qdrant_config()
        qdrant_connected = False
        qdrant_host = qdrant_cfg.get("host", "localhost")
        qdrant_port = qdrant_cfg.get("port", 6333)
        try:
            resp = requests.get(f"http://{qdrant_host}:{qdrant_port}/healthz", timeout=3)
            if resp.status_code == 200:
                qdrant_connected = True
        except Exception:
            try:
                resp = requests.get(f"http://{qdrant_host}:{qdrant_port}/readyz", timeout=3)
                if resp.status_code == 200:
                    qdrant_connected = True
            except Exception as e:
                self.logger.warning("Qdrant health check failed: %s", e)

        # Scan Data folder
        data_folder = self.config_manager.get_input_folder()
        supported_exts = self.config_manager.get_supported_formats()

        total_images = 0
        processed_yamls = 0
        if os.path.exists(data_folder):
            for root, _, files in os.walk(data_folder):
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in supported_exts:
                        total_images += 1
                    elif ext in [".yml", ".yaml"] and (f.endswith("_caption.yml") or f.endswith(".yml") or f.endswith("_caption.yaml") or f.endswith(".yaml")):
                        processed_yamls += 1

        return {
            "status": "healthy" if (ollama_connected or qdrant_connected) else "degraded",
            "ollama": {
                "connected": ollama_connected,
                "host": ollama_host,
                "vision_model": ollama_cfg.get("models", {}).get("vision_model"),
                "text_model": ollama_cfg.get("models", {}).get("text_model"),
                "available_models": ollama_models,
            },
            "qdrant": {
                "connected": qdrant_connected,
                "host": qdrant_host,
                "port": qdrant_port,
                "collection": qdrant_cfg.get("collection_name"),
            },
            "data": {
                "folder": data_folder,
                "total_images": total_images,
                "processed_yamls": processed_yamls,
                "pending_images": max(0, total_images - processed_yamls),
            },
        }

    def get_recent_logs(self, max_lines: int = 100) -> List[str]:
        """Fetch recent system logs."""
        default_log = self.config_manager.get_log_file()
        legacy_log = os.path.join(os.path.dirname(default_log) or ".", "caption-stories-reader.log")
        candidate_paths = [default_log]
        if default_log != legacy_log:
            candidate_paths.append(legacy_log)

        for log_file in candidate_paths:
            if not os.path.exists(log_file):
                continue
            try:
                with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()
                    return [line.strip() for line in lines[-max_lines:]]
            except Exception as e:
                return [f"Error reading log file: {e}"]

        return ["No log file found at " + " or ".join(candidate_paths)]
