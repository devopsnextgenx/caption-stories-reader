"""
Story service: loads story metadata from content.yml or by scanning stories/ folder.
Uses in-memory caching with TTL.
"""

import os
import time
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from urllib.parse import quote

import yaml

logger = logging.getLogger(__name__)


class StoryService:
    """Service for loading story data with in-memory caching and TTL."""

    def __init__(self, stories_root: str, cache_ttl: int = 60):
        """
        Args:
            stories_root: Path to the root folder containing content.yml and stories/.
            cache_ttl: Time-to-live in seconds for cached data.
        """
        self.stories_root = Path(stories_root).expanduser().resolve()
        self.cache_ttl = cache_ttl
        self._cache: Dict[str, Tuple[float, Any]] = {}
        logger.info("StoryService initialized with root: %s", self.stories_root)

    def _is_fresh(self, key: str) -> bool:
        if key not in self._cache:
            return False
        timestamp, _ = self._cache[key]
        return (time.time() - timestamp) < self.cache_ttl

    def _get_cached(self, key: str) -> Optional[Any]:
        if self._is_fresh(key):
            return self._cache[key][1]
        return None

    def _set_cache(self, key: str, data: Any) -> None:
        self._cache[key] = (time.time(), data)

    def _to_static_url(self, rel_path: Path) -> str:
        """Convert a file path relative to stories_root to a /stories/ URL."""
        return f"/stories/{quote(str(rel_path).replace(os.sep, '/'), safe='/')}"

    def _find_image_files(self, story_dir: Path, prefix: str) -> List[str]:
        """Find images in story_dir/imgs matching a prefix."""
        imgs_dir = story_dir / "imgs"
        if not imgs_dir.exists() or not imgs_dir.is_dir():
            return []
        results = []
        for f in sorted(imgs_dir.iterdir()):
            if not f.is_file():
                continue
            name_lower = f.name.lower()
            if name_lower.startswith(prefix) and f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                rel = f.relative_to(self.stories_root)
                results.append(self._to_static_url(rel))
        return results

    def _load_content_yml(self) -> Dict:
        """Load content.yml from stories_root."""
        content_path = self.stories_root / "content.yml"
        if not content_path.exists():
            logger.warning("content.yml not found at %s", content_path)
            return {}
        try:
            with open(content_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            logger.info("Loaded content.yml with %d story entries", len(data.get("content", {}).get("stories", [])))
            return data
        except Exception as e:
            logger.error("Failed to parse content.yml: %s", e)
            return {}

    def _scan_stories_folder(self) -> List[Path]:
        """Scan the stories/ subfolder for story directories."""
        stories_folder = self.stories_root / "stories"
        if not stories_folder.exists() or not stories_folder.is_dir():
            logger.warning("stories/ folder not found at %s", stories_folder)
            return []
        dirs = [d for d in stories_folder.iterdir() if d.is_dir() and not d.name.startswith(".")]
        logger.info("Found %d story directories in stories/", len(dirs))
        return dirs

    def get_stories_list(self) -> List[Dict]:
        """
        Return a lightweight list of all stories.
        Uses content.yml for metadata, falls back to scanning stories/.
        """
        cache_key = "stories_list"
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        content = self._load_content_yml()
        stories_config = content.get("content", {}).get("stories", [])
        story_dirs = self._scan_stories_folder()

        # If we have content.yml entries, use them; otherwise fallback to scanning.
        stories = []
        if stories_config:
            # Use content.yml as source of truth
            for entry in stories_config:
                path_str = entry.get("path", "")
                if not path_str:
                    continue
                story_path = self.stories_root / path_str
                # The story directory is the parent of the ymls folder if path ends with ymls
                if story_path.name == "ymls":
                    story_dir = story_path.parent
                else:
                    story_dir = story_path
                if not story_dir.exists():
                    logger.warning("Story directory not found for path %s", story_path)
                    continue
                slug = story_dir.name
                # If slug not in story_dirs (maybe path points elsewhere), still include
                stories.append({
                    "slug": slug,
                    "title": entry.get("title", slug.replace("-", " ").title()),
                    "description": entry.get("description", ""),
                    "thumbnail": self._find_thumbnail(story_dir),
                    "page_count": self._count_pages(story_dir),
                    "search_prioritize": entry.get("searchPrioritize", False),
                })
        else:
            # Fallback: scan stories/ and use folder names
            for story_dir in story_dirs:
                slug = story_dir.name
                stories.append({
                    "slug": slug,
                    "title": slug.replace("-", " ").title(),
                    "description": "",
                    "thumbnail": self._find_thumbnail(story_dir),
                    "page_count": self._count_pages(story_dir),
                    "search_prioritize": False,
                })

        # Sort: prioritized first, then by title
        stories.sort(key=lambda s: (not s["search_prioritize"], s["title"].lower()))
        logger.info("Returning %d stories", len(stories))
        self._set_cache(cache_key, stories)
        return stories

    def _find_thumbnail(self, story_dir: Path) -> Optional[str]:
        """Find thumbnail image in story_dir or imgs/."""
        for thumb_candidate in [
            story_dir / "thumbnail.jpg",
            story_dir / "thumbnail.png",
            story_dir / "imgs" / "thumbnail.jpg",
            story_dir / "imgs" / "thumbnail.png",
        ]:
            if thumb_candidate.exists():
                rel = thumb_candidate.relative_to(self.stories_root)
                return self._to_static_url(rel)
        return None

    def _count_pages(self, story_dir: Path) -> int:
        """Count page YAML files in the story directory."""
        ymls_dir = story_dir / "ymls"
        if ymls_dir.exists():
            page_files = list(ymls_dir.glob("*.yml")) + list(ymls_dir.glob("*.yaml"))
        else:
            page_files = list(story_dir.glob("*.yml")) + list(story_dir.glob("*.yaml"))
        return len(page_files)

    def get_story_detail(self, slug: str) -> Optional[Dict]:
        """Load detailed story info: pages with thumbnails, tags, and first post preview."""
        cache_key = f"story_{slug}"
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        # Locate story directory
        story_dir = self._find_story_dir(slug)
        if story_dir is None:
            logger.warning("Story directory not found for slug %s", slug)
            return None

        pages = self._load_pages_for_story(story_dir)
        if not pages:
            logger.warning("No pages found for story %s", slug)
            return None

        # Aggregate tags
        all_tags = set()
        for p in pages:
            all_tags.update(p.get("tags", []))

        # Get metadata from content.yml if available
        content = self._load_content_yml()
        stories_config = content.get("content", {}).get("stories", [])
        title = slug.replace("-", " ").title()
        description = ""
        for entry in stories_config:
            path_str = entry.get("path", "")
            if not path_str:
                continue
            p = self.stories_root / path_str
            if p.parent.name == slug:
                title = entry.get("title", title)
                description = entry.get("description", "")
                break

        story_data = {
            "slug": slug,
            "title": title,
            "description": description,
            "thumbnail": self._find_thumbnail(story_dir),
            "pages": pages,
            "page_count": len(pages),
            "tags": sorted(all_tags),
        }
        self._set_cache(cache_key, story_data)
        return story_data

    def _find_story_dir(self, slug: str) -> Optional[Path]:
        """Find story directory by slug, using content.yml first, then scanning."""
        content = self._load_content_yml()
        stories_config = content.get("content", {}).get("stories", [])
        for entry in stories_config:
            path_str = entry.get("path", "")
            if not path_str:
                continue
            p = self.stories_root / path_str
            if p.name == "ymls":
                story_dir = p.parent
            else:
                story_dir = p
            if story_dir.name == slug and story_dir.exists():
                return story_dir

        # Fallback: scan stories/
        story_dir = self.stories_root / "stories" / slug
        if story_dir.exists() and story_dir.is_dir():
            return story_dir
        return None

    def _load_pages_for_story(self, story_dir: Path) -> List[Dict]:
        """Load all pages (metadata only) for a story."""
        ymls_dir = story_dir / "ymls"
        if ymls_dir.exists():
            page_files = sorted(ymls_dir.glob("*.yml")) + sorted(ymls_dir.glob("*.yaml"))
        else:
            page_files = sorted(story_dir.glob("*.yml")) + sorted(story_dir.glob("*.yaml"))

        pages = []
        for pf in page_files:
            try:
                with open(pf, "r", encoding="utf-8") as f:
                    payload = yaml.safe_load(f) or {}
            except Exception as e:
                logger.warning("Failed to parse %s: %s", pf, e)
                continue

            # Determine page number
            page_num = payload.get("metadata", {}).get("page_number")
            if page_num is None:
                stem = pf.stem
                if stem.startswith("page_"):
                    num_str = stem.replace("page_", "")
                    if num_str.isdigit():
                        page_num = int(num_str)
                elif stem.isdigit():
                    page_num = int(stem)
                else:
                    page_num = 1

            tags = set()
            posts = payload.get("posts", [])
            for post in posts:
                if isinstance(post, dict):
                    for tag in post.get("tags", []):
                        if isinstance(tag, str) and tag.strip():
                            tags.add(tag.strip())

            thumbnail = self._find_page_thumbnail(story_dir, page_num)

            # First post preview
            first_post = None
            if posts and isinstance(posts[0], dict):
                content = posts[0].get("content", "")
                preview = content[:200] + "..." if len(content) > 200 else content
                first_post = {
                    "post_id": posts[0].get("post_id", 1),
                    "preview": preview,
                }

            pages.append({
                "page_number": page_num,
                "thumbnail": thumbnail,
                "post_count": len(posts),
                "tags": sorted(tags),
                "first_post": first_post,
            })

        pages.sort(key=lambda p: p["page_number"])
        return pages

    def _find_page_thumbnail(self, story_dir: Path, page_num: int) -> Optional[str]:
        """Find thumbnail for a specific page."""
        # Try story_dir/imgs/page_num.ext
        for ext in [".jpg", ".jpeg", ".png", ".webp"]:
            thumb_path = story_dir / "imgs" / f"{page_num}{ext}"
            if thumb_path.exists():
                rel = thumb_path.relative_to(self.stories_root)
                return self._to_static_url(rel)
        # Try prefix match
        imgs = self._find_image_files(story_dir, f"{page_num}.")
        if imgs:
            return imgs[0]
        return None

    def get_page_detail(self, slug: str, page_number: int) -> Optional[Dict]:
        """Load full page data: all posts with content, images, tags."""
        cache_key = f"page_{slug}_{page_number}"
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        story_dir = self._find_story_dir(slug)
        if story_dir is None:
            return None

        # Find the YAML file for this page
        ymls_dir = story_dir / "ymls"
        if ymls_dir.exists():
            candidates = list(ymls_dir.glob(f"*{page_number}*.yml")) + list(ymls_dir.glob(f"*{page_number}*.yaml"))
        else:
            candidates = list(story_dir.glob(f"*{page_number}*.yml")) + list(story_dir.glob(f"*{page_number}*.yaml"))

        if not candidates:
            logger.warning("Page YAML not found for story %s page %d", slug, page_number)
            return None

        page_file = candidates[0]
        try:
            with open(page_file, "r", encoding="utf-8") as f:
                payload = yaml.safe_load(f) or {}
        except Exception as e:
            logger.error("Failed to parse page file %s: %s", page_file, e)
            return None

        posts_payload = payload.get("posts", [])
        posts = []
        for idx, post in enumerate(posts_payload, 1):
            if not isinstance(post, dict):
                continue
            post_id = post.get("post_id", idx)
            content = post.get("content", "")
            is_comment = post.get("is_comment", False)
            images = [img for img in post.get("images", []) if isinstance(img, str) and img.strip()]
            tags = [tag for tag in post.get("tags", []) if isinstance(tag, str) and tag.strip()]
            stats = post.get("statistics", {})
            word_count = stats.get("word_count") if isinstance(stats.get("word_count"), int) else None
            char_count = stats.get("char_count") if isinstance(stats.get("char_count"), int) else None

            posts.append({
                "post_id": post_id,
                "content": content,
                "is_comment": is_comment,
                "images": images,
                "tags": tags,
                "word_count": word_count,
                "char_count": char_count,
            })

        # Page-level images from YAML
        page_images = payload.get("images", [])
        if not isinstance(page_images, list):
            page_images = []

        # Local images in imgs folder matching page number
        local_images = self._find_image_files(story_dir, f"{page_number}.")
        all_images = list(dict.fromkeys(local_images + page_images + [img for post in posts for img in post.get("images", [])]))

        all_tags = set()
        for p in posts:
            all_tags.update(p.get("tags", []))

        page_data = {
            "page_number": page_number,
            "posts": posts,
            "post_count": len(posts),
            "images": all_images,
            "tags": sorted(all_tags),
            "metadata": payload.get("metadata", {}),
        }
        self._set_cache(cache_key, page_data)
        return page_data

    def get_post_detail(self, slug: str, page_number: int, post_id: int) -> Optional[Dict]:
        """Load a single post's full data."""
        page_data = self.get_page_detail(slug, page_number)
        if not page_data:
            return None
        for post in page_data["posts"]:
            if post["post_id"] == post_id:
                return post
        return None