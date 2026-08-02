"""FastAPI router for administration operations."""

import logging
from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/admin", tags=["Admin"])
logger = logging.getLogger(__name__)


@router.get("/status")
def get_status(request: Request) -> Dict[str, Any]:
    """Get system health, service connectivity, and folder statistics."""
    admin_service = request.app.state.admin_service
    return admin_service.get_system_status()


@router.get("/config")
def get_config(request: Request) -> Dict[str, Any]:
    """Get current configuration content."""
    config_manager = request.app.state.config_manager
    return config_manager.config


@router.post("/config")
async def update_config(request: Request) -> Dict[str, Any]:
    """Update configuration values in config.yml."""
    config_manager = request.app.state.config_manager
    try:
        new_config = await request.json()
        if not isinstance(new_config, dict):
            raise HTTPException(status_code=400, detail="Invalid JSON object for configuration")

        success = config_manager.save_config(new_config)
        if success:
            return {"status": "success", "message": "Configuration updated successfully"}
        else:
            raise HTTPException(status_code=500, detail="Failed to write configuration file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/logs")
def get_logs(request: Request, max_lines: int = 100) -> Dict[str, Any]:
    """Fetch recent application log entries."""
    admin_service = request.app.state.admin_service
    lines = admin_service.get_recent_logs(max_lines=max_lines)
    return {"logs": lines}
