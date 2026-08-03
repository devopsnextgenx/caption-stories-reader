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
    return templates.TemplateResponse(request, "index.html", {"page": "dashboard"})


@router.get("/admin", response_class=HTMLResponse)
def admin_page(request: Request):
    return templates.TemplateResponse(request, "admin.html", {"page": "admin"})


@router.get("/captions-studio", response_class=HTMLResponse)
def captions_studio_page(request: Request):
    return templates.TemplateResponse(request, "captions.html", {"page": "captions"})


@router.get("/browse/captions", response_class=HTMLResponse)
def browse_captions_page(request: Request):
    return templates.TemplateResponse(request, "browse.html", {"page": "browse", "browse": "captions"})


@router.get("/browse/xos", response_class=HTMLResponse)
def browse_xos_page(request: Request):
    return templates.TemplateResponse(request, "browse.html", {"page": "browse", "browse": "xos"})


@router.get("/stories", response_class=HTMLResponse)
def stories_page(request: Request):
    """Serve the client-side Stories Reader shell."""
    return templates.TemplateResponse(request, "stories.html", {"page": "stories"})

@router.get("/.well-known/appspecific/com.chrome.devtools.json", include_in_schema=False)
def chrome_devtools_config(request: Request):
    """Serve a quiet mock response to satisfy Chrome DevTools background polls without generating 404 logs."""
    return JSONResponse(
        status_code=200,
        content={"status": "ignored", "message": "DevTools noise handled successfully"}
    )

@router.get("/favicon.ico", include_in_schema=False)
def favicon_shortcut(request: Request):
    """Serve a quiet empty response for the browser favicon request to prevent 404 console errors."""
    return Response(status_code=status.HTTP_204_NO_CONTENT)