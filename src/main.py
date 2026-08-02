"""Main entry point for Caption Stories Reader."""

import os
import sys
from pathlib import Path
import argparse
import uvicorn
import logging

from src.admin.config_manager import ConfigManager
from src.captions.batch_pipeline_processor import BatchPipelineProcessor
from src.web.app import create_app

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def resolve_config_path(config_path: str) -> str:
    """Resolve config files relative to the project root."""
    candidate = Path(config_path)
    if candidate.is_absolute():
        return str(candidate)

    for search_path in (Path.cwd() / candidate, PROJECT_ROOT / candidate):
        if search_path.exists():
            return str(search_path.resolve())

    return str((PROJECT_ROOT / candidate).resolve())

logger = logging.getLogger("caption_stories_reader")


def create_app_from_env():
    """Factory function for Uvicorn reload mode."""
    config_path = os.environ.get("CAPTION_CONFIG_PATH", "config/config.yml")
    return create_app(resolve_config_path(config_path))


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(description="Caption Stories Reader Platform")
    parser.add_argument(
        "--mode",
        choices=["api", "batch"],
        default="api",
        help="Execution mode: 'api' to run FastAPI web server (default), 'batch' to process image directory",
    )
    parser.add_argument(
        "--config",
        default="config/config.yml",
        help="Path to configuration file (default: config/config.yml)",
    )
    parser.add_argument(
        "--input-folder",
        default=None,
        help="Override input folder for batch processing mode",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=None,
        help="Override number of threads for batch processing mode",
    )
    parser.add_argument(
        "--host",
        default=None,
        help="Override API host address",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="Override API port",
    )
    args = parser.parse_args()

    resolved_config_path = resolve_config_path(args.config)
    os.environ["CAPTION_CONFIG_PATH"] = resolved_config_path
    config_manager = ConfigManager(resolved_config_path)
    config_manager.setup_logging()

    if args.mode == "batch":
        folder = args.input_folder or config_manager.get_input_folder()
        print(f"[INFO] Starting batch caption processing on folder: {folder}")
        processor = BatchPipelineProcessor(config_manager)
        results = processor.process_folder(folder)
        print(f"[SUCCESS] Processed {results.get('processed')} images in {results.get('time_seconds')} seconds.")
        sys.exit(0)

    # API Mode
    api_cfg = config_manager.get_api_config()
    host = args.host or api_cfg.get("host", "0.0.0.0")
    port = args.port or api_cfg.get("port", 8989)
    reload = api_cfg.get("reload", True)

    logger.info(f"[INFO] Starting Caption Stories Reader Web UI on http://{host}:{port}")
    reload_dirs = [str((PROJECT_ROOT / "src").resolve()), str((PROJECT_ROOT / "config").resolve())]
    if reload:
        os.environ["CAPTION_CONFIG_PATH"] = args.config
        uvicorn.run(
            "src.main:create_app_from_env",
            host=host,
            port=port,
            reload=True,
            factory=True,
            reload_dirs=reload_dirs,
        )
    else:
        app = create_app(resolved_config_path)
        uvicorn.run(app, host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
