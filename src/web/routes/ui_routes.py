"""FastAPI router for serving HTML pages and Web UI."""

import os
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

router = APIRouter(tags=["UI"])

templates_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")
templates = Jinja2Templates(directory=templates_dir)


@router.get("/", response_class=HTMLResponse)
def index_page(request: Request):
    """Main dashboard & Reader homepage."""
    return templates.TemplateResponse(request, "index.html", {"page": "dashboard"})


@router.get("/admin", response_class=HTMLResponse)
def admin_page(request: Request):
    """Admin dashboard & config editor page."""
    return templates.TemplateResponse(request, "admin.html", {"page": "admin"})


@router.get("/captions-studio", response_class=HTMLResponse)
def captions_studio_page(request: Request):
    """Caption Extraction & Processing Studio page."""
    return templates.TemplateResponse(request, "captions.html", {"page": "captions"})
