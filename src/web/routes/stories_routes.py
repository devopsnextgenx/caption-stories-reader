"""
REST API routes for Stories Reader.
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
from ...stories.stories import StoryService

router = APIRouter(prefix="/api/stories", tags=["Stories"])


def get_story_service(request: Request) -> StoryService:
    """Dependency to get StoryService from app state."""
    stories_folder = request.app.state.config_manager.get_stories_folder()
    if not stories_folder:
        raise HTTPException(status_code=500, detail="Stories folder not configured")
    # We can instantiate per request or cache in app state
    if not hasattr(request.app.state, "story_service"):
        request.app.state.story_service = StoryService(stories_folder)
    return request.app.state.story_service


@router.get("/", response_model=List[dict])
async def list_stories(service: StoryService = Depends(get_story_service)):
    """Get list of all stories (lightweight)."""
    return service.get_stories_list()


@router.get("/{slug}", response_model=dict)
async def get_story(slug: str, service: StoryService = Depends(get_story_service)):
    """Get detailed story info (pages with metadata)."""
    story = service.get_story_detail(slug)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    return story


@router.get("/{slug}/pages/{page_number}", response_model=dict)
async def get_page(slug: str, page_number: int, service: StoryService = Depends(get_story_service)):
    """Get full page data including all posts."""
    page = service.get_page_detail(slug, page_number)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return page


@router.get("/{slug}/pages/{page_number}/posts/{post_id}", response_model=dict)
async def get_post(slug: str, page_number: int, post_id: int, service: StoryService = Depends(get_story_service)):
    """Get a single post's full content."""
    post = service.get_post_detail(slug, page_number, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return post