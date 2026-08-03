// static/js/stories.js

const STORIES_CACHE_DB = 'StoriesCache';
const STORIES_CACHE_STORE = 'apiResponses';
const CACHE_EXPIRY_DAYS = 3;

// ----- IndexedDB helpers -----
function openCacheDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(STORIES_CACHE_DB, 1);
        request.onupgradeneeded = (ev) => {
            const db = ev.target.result;
            if (!db.objectStoreNames.contains(STORIES_CACHE_STORE)) {
                db.createObjectStore(STORIES_CACHE_STORE, { keyPath: 'url' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

window.addEventListener('keydown', (e) => {
    const overlay = document.getElementById('reading-overlay');
    // Only capture event context if overlay element window view is visibly active
    if (e.key === 'Escape' && overlay && overlay.style.display === 'flex') {
        closeReadingMode();
    }
});

async function getCacheEntry(url) {
    const db = await openCacheDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORIES_CACHE_STORE, 'readonly');
        const store = tx.objectStore(STORIES_CACHE_STORE);
        const getReq = store.get(url);
        getReq.onsuccess = () => {
            const entry = getReq.result;
            if (!entry) return resolve(null);
            const now = Date.now();
            const expiry = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
            if (now - entry.timestamp > expiry) {
                const delTx = db.transaction(STORIES_CACHE_STORE, 'readwrite');
                delTx.objectStore(STORIES_CACHE_STORE).delete(url);
                return resolve(null);
            }
            resolve(entry.data);
        };
        getReq.onerror = () => reject(getReq.error);
    });
}

async function setCacheEntry(url, data) {
    const db = await openCacheDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORIES_CACHE_STORE, 'readwrite');
        const store = tx.objectStore(STORIES_CACHE_STORE);
        const entry = { url, data, timestamp: Date.now() };
        const putReq = store.put(entry);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
    });
}

// Clear Database Cache Function
async function purgeIndexedDBCache() {
    try {
        const db = await openCacheDB();
        const tx = db.transaction(STORIES_CACHE_STORE, 'readwrite');
        const store = tx.objectStore(STORIES_CACHE_STORE);
        const clearReq = store.clear();
        
        return new Promise((resolve, reject) => {
            clearReq.onsuccess = () => {
                console.log("IndexedDB cache successfully purged.");
                resolve();
            };
            clearReq.onerror = () => reject(clearReq.error);
        });
    } catch (err) {
        console.error("Error purging cache database:", err);
    }
}

// ----- API fetch with cache -----
async function fetchWithCache(url, forceRefresh = false) {
    if (!forceRefresh) {
        const cached = await getCacheEntry(url);
        if (cached) return cached;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    await setCacheEntry(url, data);
    return data;
}

// ----- State -----
let state = {
    stories: [],
    activeStorySlug: null,
    activePageNumber: null, // kept for backward compatibility if needed elsewhere
    activePageIndex: 0,     // Enforces exact trackable UI indexes
    activePostId: null,
    storyData: null,
    pageData: null,
};

// ----- DOM refs -----
const appContainer = document.getElementById('stories-app');

// ----- Rendering functions -----
function renderLayoutStructure() {
    const storiesListHtml = state.stories.map(s => `
        <a class="story-item ${state.activeStorySlug === s.slug ? 'active' : ''}" 
           data-slug="${s.slug}" href="#">
            ${s.thumbnail ? `<img src="${s.thumbnail}" alt="${s.title}" class="story-thumb">` : 
             `<div class="story-thumb story-thumb-fallback">📚</div>`}
            <div class="story-item-content">
                <div class="story-item-title" title="${s.title}">${s.title}</div>
                <div class="story-item-meta">${s.page_count} pages</div>
            </div>
        </a>
    `).join('');

    return `
        <div class="stories-layout">
            <!-- Left Sidebar exclusively containing stories -->
            <aside class="stories-sidebar">
                <section class="stories-panel">
                    <h2 class="stories-panel-title">Stories</h2>
                    <div class="stories-list">${storiesListHtml}</div>
                </section>
            </aside>
            
            <!-- Main Content Container containing Post reader & Bottom Pagination -->
            <div class="stories-main-content-wrapper">
                <section class="stories-reader" id="reader-panel">
                    ${state.pageData ? renderPostMainContainer(state.pageData) : '<div class="placeholder">Select a story or page to view posts</div>'}
                </section>
                
                <!-- Blog Style page numbers at bottom -->
                <nav class="blog-pagination-panel" id="pagination-panel">
                    ${state.storyData ? renderBlogPaginationRow(state.storyData.pages) : '<span>Select a story to view thread pages</span>'}
                </nav>
            </div>
        </div>
    `;
}

function renderPostMainContainer(pageData) {
    const currentPostIndex = pageData.posts.findIndex(p => p.post_id === state.activePostId);
    
    const postsNumbersHtml = pageData.posts.map((post, idx) => `
        <a class="page-num-link ${state.activePostId === post.post_id ? 'active' : ''}" 
           data-post="${post.post_id}" href="#">${idx + 1}</a>
    `).join('');

    const prevPostClass = currentPostIndex > 0 ? '' : 'disabled';
    const nextPostClass = currentPostIndex < pageData.posts.length - 1 ? '' : 'disabled';
    
    // Explicitly enforce that the option values are stringified post_id primitives
    const dropdownOptions = pageData.posts.map((p, idx) => `
        <option value="${p.post_id}" ${state.activePostId === p.post_id ? 'selected' : ''}>
            Post ${idx + 1} (ID: ${p.post_id})
        </option>
    `).join('');

    let activePostCardHtml = '<div class="placeholder">Select a post to display content</div>';
    if (state.activePostId) {
        const post = pageData.posts.find(p => p.post_id === state.activePostId);
        if (post) {
            const targetImages = post.images || pageData.images || [];
            const imagesHtml = targetImages.length ? `
                <div class="story-media-grid post-media-grid" style="margin-bottom: 1rem;">
                    ${targetImages.map(img => `<img src="${img}" alt="post attachment image" class="story-media-item" style="max-width:100%; height:auto; border-radius:8px;">`).join('')}
                </div>
            ` : '';

            activePostCardHtml = `
                <article class="story-post-card">
                    <header class="story-post-header">
                        <h2 class="story-post-title">Post ${post.post_id}</h2>
                        <div class="story-post-stats">
                            ${post.word_count ? `<span>${post.word_count} words</span>` : ''}
                            ${post.is_comment ? '<span>Comment</span>' : '<span>Main Post</span>'}
                        </div>
                    </header>
                    ${imagesHtml}
                    <div class="story-post-content">${post.content}</div>
                    <div style="margin-top:1.5rem;">
                         <button class="btn-reading-mode btn btn-secondary btn-sm" data-post-id="${post.post_id}">Full Screen Reading Mode</button>
                    </div>
                </article>
            `;
        }
    }

    return `
        <div class="post-inline-navigation">
            <div class="pagination-numbers-container">
                <span class="pagination-label" style="margin-right:0.5rem;">Posts:</span>
                <a href="#" class="pagination-nav-arrow ${prevPostClass}" data-post-nav="prev">◄</a>
                ${postsNumbersHtml}
                <a href="#" class="pagination-nav-arrow ${nextPostClass}" data-post-nav="next">►</a>
            </div>
            <div>
                <select id="dropdown-select-post" class="select-dropdown-ui">
                    <option value="" disabled ${!state.activePostId ? 'selected' : ''}>Select Post ▼</option>
                    ${dropdownOptions}
                </select>
            </div>
        </div>
        
        <div class="active-post-container">
            ${activePostCardHtml}
        </div>
    `;
}

function renderBlogPaginationRow(pages) {
    // Rely strictly on our trackable state index rather than data property text lookups
    const activeIdx = state.activePageIndex; 
    
    const pagesNumbersHtml = pages.map((p, idx) => `
        <a class="page-num-link ${activeIdx === idx ? 'active' : ''}" 
           data-page-idx="${idx}" href="#">${idx + 1}</a>
    `).join('');

    const prevPageClass = activeIdx > 0 ? '' : 'disabled';
    const nextPageClass = activeIdx < pages.length - 1 ? '' : 'disabled';

    const dropdownOptions = pages.map((p, idx) => `
        <option value="${idx}" ${activeIdx === idx ? 'selected' : ''}>
            Page ${idx + 1}
        </option>
    `).join('');

    return `
        <div class="pagination-numbers-container">
            <span class="pagination-label" style="margin-right:0.5rem;">Pages:</span>
            <a href="#" class="pagination-nav-arrow ${prevPageClass}" data-page-nav="prev" data-current-idx="${activeIdx}">◄</a>
            ${pagesNumbersHtml}
            <a href="#" class="pagination-nav-arrow ${nextPageClass}" data-page-nav="next" data-current-idx="${activeIdx}">►</a>
        </div>
        <div>
            <select id="dropdown-select-page" class="select-dropdown-ui">
                <option value="" disabled ${activeIdx === -1 ? 'selected' : ''}>Select Page ▼</option>
                ${dropdownOptions}
            </select>
        </div>
    `;
}

// ----- Navigation Logic -----
async function loadPage(slug, pageIndex, forceRefresh = false) {
    const pageItem = state.storyData.pages[pageIndex];
    if (!pageItem) return;

    // Save the exact index inside state variables
    state.activePageIndex = pageIndex;
    state.activePageNumber = pageItem.page_number; 
    
    const targetPageNum = pageItem.page_number;
    const urlParam = (targetPageNum === 1 && pageIndex > 0) ? (pageIndex + 1) : targetPageNum;

    state.pageData = await fetchWithCache(`/api/stories/${slug}/pages/${urlParam}`, forceRefresh);
    
    if (state.pageData.posts && state.pageData.posts.length) {
        state.activePostId = state.pageData.posts[0].post_id;
    } else {
        state.activePostId = null;
    }
    
    renderApp();
}

// Ensure loadStory also hooks into index 0 on start
async function loadStory(slug, forceRefresh = false) {
    state.activeStorySlug = slug;
    state.activePageIndex = 0; // reset index to first item
    state.activePageNumber = null;
    state.activePostId = null;
    state.storyData = await fetchWithCache(`/api/stories/${slug}`, forceRefresh);
    state.pageData = null;
    
    if (state.storyData.pages && state.storyData.pages.length) {
        await loadPage(slug, 0, forceRefresh);
    } else {
        renderApp();
    }
}

function loadPost(postId) {
    state.activePostId = parseInt(postId);
    renderApp();
}

function renderApp() {
    if (!state.stories.length) {
        appContainer.innerHTML = '<div class="loading-indicator">Loading stories...</div>';
        return;
    }

    // 1. Capture the current scroll position of the stories list before re-rendering
    const storiesListEl = document.querySelector('.stories-list');
    const savedScrollTop = storiesListEl ? storiesListEl.scrollTop : 0;

    // 2. Render the new layout and attach listeners
    appContainer.innerHTML = renderLayoutStructure();
    attachEventListeners();

    // 3. Restore the scroll position and ensure the active item is visible
    const newStoriesListEl = document.querySelector('.stories-list');
    if (newStoriesListEl) {
        newStoriesListEl.scrollTop = savedScrollTop;

        // Safely bring the selected active item into view if it shifted out of bounds
        const activeItem = newStoriesListEl.querySelector('.story-item.active');
        if (activeItem) {
            activeItem.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
    }
}

function attachEventListeners() {
    // Stories selection sidebar clicks
    document.querySelectorAll('.story-item').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const slug = el.dataset.slug;
            if (slug !== state.activeStorySlug) {
                loadStory(slug);
            }
        });
    });

    // Thread Page specific numbers click
    document.querySelectorAll('.page-num-link[data-page-idx]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const pageIdx = parseInt(el.dataset.pageIdx);
            loadPage(state.activeStorySlug, pageIdx);
        });
    });

    // Thread Post specific numbers click
    document.querySelectorAll('.page-num-link[data-post]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            loadPost(el.dataset.post);
        });
    });

    // Dropdown selectors post & page
    const pageDropdown = document.getElementById('dropdown-select-page');
    if (pageDropdown) {
        pageDropdown.addEventListener('change', (e) => {
            const pageIdx = parseInt(e.target.value);
            loadPage(state.activeStorySlug, pageIdx);
        });
    }

    const postDropdown = document.getElementById('dropdown-select-post');
    if (postDropdown) {
        postDropdown.addEventListener('change', (e) => {
            // Enforce strict numeric type conversion
            const selectedPostId = parseInt(e.target.value, 10);
            if (!isNaN(selectedPostId)) {
                loadPost(selectedPostId);
            }
        });
    }
    // Previous/Next page arrows 
    document.querySelectorAll('[data-page-nav]').forEach(arrow => {
        arrow.addEventListener('click', async (e) => {
            e.preventDefault();
            const action = arrow.dataset.pageNav;
            const currentIdx = parseInt(arrow.dataset.currentIdx);
            
            if (action === 'prev' && currentIdx > 0) {
                await loadPage(state.activeStorySlug, currentIdx - 1);
            } else if (action === 'next' && currentIdx < state.storyData.pages.length - 1) {
                await loadPage(state.activeStorySlug, currentIdx + 1);
            }
        });
    });

    // Previous/Next post arrows
    document.querySelectorAll('[data-post-nav]').forEach(arrow => {
        arrow.addEventListener('click', (e) => {
            e.preventDefault();
            const action = arrow.dataset.postNav;
            const posts = state.pageData.posts;
            const currentIdx = posts.findIndex(p => p.post_id === state.activePostId);
            if (action === 'prev' && currentIdx > 0) {
                loadPost(posts[currentIdx - 1].post_id);
            } else if (action === 'next' && currentIdx < posts.length - 1) {
                loadPost(posts[currentIdx + 1].post_id);
            }
        });
    });

    // Full screen overlay viewing mode toggle
    document.querySelectorAll('.btn-reading-mode').forEach(btn => {
        btn.addEventListener('click', () => {
            const postId = parseInt(btn.dataset.postId);
            const post = state.pageData.posts.find(p => p.post_id === postId);
            if (post) openReadingMode(post, state.activeStorySlug, state.activePageNumber);
        });
    });

    // Previous Post inside Overlay
    const overlayPrevPost = document.getElementById('reading-prev-post');
    if (overlayPrevPost) {
        overlayPrevPost.onclick = (e) => {
            e.preventDefault();
            const posts = state.pageData.posts;
            const currentIdx = posts.findIndex(p => p.post_id === state.activePostId);
            if (currentIdx > 0) {
                const nextPost = posts[currentIdx - 1];
                loadPost(nextPost.post_id);
                openReadingMode(nextPost, state.activeStorySlug, state.activePageNumber);
            }
        };
    }

    // Next Post inside Overlay
    const overlayNextPost = document.getElementById('reading-next-post');
    if (overlayNextPost) {
        overlayNextPost.onclick = (e) => {
            e.preventDefault();
            const posts = state.pageData.posts;
            const currentIdx = posts.findIndex(p => p.post_id === state.activePostId);
            if (currentIdx < posts.length - 1) {
                const nextPost = posts[currentIdx + 1];
                loadPost(nextPost.post_id);
                openReadingMode(nextPost, state.activeStorySlug, state.activePageNumber);
            }
        };
    }

    // Previous Page inside Overlay
    const overlayPrevPage = document.getElementById('reading-prev-page');
    if (overlayPrevPage) {
        overlayPrevPage.onclick = async (e) => {
            e.preventDefault();
            const currentIdx = state.activePageIndex;
            if (currentIdx > 0) {
                await loadPage(state.activeStorySlug, currentIdx - 1);
                // Auto-open reading window for the first post on the new page
                if (state.pageData.posts && state.pageData.posts.length) {
                    openReadingMode(state.pageData.posts[0], state.activeStorySlug, state.activePageNumber);
                }
            }
        };
    }

    // Next Page inside Overlay
    const overlayNextPage = document.getElementById('reading-next-page');
    if (overlayNextPage) {
        overlayNextPage.onclick = async (e) => {
            e.preventDefault();
            const currentIdx = state.activePageIndex;
            if (currentIdx < state.storyData.pages.length - 1) {
                await loadPage(state.activeStorySlug, currentIdx + 1);
                // Auto-open reading window for the first post on the new page
                if (state.pageData.posts && state.pageData.posts.length) {
                    openReadingMode(state.pageData.posts[0], state.activeStorySlug, state.activePageNumber);
                }
            }
        };
    }
}

// ----- Reading Mode Overlay functions -----
// ----- Updated Reading Mode Overlay functions -----
function openReadingMode(post, slug, pageNumber) {
    const overlay = document.getElementById('reading-overlay');
    const contentDiv = document.getElementById('reading-content');
    
    contentDiv.innerHTML = `
        <h2>Post ${post.post_id}</h2>
        <div class="story-post-content">${post.content}</div>
        ${post.images && post.images.length ? `<div class="story-media-grid">${post.images.map(img => `<img src="${img}" alt="post image" class="story-media-item">`).join('')}</div>` : ''}
    `;
    overlay.style.display = 'flex';

    const posts = state.pageData.posts;
    const currentIndex = posts.findIndex(p => p.post_id === post.post_id);
    const pageIndex = state.activePageIndex;

    // Grab elements
    const prevPageBtn = document.getElementById('reading-prev-page');
    const prevPostBtn = document.getElementById('reading-prev-post');
    const nextPostBtn = document.getElementById('reading-next-post');
    const nextPageBtn = document.getElementById('reading-next-page');

    // Keep visible but conditionally apply standard disabled DOM states
    if (prevPageBtn) prevPageBtn.disabled = !(pageIndex > 0);
    if (prevPostBtn) prevPostBtn.disabled = !(currentIndex > 0);
    if (nextPostBtn) nextPostBtn.disabled = !(currentIndex < posts.length - 1);
    if (nextPageBtn) nextPageBtn.disabled = !(pageIndex < state.storyData.pages.length - 1);

    overlay.dataset.currentPostIndex = currentIndex;
    overlay.dataset.currentPageIndex = pageIndex;
}

function closeReadingMode() {
    document.getElementById('reading-overlay').style.display = 'none';
}

// Setup static listener configurations for global buttons
document.getElementById('reading-close-btn').addEventListener('click', closeReadingMode);
document.getElementById('reading-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeReadingMode();
});

// Setup Purge IndexDB System Handler Click Event
document.getElementById('btn-purge-cache').addEventListener('click', async () => {
    const btn = document.getElementById('btn-purge-cache');
    btn.innerText = '⌛ Purging Cache...';
    btn.disabled = true;
    
    await purgeIndexedDBCache();
    
    btn.innerText = '⚡ Fetching Backend Data...';
    try {
        // Re-load basic metadata items forcing direct non-cached backend pulls
        const stories = await fetchWithCache('/api/stories/', true);
        state.stories = stories;
        if (stories.length) {
            // Re-bootstrap back onto primary item
            await loadStory(stories[0].slug, true);
        }
        btn.innerText = '🧹 Purge Cache & Reload';
        btn.disabled = false;
    } catch(e) {
        btn.innerText = '❌ Failed Reload';
        console.error(e);
        setTimeout(() => {
            btn.innerText = '🧹 Purge Cache & Reload';
            btn.disabled = false;
        }, 3000);
    }
});

// Primary Initialization
async function init() {
    try {
        const stories = await fetchWithCache('/api/stories/');
        state.stories = stories;
        if (stories.length) {
            await loadStory(stories[0].slug);
        } else {
            appContainer.innerHTML = '<div class="card stories-empty-state"><h2>No stories found</h2></div>';
        }
    } catch (err) {
        console.error('Failed initialization step:', err);
        appContainer.innerHTML = `<div class="error">Failed to load stories: ${err.message}</div>`;
    }
}

document.addEventListener('DOMContentLoaded', init);