// static/js/stories.js

const STORIES_CACHE_DB = 'StoriesCache';
const STORIES_CACHE_STORE = 'apiResponses';
const CACHE_EXPIRY_DAYS = 3; // remove after 3 days

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

async function getCacheEntry(url) {
    const db = await openCacheDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORIES_CACHE_STORE, 'readonly');
        const store = tx.objectStore(STORIES_CACHE_STORE);
        const getReq = store.get(url);
        getReq.onsuccess = () => {
            const entry = getReq.result;
            if (!entry) return resolve(null);
            // Check expiry
            const now = Date.now();
            const expiry = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
            if (now - entry.timestamp > expiry) {
                // Delete expired entry
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

// ----- API fetch with cache -----
async function fetchWithCache(url) {
    const cached = await getCacheEntry(url);
    if (cached) {
        return cached;
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
    activePageNumber: null,
    activePostId: null,
    storyData: null,
    pageData: null,
    postData: null,
};

// ----- DOM refs -----
const appContainer = document.getElementById('stories-app');

// ----- Rendering functions -----
function renderStoriesList(stories) {
    const listHtml = stories.map(s => `
        <a class="story-item ${state.activeStorySlug === s.slug ? 'active' : ''}" 
           data-slug="${s.slug}" href="#">
            ${s.thumbnail ? `<img src="${s.thumbnail}" alt="${s.title}" class="story-thumb">` : 
             `<div class="story-thumb story-thumb-fallback">📚</div>`}
            <div class="story-item-content">
                <div class="story-item-title">${s.title}</div>
                <div class="story-item-meta">${s.page_count} pages</div>
                ${s.description ? `<div class="story-item-desc">${s.description}</div>` : ''}
            </div>
        </a>
    `).join('');

    return `
        <aside class="stories-sidebar">
            <section class="stories-panel">
                <h2 class="stories-panel-title">Stories</h2>
                <div class="stories-list">${listHtml}</div>
            </section>
            <section class="stories-panel" id="pages-panel">
                <h2 class="stories-panel-title">Pages</h2>
                <div class="story-pages-list" id="pages-list">${state.storyData ? renderPagesList(state.storyData.pages) : 'Select a story'}</div>
            </section>
        </aside>
        <section class="stories-reader" id="reader-panel">
            ${state.pageData ? renderPageContent(state.pageData) : '<div class="placeholder">Select a page to read</div>'}
        </section>
    `;
}

function renderPagesList(pages) {
    return pages.map(p => `
        <a class="story-page-item ${state.activePageNumber === p.page_number ? 'active' : ''}" 
           data-page="${p.page_number}" href="#">
            ${p.thumbnail ? `<img src="${p.thumbnail}" alt="Page ${p.page_number}" class="story-page-thumb">` :
             `<div class="story-page-thumb story-page-thumb-fallback">P${p.page_number}</div>`}
            <div class="story-page-item-content">
                <div class="story-page-title">Page ${p.page_number}</div>
                <div class="story-page-meta">${p.post_count} posts</div>
                ${p.tags && p.tags.length ? `<div class="story-tags">${p.tags.slice(0,3).map(t => `<span class="story-tag">${t}</span>`).join('')}</div>` : ''}
            </div>
        </a>
    `).join('');
}

function renderPageContent(pageData) {
    const postsHtml = pageData.posts.map(post => `
        <div class="story-post-link-wrapper">
            <a class="story-post-link ${state.activePostId === post.post_id ? 'active' : ''}" 
               data-post="${post.post_id}" href="#">
                Post ${post.post_id}
                ${post.is_comment ? ' 💬' : ''}
            </a>
            ${state.activePostId === post.post_id ? `<div class="post-preview">${post.content.substring(0, 200)}...</div>` : ''}
        </div>
    `).join('');

    const imagesHtml = pageData.images && pageData.images.length ? 
        `<div class="story-media-grid">${pageData.images.map(img => `<img src="${img}" alt="page image" class="story-media-item">`).join('')}</div>` : '';

    const tagsHtml = pageData.tags && pageData.tags.length ? 
        `<div class="story-tags-row">${pageData.tags.map(t => `<span class="story-tag">${t}</span>`).join('')}</div>` : '';

    let activePostHtml = '';
    if (state.activePostId) {
        const post = pageData.posts.find(p => p.post_id === state.activePostId);
        if (post) {
            activePostHtml = `
                <article class="story-post-card">
                    <header class="story-post-header">
                        <h2 class="story-post-title">Post ${post.post_id}</h2>
                        <div class="story-post-stats">
                            ${post.word_count ? `<span>${post.word_count} words</span>` : ''}
                            ${post.char_count ? `<span>${post.char_count} chars</span>` : ''}
                            ${post.is_comment ? '<span>Comment</span>' : '<span>Main Post</span>'}
                        </div>
                    </header>
                    ${post.tags && post.tags.length ? `<div class="story-tags-row">${post.tags.map(t => `<span class="story-tag">${t}</span>`).join('')}</div>` : ''}
                    <div class="story-post-content">${post.content}</div>
                    ${post.images && post.images.length ? `<div class="story-media-grid post-media-grid">${post.images.map(img => `<img src="${img}" alt="post image" class="story-media-item">`).join('')}</div>` : ''}
                    <button class="btn-reading-mode" data-post-id="${post.post_id}">Read Mode</button>
                </article>
            `;
        }
    }

    return `
        <nav class="story-breadcrumb">
            <span class="story-breadcrumb-item">${state.storyData.title}</span>
            <span class="story-breadcrumb-sep">/</span>
            <span class="story-breadcrumb-item">Page ${pageData.page_number}</span>
            ${state.activePostId ? `<span class="story-breadcrumb-sep">/</span><span class="story-breadcrumb-item">Post ${state.activePostId}</span>` : ''}
        </nav>

        <div class="story-reading-toolbar">
            <div class="story-toolbar-group">
                ${state.activePageNumber > 1 ? `<button class="btn btn-secondary btn-sm" data-nav="prev-page">← Prev Page</button>` : ''}
                ${state.activePageNumber < state.storyData.pages.length ? `<button class="btn btn-secondary btn-sm" data-nav="next-page">Next Page →</button>` : ''}
            </div>
            <div class="story-toolbar-group">
                ${state.activePostId ? `<button class="btn btn-secondary btn-sm" data-nav="prev-post">← Prev Post</button>` : ''}
                ${state.activePostId ? `<button class="btn btn-secondary btn-sm" data-nav="next-post">Next Post →</button>` : ''}
            </div>
        </div>

        <div class="story-post-nav">${postsHtml}</div>

        ${tagsHtml}
        ${imagesHtml}
        ${activePostHtml}
    `;
}

// ----- Navigation functions -----
async function loadStory(slug) {
    state.activeStorySlug = slug;
    state.activePageNumber = null;
    state.activePostId = null;
    state.storyData = await fetchWithCache(`/api/stories/${slug}`);
    state.pageData = null;
    renderApp();
    // Auto-select first page
    if (state.storyData.pages.length) {
        await loadPage(slug, state.storyData.pages[0].page_number);
    }
}

async function loadPage(slug, pageNumber) {
    state.activePageNumber = pageNumber;
    state.activePostId = null;
    state.pageData = await fetchWithCache(`/api/stories/${slug}/pages/${pageNumber}`);
    renderApp();
    // Auto-select first post
    if (state.pageData.posts.length) {
        await loadPost(slug, pageNumber, state.pageData.posts[0].post_id);
    }
}

async function loadPost(slug, pageNumber, postId) {
    state.activePostId = postId;
    // We already have pageData; no need to fetch post separately, but we might need full content if not present?
    // The pageData already contains full posts, so we just update state and re-render.
    renderApp();
}

function renderApp() {
    if (!state.stories.length) {
        appContainer.innerHTML = '<div class="loading-indicator">Loading stories...</div>';
        return;
    }
    const layout = renderStoriesList(state.stories);
    appContainer.innerHTML = layout;
    attachEventListeners();
}

function attachEventListeners() {
    // Story items
    document.querySelectorAll('.story-item').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const slug = el.dataset.slug;
            if (slug !== state.activeStorySlug) {
                loadStory(slug);
            }
        });
    });

    // Page items
    document.querySelectorAll('.story-page-item').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const page = parseInt(el.dataset.page);
            if (page !== state.activePageNumber) {
                loadPage(state.activeStorySlug, page);
            }
        });
    });

    // Post links
    document.querySelectorAll('.story-post-link').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const postId = parseInt(el.dataset.post);
            if (postId !== state.activePostId) {
                loadPost(state.activeStorySlug, state.activePageNumber, postId);
            }
        });
    });

    // Navigation buttons (prev/next page, prev/next post)
    document.querySelectorAll('[data-nav]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.nav;
            const pages = state.storyData.pages;
            const currentPageIndex = pages.findIndex(p => p.page_number === state.activePageNumber);
            const posts = state.pageData.posts;
            const currentPostIndex = posts.findIndex(p => p.post_id === state.activePostId);

            if (action === 'prev-page' && currentPageIndex > 0) {
                const prevPage = pages[currentPageIndex - 1];
                await loadPage(state.activeStorySlug, prevPage.page_number);
            } else if (action === 'next-page' && currentPageIndex < pages.length - 1) {
                const nextPage = pages[currentPageIndex + 1];
                await loadPage(state.activeStorySlug, nextPage.page_number);
            } else if (action === 'prev-post' && currentPostIndex > 0) {
                const prevPost = posts[currentPostIndex - 1];
                await loadPost(state.activeStorySlug, state.activePageNumber, prevPost.post_id);
            } else if (action === 'next-post' && currentPostIndex < posts.length - 1) {
                const nextPost = posts[currentPostIndex + 1];
                await loadPost(state.activeStorySlug, state.activePageNumber, nextPost.post_id);
            }
        });
    });

    // Read Mode buttons
    document.querySelectorAll('.btn-reading-mode').forEach(btn => {
        btn.addEventListener('click', () => {
            const postId = parseInt(btn.dataset.postId);
            const post = state.pageData.posts.find(p => p.post_id === postId);
            if (post) {
                openReadingMode(post, state.activeStorySlug, state.activePageNumber);
            }
        });
    });
}

// ----- Reading Mode Overlay -----
function openReadingMode(post, slug, pageNumber) {
    const overlay = document.getElementById('reading-overlay');
    const contentDiv = document.getElementById('reading-content');
    contentDiv.innerHTML = `
        <h2>Post ${post.post_id}</h2>
        ${post.tags && post.tags.length ? `<div class="story-tags-row">${post.tags.map(t => `<span class="story-tag">${t}</span>`).join('')}</div>` : ''}
        <div class="story-post-content">${post.content}</div>
        ${post.images && post.images.length ? `<div class="story-media-grid">${post.images.map(img => `<img src="${img}" alt="post image" class="story-media-item">`).join('')}</div>` : ''}
    `;
    overlay.style.display = 'flex';

    // Setup navigation in reading mode
    const posts = state.pageData.posts;
    const currentIndex = posts.findIndex(p => p.post_id === post.post_id);
    document.getElementById('reading-prev-post').style.display = currentIndex > 0 ? 'inline-block' : 'none';
    document.getElementById('reading-next-post').style.display = currentIndex < posts.length - 1 ? 'inline-block' : 'none';

    const pages = state.storyData.pages;
    const pageIndex = pages.findIndex(p => p.page_number === pageNumber);
    document.getElementById('reading-prev-page').style.display = pageIndex > 0 ? 'inline-block' : 'none';
    document.getElementById('reading-next-page').style.display = pageIndex < pages.length - 1 ? 'inline-block' : 'none';

    // Store current indices for navigation
    overlay.dataset.currentPostIndex = currentIndex;
    overlay.dataset.currentPageIndex = pageIndex;
}

function closeReadingMode() {
    document.getElementById('reading-overlay').style.display = 'none';
}

// Reading mode navigation handlers
document.getElementById('reading-close-btn').addEventListener('click', closeReadingMode);
document.getElementById('reading-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeReadingMode();
});

document.getElementById('reading-prev-post').addEventListener('click', () => {
    const overlay = document.getElementById('reading-overlay');
    const idx = parseInt(overlay.dataset.currentPostIndex);
    if (idx > 0) {
        const posts = state.pageData.posts;
        const post = posts[idx - 1];
        openReadingMode(post, state.activeStorySlug, state.activePageNumber);
    }
});

document.getElementById('reading-next-post').addEventListener('click', () => {
    const overlay = document.getElementById('reading-overlay');
    const idx = parseInt(overlay.dataset.currentPostIndex);
    const posts = state.pageData.posts;
    if (idx < posts.length - 1) {
        const post = posts[idx + 1];
        openReadingMode(post, state.activeStorySlug, state.activePageNumber);
    }
});

document.getElementById('reading-prev-page').addEventListener('click', async () => {
    const overlay = document.getElementById('reading-overlay');
    const idx = parseInt(overlay.dataset.currentPageIndex);
    if (idx > 0) {
        const pages = state.storyData.pages;
        const prevPage = pages[idx - 1];
        await loadPage(state.activeStorySlug, prevPage.page_number);
        // Re-open reading mode with first post of new page
        if (state.pageData.posts.length) {
            openReadingMode(state.pageData.posts[0], state.activeStorySlug, prevPage.page_number);
        } else {
            closeReadingMode();
        }
    }
});

document.getElementById('reading-next-page').addEventListener('click', async () => {
    const overlay = document.getElementById('reading-overlay');
    const idx = parseInt(overlay.dataset.currentPageIndex);
    const pages = state.storyData.pages;
    if (idx < pages.length - 1) {
        const nextPage = pages[idx + 1];
        await loadPage(state.activeStorySlug, nextPage.page_number);
        if (state.pageData.posts.length) {
            openReadingMode(state.pageData.posts[0], state.activeStorySlug, nextPage.page_number);
        } else {
            closeReadingMode();
        }
    }
});

// ----- Initial load -----
async function init() {
    try {
        const stories = await fetchWithCache('/api/stories/');
        state.stories = stories;
        if (stories.length) {
            // Load first story
            await loadStory(stories[0].slug);
        } else {
            appContainer.innerHTML = '<div class="card stories-empty-state"><h2>No stories found</h2><p>Expected content.yml and stories folder.</p></div>';
        }
    } catch (err) {
        console.error('Failed to load stories:', err);
        appContainer.innerHTML = `<div class="error">Failed to load stories: ${err.message}</div>`;
    }
}

// Start
document.addEventListener('DOMContentLoaded', init);