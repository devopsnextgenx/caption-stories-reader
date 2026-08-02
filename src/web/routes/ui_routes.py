"""FastAPI router for serving HTML pages and Web UI."""

import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import yaml
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

router = APIRouter(tags=["UI"])

templates_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")
templates = Jinja2Templates(directory=templates_dir)


def _is_image_file(path: Path) -> bool:
    return path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}


def _to_story_static_url(stories_root: Path, file_path: Path) -> Optional[str]:
    try:
        rel_path = file_path.resolve().relative_to(stories_root.resolve())
    except (ValueError, OSError):
        return None
    return f"/stories/{quote(str(rel_path).replace(os.sep, '/'), safe='/')}"


def _resolve_story_root(raw_stories_folder: str) -> Optional[Path]:
    if not raw_stories_folder:
        return None

    base = Path(raw_stories_folder).expanduser()
    candidates = [
        base,
        base / "story-site",
        base / "data" / "story-site",
    ]

    for candidate in candidates:
        if candidate.exists() and (candidate / "stories").is_dir():
            return candidate

    if base.exists() and base.is_dir():
        return base

    return None


def _find_story_thumbnail(stories_root: Path, story_dir: Path) -> Optional[str]:
    for folder in (story_dir, story_dir / "imgs"):
        for ext in ("jpg", "jpeg", "png", "webp"):
            candidate = folder / f"thumbnail.{ext}"
            if candidate.exists():
                return _to_story_static_url(stories_root, candidate)
    return None


def _find_page_local_images(stories_root: Path, story_dir: Path, page_number: int) -> List[str]:
    imgs_dir = story_dir / "imgs"
    if not imgs_dir.exists() or not imgs_dir.is_dir():
        return []

    prefixes = (
        f"{page_number}.",
        f"{page_number}_",
        f"page_{page_number}.",
        f"page_{page_number}_",
    )
    results: List[str] = []
    for image_path in sorted(imgs_dir.iterdir()):
        if not image_path.is_file() or not _is_image_file(image_path):
            continue
        name_lower = image_path.name.lower()
        if name_lower.startswith(prefixes):
            image_url = _to_story_static_url(stories_root, image_path)
            if image_url:
                results.append(image_url)

    return results


def _find_page_thumbnail(stories_root: Path, story_dir: Path, page_number: int) -> Optional[str]:
    for folder in (story_dir, story_dir / "imgs"):
        for ext in ("jpg", "jpeg", "png", "webp"):
            candidate = folder / f"{page_number}.{ext}"
            if candidate.exists():
                return _to_story_static_url(stories_root, candidate)
    local_matches = _find_page_local_images(stories_root, story_dir, page_number)
    return local_matches[0] if local_matches else None


def _parse_page_number(file_path: Path, payload: Dict[str, Any]) -> int:
    metadata_page = payload.get("metadata", {}).get("page_number")
    if isinstance(metadata_page, int):
        return metadata_page

    stem = file_path.stem
    if "_" in stem:
        suffix = stem.split("_")[-1]
        if suffix.isdigit():
            return int(suffix)

    return 1


def _load_story_pages(stories_root: Path, story_dir: Path) -> List[Dict[str, Any]]:
    yml_dir = story_dir / "ymls"
    source_dir = yml_dir if yml_dir.is_dir() else story_dir
    page_files = sorted(
        [p for p in source_dir.iterdir() if p.is_file() and p.suffix.lower() in {".yml", ".yaml"}],
        key=lambda path: path.name.lower(),
    )

    pages: List[Dict[str, Any]] = []
    for page_file in page_files:
        try:
            with page_file.open("r", encoding="utf-8") as handle:
                payload = yaml.safe_load(handle) or {}
        except (yaml.YAMLError, OSError):
            continue

        page_number = _parse_page_number(page_file, payload)
        posts_payload = payload.get("posts", []) if isinstance(payload.get("posts"), list) else []
        page_root_images = payload.get("images", []) if isinstance(payload.get("images"), list) else []

        posts: List[Dict[str, Any]] = []
        page_tags: set[str] = set()
        post_image_urls_for_page: List[str] = []

        for idx, post in enumerate(posts_payload, start=1):
            if not isinstance(post, dict):
                continue

            post_id = post.get("post_id") if isinstance(post.get("post_id"), int) else idx
            post_tags = post.get("tags", []) if isinstance(post.get("tags"), list) else []
            for tag in post_tags:
                if isinstance(tag, str) and tag.strip():
                    page_tags.add(tag.strip())

            post_images = post.get("images", []) if isinstance(post.get("images"), list) else []
            for image_url in post_images:
                if isinstance(image_url, str) and image_url.strip():
                    post_image_urls_for_page.append(image_url.strip())

            statistics = post.get("statistics", {}) if isinstance(post.get("statistics"), dict) else {}
            posts.append(
                {
                    "post_id": post_id,
                    "content": str(post.get("content") or ""),
                    "is_comment": bool(post.get("is_comment")),
                    "images": [img for img in post_images if isinstance(img, str) and img.strip()],
                    "tags": [tag for tag in post_tags if isinstance(tag, str) and tag.strip()],
                    "word_count": statistics.get("word_count") if isinstance(statistics.get("word_count"), int) else None,
                    "char_count": statistics.get("char_count") if isinstance(statistics.get("char_count"), int) else None,
                }
            )

        page_local_images = _find_page_local_images(stories_root, story_dir, page_number)
        page_thumbnail = _find_page_thumbnail(stories_root, story_dir, page_number)
        page_images: List[str] = []
        for image in [*page_local_images, *page_root_images, *post_image_urls_for_page]:
            if isinstance(image, str) and image.strip() and image.strip() not in page_images:
                page_images.append(image.strip())

        pages.append(
            {
                "page_number": page_number,
                "source_file": page_file.name,
                "metadata": payload.get("metadata", {}) if isinstance(payload.get("metadata"), dict) else {},
                "tags": sorted(page_tags),
                "posts": sorted(posts, key=lambda item: item["post_id"]),
                "post_count": len(posts),
                "thumbnail": page_thumbnail,
                "images": page_images,
            }
        )

    return sorted(pages, key=lambda page: page["page_number"])


def _load_stories_data(stories_folder: str) -> List[Dict[str, Any]]:
    stories_root = _resolve_story_root(stories_folder)
    if not stories_root:
        return []

    stories_root_stories = stories_root / "stories"
    if not stories_root_stories.exists() or not stories_root_stories.is_dir():
        return []

    stories: List[Dict[str, Any]] = []
    for story_dir in sorted(stories_root_stories.iterdir(), key=lambda item: item.name.lower()):
        if not story_dir.is_dir() or story_dir.name.startswith("."):
            continue

        pages = _load_story_pages(stories_root, story_dir)
        if not pages:
            continue

        tags: set[str] = set()
        for page in pages:
            for tag in page.get("tags", []):
                tags.add(tag)

        stories.append(
            {
                "slug": story_dir.name,
                "title": story_dir.name.replace("-", " ").title(),
                "thumbnail": _find_story_thumbnail(stories_root, story_dir),
                "pages": pages,
                "page_count": len(pages),
                "post_count": sum(page["post_count"] for page in pages),
                "tags": sorted(tags),
            }
        )

    return stories


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


@router.get("/browse/captions", response_class=HTMLResponse)
def browse_captions_page(request: Request):
    """Browse captions folder page."""
    return templates.TemplateResponse(request, "browse.html", {"page": "browse", "browse": "captions"})


@router.get("/browse/xos", response_class=HTMLResponse)
def browse_xos_page(request: Request):
    """Browse XOS folder page."""
    return templates.TemplateResponse(request, "browse.html", {"page": "browse", "browse": "xos"})


@router.get("/stories", response_class=HTMLResponse)
def stories_page(request: Request, story: Optional[str] = None, page: Optional[int] = None, post: Optional[int] = None):
    """Story reader page for browsing stories as story > page > post."""
    stories_folder = request.app.state.config_manager.get_stories_folder()
    stories = _load_stories_data(stories_folder)

    if not stories:
        return templates.TemplateResponse(
            request,
            "stories.html",
            {
                "page": "stories",
                "stories": [],
                "active_story": None,
                "active_page": None,
                "active_post": None,
                "prev_page": None,
                "next_page": None,
                "prev_post": None,
                "next_post": None,
                "breadcrumb": [],
            },
        )

    active_story = next((item for item in stories if item["slug"] == story), stories[0])
    active_pages = active_story["pages"]

    active_page = None
    if page is not None:
        active_page = next((item for item in active_pages if item["page_number"] == page), None)
    if active_page is None:
        active_page = active_pages[0]

    active_posts = active_page["posts"]
    active_post = None
    if post is not None:
        active_post = next((item for item in active_posts if item["post_id"] == post), None)
    if active_post is None and active_posts:
        active_post = active_posts[0]

    page_index = active_pages.index(active_page)
    prev_page = active_pages[page_index - 1] if page_index > 0 else None
    next_page = active_pages[page_index + 1] if page_index < len(active_pages) - 1 else None

    prev_post = None
    next_post = None
    if active_post:
        post_index = active_posts.index(active_post)
        prev_post = active_posts[post_index - 1] if post_index > 0 else None
        next_post = active_posts[post_index + 1] if post_index < len(active_posts) - 1 else None

    breadcrumb = [
        {"label": active_story["title"], "kind": "story"},
        {"label": f"Page {active_page['page_number']}", "kind": "page"},
    ]
    if active_post:
        breadcrumb.append({"label": f"Post {active_post['post_id']}", "kind": "post"})

    return templates.TemplateResponse(
        request,
        "stories.html",
        {
            "page": "stories",
            "stories": stories,
            "active_story": active_story,
            "active_page": active_page,
            "active_post": active_post,
            "prev_page": prev_page,
            "next_page": next_page,
            "prev_post": prev_post,
            "next_post": next_post,
            "breadcrumb": breadcrumb,
        },
    )
