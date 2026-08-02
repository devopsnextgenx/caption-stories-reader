"""FastAPI router for caption extraction and browsing endpoints."""

import os
import time
import yaml
import shutil
import logging
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, BackgroundTasks

router = APIRouter(prefix="/api/captions", tags=["Captions"])
logger = logging.getLogger(__name__)

# Active background job tracking
active_jobs: Dict[str, Dict[str, Any]] = {}


def _build_caption_image_url(image_path: Optional[str], captions_folder: Optional[str]) -> Optional[str]:
    """Build a browser-served URL for an image stored under the captions root."""
    if not image_path:
        return None

    candidate = str(image_path).strip()
    if not candidate:
        return None

    filename = os.path.basename(candidate.replace("\\", "/"))
    if not filename:
        return None

    if captions_folder:
        try:
            captions_root = os.path.abspath(captions_folder)
            abs_candidate = os.path.abspath(candidate)
            if os.path.commonpath([captions_root, abs_candidate]) == captions_root:
                rel_path = os.path.relpath(abs_candidate, captions_root).replace("\\", "/")
                return f"/captions/{rel_path}"

            candidate_file = os.path.join(captions_root, filename)
            if os.path.exists(candidate_file):
                return f"/captions/{filename}"
        except ValueError:
            pass

    return f"/captions/{filename}"


@router.get("")
def list_captions(request: Request) -> Dict[str, Any]:
    """List all processed caption metadata files in data folder."""
    config_manager = request.app.state.config_manager
    captions_folder = config_manager.get_captions_folder()

    captions = []
    if os.path.exists(captions_folder):
        for root, _, files in os.walk(captions_folder):
            for file in files:
                if file.endswith("_caption.yml") or file.endswith("_caption.yaml") or file.endswith(".yml") or file.endswith(".yaml"):
                    yml_path = os.path.join(root, file)
                    try:
                        with open(yml_path, "r", encoding="utf-8") as f:
                            data = yaml.safe_load(f) or {}
                            image_path = data.get("image_path") or data.get("image_filename")
                            captions.append(
                                {
                                    "yml_file": file,
                                    "yml_path": yml_path,
                                    "image_filename": data.get("image_filename"),
                                    "image_path": image_path,
                                    "image_url": _build_caption_image_url(image_path, captions_folder),
                                    "primary_text": data.get("content", {}).get("primary_text", ""),
                                    "english_translation": data.get("content", {}).get("english_translation", ""),
                                    "scene": data.get("content", {}).get("scene", ""),
                                    "tags": data.get("tags", []),
                                    "processed_at": data.get("processed_at"),
                                }
                            )
                    except Exception as e:
                        logger.warning("Failed to parse YAML file %s: %s", yml_path, e)

    return {"count": len(captions), "captions": captions}


@router.get("/details")
def get_caption_details(yml_path: str) -> Dict[str, Any]:
    """Get the complete content of a caption YAML file for the viewer UI."""
    if not os.path.exists(yml_path):
        raise HTTPException(status_code=404, detail="Caption YAML file not found")

    try:
        with open(yml_path, "r", encoding="utf-8") as f:
            raw_yaml = f.read()
            data = yaml.safe_load(raw_yaml) or {}
            return {
                "data": data,
                "yaml_text": raw_yaml,
                "source_path": yml_path,
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read caption YAML: {e}")


@router.post("/process-single")
def process_single_image(request: Request, image_path: str) -> Dict[str, Any]:
    """Trigger synchronous processing for a single image."""
    single_processor = request.app.state.single_processor
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail=f"Image file not found: {image_path}")

    try:
        result = single_processor.process_image(image_path)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/xos/list")
def list_xos_folder(request: Request, path: Optional[str] = None) -> Dict[str, Any]:
    """List directories and supported files inside the XOS root folder."""
    config_manager = request.app.state.config_manager
    xos_root = os.path.abspath(config_manager.get_xos_folder())
    requested_path = os.path.abspath(os.path.join(xos_root, path or "")) if not (path and os.path.isabs(path)) else os.path.abspath(path)

    if not requested_path.startswith(xos_root):
        raise HTTPException(status_code=400, detail="Path outside of XOS root is not allowed")

    if not os.path.exists(requested_path):
        raise HTTPException(status_code=404, detail=f"Path not found: {requested_path}")

    if not os.path.isdir(requested_path):
        raise HTTPException(status_code=400, detail="Requested path must be a directory")

    supported = config_manager.get_xos_supported_formats()
    file_entries: List[Dict[str, Any]] = []
    dir_entries: List[Dict[str, Any]] = []

    for item in sorted(os.listdir(requested_path), key=lambda x: x.lower()):
        full_path = os.path.join(requested_path, item)
        rel_path = os.path.relpath(full_path, xos_root)
        if os.path.isdir(full_path):
            dir_entries.append({
                "type": "directory",
                "name": item,
                "path": rel_path.replace('\\', '/'),
            })
        else:
            ext = os.path.splitext(item)[1].lower()
            if ext in supported:
                file_entries.append({
                    "type": "file",
                    "name": item,
                    "path": rel_path.replace('\\', '/'),
                    "extension": ext,
                    "size_bytes": os.path.getsize(full_path),
                })

    parent = None
    if requested_path != xos_root:
        parent = os.path.relpath(os.path.dirname(requested_path), xos_root).replace('\\', '/')
        if parent == '.':
            parent = ''

    relative_path = os.path.relpath(requested_path, xos_root).replace('\\', '/')
    if relative_path == ".":
        relative_path = ""

    return {
        "root": xos_root,
        "path": relative_path,
        "parent": parent,
        "directories": dir_entries,
        "files": file_entries,
    }


@router.get("/folder/list")
def list_captions_folder(request: Request, path: Optional[str] = None) -> Dict[str, Any]:
    """List directories and supported files inside the captions root folder."""
    config_manager = request.app.state.config_manager
    captions_root = os.path.abspath(config_manager.get_captions_folder())
    requested_path = os.path.abspath(os.path.join(captions_root, path or "")) if not (path and os.path.isabs(path)) else os.path.abspath(path)

    if not requested_path.startswith(captions_root):
        raise HTTPException(status_code=400, detail="Path outside of Captions root is not allowed")

    if not os.path.exists(requested_path):
        raise HTTPException(status_code=404, detail=f"Path not found: {requested_path}")

    if not os.path.isdir(requested_path):
        raise HTTPException(status_code=400, detail="Requested path must be a directory")

    supported = config_manager.get_supported_formats() + config_manager.get_xos_supported_formats()
    file_entries: List[Dict[str, Any]] = []
    dir_entries: List[Dict[str, Any]] = []

    for item in sorted(os.listdir(requested_path), key=lambda x: x.lower()):
        full_path = os.path.join(requested_path, item)
        rel_path = os.path.relpath(full_path, captions_root)
        if os.path.isdir(full_path):
            dir_entries.append({
                "type": "directory",
                "name": item,
                "path": rel_path.replace('\\', '/'),
            })
        else:
            ext = os.path.splitext(item)[1].lower()
            if ext in supported:
                file_entries.append({
                    "type": "file",
                    "name": item,
                    "path": rel_path.replace('\\', '/'),
                    "extension": ext,
                    "size_bytes": os.path.getsize(full_path),
                })

    parent = None
    if requested_path != captions_root:
        parent = os.path.relpath(os.path.dirname(requested_path), captions_root).replace('\\', '/')
        if parent == '.':
            parent = ''

    relative_path = os.path.relpath(requested_path, captions_root).replace('\\', '/')
    if relative_path == ".":
        relative_path = ""

    return {
        "root": captions_root,
        "path": relative_path,
        "parent": parent,
        "directories": dir_entries,
        "files": file_entries,
    }


@router.post("/process-batch")
def start_batch_processing(
    request: Request,
    background_tasks: BackgroundTasks,
    folder_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Start asynchronous assembly-line parallel batch caption extraction."""
    config_manager = request.app.state.config_manager
    batch_processor = request.app.state.batch_processor
    target_folder = folder_path or config_manager.get_captions_folder()

    if not os.path.exists(target_folder):
        raise HTTPException(status_code=404, detail=f"Folder not found: {target_folder}")

    job_id = f"batch_{int(time.time() * 1000)}"
    active_jobs[job_id] = {
        "job_id": job_id,
        "status": "running",
        "folder": target_folder,
        "completed": 0,
        "total": 0,
        "start_time": time.time(),
    }

    def run_batch():
        def update_progress(completed, total):
            active_jobs[job_id]["completed"] = completed
            active_jobs[job_id]["total"] = total

        res = batch_processor.process_folder(target_folder, progress_callback=update_progress)
        active_jobs[job_id]["status"] = "completed"
        active_jobs[job_id]["summary"] = res

    background_tasks.add_task(run_batch)
    return {"status": "started", "job_id": job_id, "message": "Batch processing started"}


@router.get("/jobs/{job_id}")
def get_job_status(job_id: str) -> Dict[str, Any]:
    """Get status of an active or completed background job."""
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job ID not found")
    return active_jobs[job_id]


@router.post("/upload")
async def upload_image(request: Request, file: UploadFile = File(...)) -> Dict[str, Any]:
    """Upload an image to data folder and optionally process immediately."""
    config_manager = request.app.state.config_manager
    single_processor = request.app.state.single_processor
    captions_folder = config_manager.get_captions_folder()
    os.makedirs(captions_folder, exist_ok=True)

    if not os.access(captions_folder, os.W_OK):
        raise HTTPException(status_code=500, detail=f"Captions folder is not writable: {captions_folder}")

    safe_filename = os.path.basename(file.filename)
    dest_path = os.path.join(captions_folder, safe_filename)
    try:
        with open(dest_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Process image automatically
        res = single_processor.process_image(dest_path)
        return {
            "status": "uploaded_and_processed",
            "filename": file.filename,
            "saved_path": dest_path,
            "result": res,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload processing failed: {e}")
