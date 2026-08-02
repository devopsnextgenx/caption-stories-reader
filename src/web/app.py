"""FastAPI Application Factory for Caption Stories Reader."""

import os
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from ..admin.config_manager import ConfigManager
from ..admin.admin_service import AdminService
from ..captions.single_image_processor import SingleImageProcessor
from ..captions.batch_pipeline_processor import BatchPipelineProcessor
from .routes import admin_routes, captions_routes, ui_routes


def create_app(config_path: str = "config/config.yml") -> FastAPI:
    """Create and configure FastAPI application instance.

    Args:
        config_path: Path to configuration YAML file.

    Returns:
        Configured FastAPI application instance.
    """
    app = FastAPI(
        title="Caption Stories Reader API",
        description="Modular Web, Admin, AI, and Caption extraction platform",
        version="0.1.0",
    )

    # Enable CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Initialize shared services
    config_manager = ConfigManager(config_path)
    config_manager.setup_logging()
    admin_service = AdminService(config_manager)
    single_processor = SingleImageProcessor(config_manager)
    batch_processor = BatchPipelineProcessor(config_manager, single_processor)

    # Store services in app state
    app.state.config_manager = config_manager
    app.state.admin_service = admin_service
    app.state.single_processor = single_processor
    app.state.batch_processor = batch_processor

    # Mount static files & data folder
    web_dir = os.path.dirname(__file__)
    static_dir = os.path.join(web_dir, "static")
    os.makedirs(static_dir, exist_ok=True)
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    captions_folder = config_manager.get_captions_folder()
    if os.path.exists(captions_folder):
        app.mount("/captions", StaticFiles(directory=captions_folder), name="captions")

    xos_folder = config_manager.get_xos_folder()
    if os.path.exists(xos_folder):
        app.mount("/xos", StaticFiles(directory=xos_folder), name="xos")

    stories_folder = config_manager.get_stories_folder()
    if os.path.exists(stories_folder):
        app.mount("/stories", StaticFiles(directory=stories_folder), name="stories")

    # Include APIRouters
    app.include_router(ui_routes.router)
    app.include_router(admin_routes.router)
    app.include_router(captions_routes.router)

    return app
