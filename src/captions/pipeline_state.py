"""Pipeline state management for tracking image extraction steps."""

import time
from typing import Dict, Any, Optional


class PipelineStateManager:
    """Manages state and history for processing a single image."""

    def create_initial_state(self, image_path: str) -> Dict[str, Any]:
        """Create initial state dict for image processing."""
        return {
            "image_path": image_path,
            "start_time": time.time(),
            "status": "pending",
            "steps": {
                "ocr": {"status": "pending", "duration": 0.0},
                "vision": {"status": "pending", "duration": 0.0},
                "text": {"status": "pending", "duration": 0.0},
                "translation": {"status": "pending", "duration": 0.0},
                "yaml_write": {"status": "pending", "duration": 0.0},
            },
            "data": {},
            "errors": [],
        }

    def mark_step_complete(
        self, state: Dict[str, Any], step_name: str, duration: float, data: Optional[Dict] = None
    ) -> None:
        """Mark a pipeline step as completed."""
        if step_name in state["steps"]:
            state["steps"][step_name]["status"] = "completed"
            state["steps"][step_name]["duration"] = duration
        if data:
            state["data"][step_name] = data

    def mark_step_failed(
        self, state: Dict[str, Any], step_name: str, error: str
    ) -> None:
        """Mark a pipeline step as failed."""
        if step_name in state["steps"]:
            state["steps"][step_name]["status"] = "failed"
            state["steps"][step_name]["error"] = error
        state["errors"].append(f"{step_name}: {error}")
