"""Configuration management for Caption Stories Reader."""

import os
import yaml
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional


class ConfigManager:
    """Manages configuration loading, validation, saving, and access."""

    def __init__(self, config_path: str = "config/config.yml"):
        """Initialize the configuration manager.

        Args:
            config_path: Path to the configuration YAML file
        """
        self.config_path = self._resolve_config_path(config_path)
        self.config: Dict[str, Any] = self._load_config()
        self.logger = logging.getLogger(__name__)
        self._create_directories()

    def _resolve_config_path(self, config_path: str) -> str:
        """Resolve config paths relative to the project root."""
        if not config_path:
            return config_path

        candidate = Path(config_path)
        if candidate.is_absolute():
            return str(candidate)

        project_root = Path(__file__).resolve().parents[2]
        candidate_paths = [
            Path.cwd() / candidate,
            project_root / candidate,
            project_root / "config" / Path(candidate).name,
        ]

        for path in candidate_paths:
            if path.exists():
                return str(path.resolve())

        return str((project_root / candidate).resolve())

    def _load_config(self) -> Dict[str, Any]:
        """Load configuration from YAML file."""
        if not os.path.exists(self.config_path):
            raise FileNotFoundError(f"Configuration file not found: {self.config_path}")

        try:
            with open(self.config_path, "r", encoding="utf-8") as file:
                config = yaml.safe_load(file) or {}
                return config
        except yaml.YAMLError as e:
            raise yaml.YAMLError(f"Error parsing configuration file {self.config_path}: {e}")

    def save_config(self, new_config: Optional[Dict[str, Any]] = None) -> bool:
        """Save configuration to disk.

        Args:
            new_config: Optional new dictionary to replace current config.

        Returns:
            True if saved successfully.
        """
        if new_config is not None:
            self.config = new_config

        try:
            with open(self.config_path, "w", encoding="utf-8") as file:
                yaml.dump(self.config, file, default_flow_style=False, sort_keys=False)
            self.logger.info("Successfully updated configuration file: %s", self.config_path)
            return True
        except Exception as e:
            self.logger.error("Failed to save configuration: %s", e)
            return False

    def _create_directories(self) -> None:
        """Create required directories based on config settings."""
        model_dir = self.get_model_dir()
        if model_dir:
            os.makedirs(model_dir, exist_ok=True)

        captions_dir = self.get_captions_folder()
        if captions_dir:
            os.makedirs(captions_dir, exist_ok=True)

        xos_dir = self.get_xos_folder()
        if xos_dir:
            os.makedirs(xos_dir, exist_ok=True)

        stories_dir = self.get_stories_folder()
        if stories_dir:
            os.makedirs(stories_dir, exist_ok=True)

        log_file = self.get_log_file()
        log_dir = os.path.dirname(log_file)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)

        legacy_log_file = os.path.join(os.path.dirname(log_file) or ".", "caption-stories-reader.log")
        if log_file != legacy_log_file:
            os.makedirs(os.path.dirname(legacy_log_file) or ".", exist_ok=True)

        perf_dir = self.get_performance_log_location()
        if perf_dir:
            os.makedirs(perf_dir, exist_ok=True)

    def setup_logging(self) -> None:
        """Configure Python root logger with handlers based on config settings."""
        log_cfg = self.config.get("logging", {})
        log_file = self.get_log_file()
        log_level_str = log_cfg.get("level", "INFO").upper()
        log_format = log_cfg.get("format", "%(asctime)s - %(name)s - %(levelname)s - %(message)s")

        log_level = getattr(logging, log_level_str, logging.INFO)

        if log_file:
            log_dir = os.path.dirname(log_file)
            if log_dir:
                os.makedirs(log_dir, exist_ok=True)

        legacy_log_file = os.path.join(os.path.dirname(log_file) or ".", "caption-stories-reader.log")
        if log_file != legacy_log_file:
            os.makedirs(os.path.dirname(legacy_log_file) or ".", exist_ok=True)
            Path(legacy_log_file).touch(exist_ok=True)

        root_logger = logging.getLogger()
        root_logger.setLevel(log_level)

        formatter = logging.Formatter(log_format)

        abs_log_file = os.path.abspath(log_file) if log_file else ""
        has_file_handler = False
        for handler in root_logger.handlers:
            if isinstance(handler, logging.FileHandler) and os.path.abspath(handler.baseFilename) == abs_log_file:
                has_file_handler = True
                break

        if not has_file_handler and log_file:
            file_handler = logging.FileHandler(log_file, encoding="utf-8")
            file_handler.setLevel(log_level)
            file_handler.setFormatter(formatter)
            root_logger.addHandler(file_handler)

        has_console_handler = any(
            isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler)
            for h in root_logger.handlers
        )
        if not has_console_handler:
            console_handler = logging.StreamHandler()
            console_handler.setLevel(log_level)
            console_handler.setFormatter(formatter)
            root_logger.addHandler(console_handler)

        for u_name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
            u_logger = logging.getLogger(u_name)
            u_logger.propagate = True

        self.logger.info("Logging initialized. Writing logs to %s", log_file)

    def get_logging_config(self) -> Dict[str, Any]:
        """Get logging configuration."""
        return self.config.get("logging", {})

    def get_log_file(self) -> str:
        """Get log file path, with environment variable override."""
        return os.getenv("LOG_FILE") or self.config.get("logging", {}).get(
            "file", "logs/caption-stories-reader.log"
        )

    def get_performance_log_location(self) -> str:
        """Get performance log location, with environment variable override."""
        return os.getenv("PERFORMANCE_LOG_LOCATION") or self.config.get("performance_logging", {}).get(
            "log_location", "logs/performance"
        )

    def get_api_config(self) -> Dict[str, Any]:
        """Get API server settings."""
        return self.config.get("api", {})

    def get_model_dir(self) -> str:
        """Get model storage directory."""
        return self.config.get("model", {}).get("model_dir", "models")

    def get_input_folder(self) -> str:
        """Get legacy input folder path for backward compatibility."""
        return self.get_captions_folder()

    def get_captions_folder(self) -> str:
        """Get captions folder path, with environment variable override."""
        return os.getenv("CAPTIONS_FOLDER") or self.config.get("data", {}).get(
            "captions_folder",
            self.config.get("data", {}).get("input_folder", "/media/data/xos/actresses/Captions"),
        )

    def get_xos_folder(self) -> str:
        """Get XOS folder path, with environment variable override."""
        return os.getenv("XOS_FOLDER") or self.config.get("data", {}).get("xos_folder", "/media/data/xos")

    def get_stories_folder(self) -> str:
        """Get stories folder path, with environment variable override."""
        return os.getenv("STORIES_FOLDER") or self.config.get("data", {}).get(
            "stories_folder", "/media/zbox-home/admn/git/devopsnextgenx/story-site/data"
        )

    def get_xos_supported_formats(self) -> List[str]:
        """Get supported media formats for XOS browsing."""
        return self.config.get("data", {}).get(
            "xos_supported_formats", [".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp", ".mp4"]
        )

    def get_supported_formats(self) -> List[str]:
        """Get supported image formats for caption extraction."""
        return self.config.get("data", {}).get(
            "supported_formats", [".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"]
        )

    def get_num_threads(self) -> int:
        """Get number of processing threads."""
        return self.config.get("processing", {}).get("num_threads", 1)

    def get_batch_size(self) -> int:
        """Get batch size for processing."""
        return self.config.get("processing", {}).get("batch_size", 10)

    def is_progress_enabled(self) -> bool:
        """Check if progress display is enabled."""
        return self.config.get("processing", {}).get("show_progress", True)

    def is_timing_enabled(self) -> bool:
        """Check if timing is enabled."""
        return self.config.get("processing", {}).get("enable_timing", True)

    def get_ocr_config(self) -> Dict[str, Any]:
        """Get PaddleOCR configuration."""
        return self.config.get("ocr", self.config.get("model", {}))

    def get_pipeline_config(self) -> Dict[str, Any]:
        """Get Pipeline flags and image resize settings."""
        return self.config.get("pipeline", {})

    def get_image_resize_spec(self) -> Dict[str, Any]:
        """Get image resize specification for visual LLM processing."""
        return self.config.get("pipeline", {}).get("image_resize", {
            "enabled": True,
            "max_size": [1024, 1024],
            "keep_aspect": True,
            "interpolation": "area",
        })

    def get_ollama_config(self) -> Dict[str, Any]:
        """Get Ollama / Visual / Text LLM configuration."""
        cfg = dict(self.config.get("ollama", {}))
        # Allow overriding the Ollama host via environment variable (useful in Docker)
        env_host = os.getenv("OLLAMA_HOST")
        if env_host:
            cfg["host"] = env_host
        return cfg

    def get_qdrant_config(self) -> Dict[str, Any]:
        """Get Qdrant vector database configuration."""
        return self.config.get("qdrant", {
            "enabled": True,
            "host": "localhost",
            "port": 6333,
            "collection_name": "captions_index",
            "vector_size": 768,
            "distance": "Cosine",
        })

    def get_performance_config(self) -> Dict[str, Any]:
        """Get performance configuration."""
        return self.config.get("performance", {})
