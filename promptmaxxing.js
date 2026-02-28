/* =====================================================
   PromptZoo — Application Logic
   Features: Infinite scroll, skeleton loading,
   comparison mode, random prompt, intersection
   observer animations, score bar animations,
   error retry, category filters
   ===================================================== */

// =====================================================
// STATE
// =====================================================
let DATA = [];
let filteredItems = [];
let currentSort = 'score-desc';
let currentMinScore = 0;
let searchQuery = '';
let categoryFilters = {
    'Legibility': 0,
    'Hierarchy': 0,
    'Consistency': 0,
    'Atmosphere': 0,
    'Theme Fit': 0
};

// Infinite scroll
const ITEMS_PER_PAGE = 30;
let currentPage = 0;
let isLoadingMore = false;

// Comparison
let compareSet = new Set();
const MAX_COMPARE = 3;

// =====================================================
// DOM REFS
// =====================================================
const grid = document.getElementById('grid');
const emptyState = document.getElementById('emptyState');
const emptyText = document.getElementById('emptyText');
const countBadge = document.getElementById('countBadge');
const searchInput = document.getElementById('searchInput');
const scoreFilter = document.getElementById('scoreFilter');
const favFilterBtn = document.getElementById('favFilterBtn');
const scrollSentinel = document.getElementById('scrollSentinel');
const loadingIndicator = document.getElementById('loadingIndicator');
const loadMoreInfo = document.getElementById('loadMoreInfo');
const backToTopBtn = document.getElementById('backToTop');
const compareBar = document.getElementById('compareBar');
const compareCountEl = document.getElementById('compareCount');
const toast = document.getElementById('toast');

// Modal refs
const modalOverlay = document.getElementById('modalOverlay');
const modalImg = document.getElementById('modalImg');
const modalTitle = document.getElementById('modalTitle');
const modalMeta = document.getElementById('modalMeta');
const modalScores = document.getElementById('modalScores');
const modalPrompt = document.getElementById('modalPrompt');
const modalCopyBtn = document.getElementById('modalCopyBtn');
const modalCloseBtn = document.getElementById('modalClose');

// Comparison modal refs
const compareOverlay = document.getElementById('compareOverlay');
const compareGridEl = document.getElementById('compareGrid');

// =====================================================
// SVG ICONS (reusable strings)
// =====================================================
const ICONS = {
    heartFull: '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    heartEmpty: '<svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    copy: '<svg class="icon icon-sm" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="0" ry="0"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
    eye: '<svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    checkSm: '<svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;"><polyline points="20 6 9 17 4 12"/></svg>',
    close: '<svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
};

// =====================================================
// FAVORITES (localStorage)
// =====================================================
function getFavs() {
    try { return JSON.parse(localStorage.getItem('promptzoo_favs') || '[]'); }
    catch { return []; }
}

function saveFavs(f) {
    localStorage.setItem('promptzoo_favs', JSON.stringify(f));
}

function toggleFav(id, btn, e) {
    if (e) e.stopPropagation();
    let favs = getFavs();
    if (favs.includes(id)) {
        favs = favs.filter(f => f !== id);
        if (btn) { btn.innerHTML = ICONS.heartEmpty; btn.classList.remove('active'); }
    } else {
        favs.push(id);
        if (btn) { btn.innerHTML = ICONS.heartFull; btn.classList.add('active'); }
    }
    saveFavs(favs);
    if (currentSort === 'favs') render();
}

// =====================================================
// INTERSECTION OBSERVERS
// =====================================================

// Card visibility observer — staggered animation on scroll
const cardObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            // Small stagger based on DOM position in current batch
            const delay = parseInt(entry.target.dataset.stagger || '0');
            setTimeout(() => {
                entry.target.classList.add('card--visible');
            }, delay);
            cardObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.05, rootMargin: '50px' });

// Scroll sentinel observer — infinite scroll
const scrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !isLoadingMore) {
        loadMore();
    }
}, { threshold: 0.1 });

// =====================================================
// BACK TO TOP
// =====================================================
window.addEventListener('scroll', () => {
    if (window.scrollY > 500) {
        backToTopBtn.classList.add('visible');
    } else {
        backToTopBtn.classList.remove('visible');
    }
}, { passive: true });

backToTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// =====================================================
// SCORE HELPERS
// =====================================================
function scoreClass(total) {
    if (total >= 43) return 'score-high';
    if (total >= 37) return 'score-mid';
    return 'score-low';
}

function barColor(v) {
    if (v >= 9) return 'var(--blue)';
    if (v >= 7) return 'var(--yellow)';
    return 'var(--red)';
}

// =====================================================
// FILTERING & SORTING
// =====================================================
function getFilteredItems() {
    const favs = getFavs();
    let items = DATA.filter(item => {
        if (currentSort === 'favs' && !favs.includes(item.id)) return false;
        if (currentMinScore > 0 && item.total < currentMinScore) return false;
        for (const [cat, min] of Object.entries(categoryFilters)) {
            if (min > 0 && (item.scores[cat] || 0) < min) return false;
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return item.name.toLowerCase().includes(q) ||
                   item.id.toLowerCase().includes(q) ||
                   (item.yaml && item.yaml.toLowerCase().includes(q));
        }
        return true;
    });

    if (currentSort === 'score-desc') items.sort((a, b) => b.total - a.total);
    else if (currentSort === 'score-asc') items.sort((a, b) => a.total - b.total);
    else if (currentSort === 'number-asc') items.sort((a, b) => a.number - b.number);
    else if (currentSort === 'favs') items.sort((a, b) => b.total - a.total);

    return items;
}

// =====================================================
// CARD CREATION
// =====================================================
function createCard(item, batchIndex) {
    const favs = getFavs();
    const isFav = favs.includes(item.id);
    const isCompared = compareSet.has(item.id);

    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.stagger = Math.min(batchIndex * 30, 450);
    card.onclick = () => openModal(item.id);

    card.innerHTML = `
        <div class="card-img-wrapper">
            <div class="skeleton-geo">
                <span class="sk-circle"></span>
                <span class="sk-square"></span>
                <span class="sk-tri"></span>
            </div>
            <img src="${item.img}" alt="${item.name}" loading="lazy">
            <span class="card-number">#${item.number}</span>
            <span class="card-score ${scoreClass(item.total)}">${item.total}</span>
            <button class="fav-btn ${isFav ? 'active' : ''}" aria-label="Toggle favorite">
                ${isFav ? ICONS.heartFull : ICONS.heartEmpty}
            </button>
            <button class="compare-check ${isCompared ? 'checked' : ''}" aria-label="Compare">
                ${isCompared ? ICONS.checkSm : ''}
            </button>
        </div>
        <div class="card-body">
            <div class="card-title">${item.name}</div>
            <div class="card-scores-row">
                ${Object.entries(item.scores).map(([k, v]) =>
                    `<span class="score-pip">${k.slice(0, 3)}: <span class="val">${v}</span></span>`
                ).join('')}
            </div>
            <div class="card-actions">
                <button class="btn copy-btn" aria-label="Copy prompt">
                    ${ICONS.copy} Copy
                </button>
                <button class="btn details-btn" aria-label="View details">
                    ${ICONS.eye} Details
                </button>
            </div>
        </div>
    `;

    // Image load handler — skeleton removal
    const img = card.querySelector('.card-img-wrapper img');
    const wrapper = card.querySelector('.card-img-wrapper');
    img.addEventListener('load', () => {
        wrapper.classList.add('img-loaded');
    });
    // Handle cached images
    if (img.complete && img.naturalHeight > 0) {
        wrapper.classList.add('img-loaded');
    }

    // Favorite button
    const favBtn = card.querySelector('.fav-btn');
    favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFav(item.id, favBtn, e);
    });

    // Compare checkbox
    const compareCheck = card.querySelector('.compare-check');
    compareCheck.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCompare(item.id, compareCheck);
    });

    // Copy button
    const copyBtn = card.querySelector('.copy-btn');
    copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyPrompt(item.id, copyBtn);
    });

    // Details button
    const detailsBtn = card.querySelector('.details-btn');
    detailsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openModal(item.id);
    });

    return card;
}

// =====================================================
// RENDER & INFINITE SCROLL
// =====================================================
function render() {
    filteredItems = getFilteredItems();
    currentPage = 0;
    grid.innerHTML = '';

    countBadge.textContent = filteredItems.length;

    if (filteredItems.length === 0) {
        emptyState.style.display = 'block';
        emptyText.textContent = currentSort === 'favs' ? 'No favorites yet.' : 'No prompts found.';
        loadingIndicator.classList.remove('visible');
        scrollSentinel.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    loadMore();

    // Start observing sentinel for infinite scroll
    scrollObserver.observe(scrollSentinel);

    // Update fav filter button state
    const fb = document.getElementById('favFilterBtn');
    if (currentSort === 'favs') fb.classList.add('fav-active');
    else fb.classList.remove('fav-active');
}

function loadMore() {
    if (isLoadingMore) return;

    const start = currentPage * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const batch = filteredItems.slice(start, end);

    if (batch.length === 0) {
        loadingIndicator.classList.remove('visible');
        scrollSentinel.style.display = 'none';
        return;
    }

    isLoadingMore = true;

    batch.forEach((item, i) => {
        const card = createCard(item, i);
        grid.appendChild(card);
        cardObserver.observe(card);
    });

    currentPage++;

    // Check if there are more items
    const totalLoaded = currentPage * ITEMS_PER_PAGE;
    if (totalLoaded >= filteredItems.length) {
        loadingIndicator.classList.remove('visible');
        scrollSentinel.style.display = 'none';
    } else {
        loadingIndicator.classList.add('visible');
        scrollSentinel.style.display = 'block';
        loadMoreInfo.textContent = `${Math.min(totalLoaded, filteredItems.length)} of ${filteredItems.length} loaded`;
    }

    isLoadingMore = false;
}

// =====================================================
// COPY PROMPT
// =====================================================
function copyPrompt(id, btn) {
    const item = DATA.find(d => d.id === id);
    if (!item) return;
    navigator.clipboard.writeText(item.yaml || '').then(() => {
        showToast('Prompt copied!');
        if (btn) {
            btn.classList.add('copied');
            const orig = btn.innerHTML;
            btn.innerHTML = `${ICONS.check} Copied`;
            setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = orig; }, 1800);
        }
    });
}

// =====================================================
// MODAL
// =====================================================
function openModal(id) {
    const item = DATA.find(d => d.id === id);
    if (!item) return;

    modalImg.src = item.img;
    modalTitle.textContent = item.name;
    modalMeta.innerHTML = `<span>#${item.number}</span><span>${item.total}/50</span><span>${item.id}</span>`;

    // Score bars — start at 0, animate after render
    modalScores.innerHTML = Object.entries(item.scores).map(([k, v]) => `
        <div class="score-item">
            <div class="score-label">${k}</div>
            <div class="score-bar-track">
                <div class="score-bar-fill" data-target="${v * 10}" style="width:0%;background:${barColor(v)}"></div>
            </div>
            <div class="score-value" style="color:${barColor(v)}">${v}/10</div>
        </div>
    `).join('');

    modalPrompt.textContent = item.yaml || 'No prompt available';

    modalCopyBtn.onclick = () => {
        navigator.clipboard.writeText(item.yaml || '').then(() => {
            showToast('Prompt copied!');
            modalCopyBtn.classList.add('copied');
            setTimeout(() => modalCopyBtn.classList.remove('copied'), 1800);
        });
    };

    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Animate score bars after a brief delay
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            modalScores.querySelectorAll('.score-bar-fill').forEach(bar => {
                bar.style.width = bar.dataset.target + '%';
            });
        });
    });
}

function closeModal() {
    modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

modalCloseBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay) closeModal();
});

// =====================================================
// COMPARISON MODE
// =====================================================
function toggleCompare(id, btn) {
    if (compareSet.has(id)) {
        compareSet.delete(id);
        btn.classList.remove('checked');
        btn.innerHTML = '';
    } else {
        if (compareSet.size >= MAX_COMPARE) {
            showToast(`Max ${MAX_COMPARE} items for comparison`);
            return;
        }
        compareSet.add(id);
        btn.classList.add('checked');
        btn.innerHTML = ICONS.checkSm;
    }
    updateCompareBar();
}

function updateCompareBar() {
    if (compareSet.size >= 2) {
        compareBar.classList.add('visible');
        compareCountEl.textContent = compareSet.size;
    } else {
        compareBar.classList.remove('visible');
    }
}

function clearCompare() {
    compareSet.clear();
    document.querySelectorAll('.compare-check.checked').forEach(el => {
        el.classList.remove('checked');
        el.innerHTML = '';
    });
    updateCompareBar();
}

function openCompare() {
    if (compareSet.size < 2) return;

    const items = Array.from(compareSet).map(id => DATA.find(d => d.id === id)).filter(Boolean);
    const cols = items.length;

    compareGridEl.className = `compare-grid cols-${cols}`;
    compareGridEl.innerHTML = items.map(item => `
        <div class="compare-card">
            <div class="compare-card-img">
                <img src="${item.img}" alt="${item.name}" loading="lazy">
            </div>
            <div class="compare-card-body">
                <div class="compare-card-name">${item.name}</div>
                <div class="compare-card-meta">#${item.number} · ${item.id}</div>
                ${Object.entries(item.scores).map(([k, v]) => `
                    <div class="compare-score-row">
                        <span class="compare-score-label">${k.slice(0, 5)}</span>
                        <div class="compare-score-bar">
                            <div class="compare-score-fill" data-target="${v * 10}" style="width:0%;background:${barColor(v)}"></div>
                        </div>
                        <span class="compare-score-val" style="color:${barColor(v)}">${v}</span>
                    </div>
                `).join('')}
                <div class="compare-total">
                    <span class="compare-total-label">Total</span>
                    <span class="compare-total-val">${item.total}<span style="font-size:0.6em;color:var(--grey);font-weight:400">/50</span></span>
                </div>
            </div>
        </div>
    `).join('');

    compareOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Animate score bars
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            compareGridEl.querySelectorAll('.compare-score-fill').forEach(bar => {
                bar.style.width = bar.dataset.target + '%';
            });
        });
    });
}

function closeCompare() {
    compareOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

// Compare bar event listeners
document.getElementById('compareClearBtn').addEventListener('click', clearCompare);
document.getElementById('compareOpenBtn').addEventListener('click', openCompare);
document.getElementById('compareModalClose').addEventListener('click', closeCompare);
compareOverlay.addEventListener('click', e => {
    if (e.target === compareOverlay) closeCompare();
});

// =====================================================
// RANDOM PROMPT
// =====================================================
document.getElementById('randomBtn').addEventListener('click', () => {
    if (filteredItems.length === 0) {
        showToast('No prompts to pick from');
        return;
    }
    const randomIdx = Math.floor(Math.random() * filteredItems.length);
    const randomItem = filteredItems[randomIdx];
    openModal(randomItem.id);
});

// =====================================================
// TOAST
// =====================================================
function showToast(message) {
    const toastText = document.getElementById('toastText');
    toastText.textContent = message || 'Copied';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1800);
}

// =====================================================
// DATA LOADING WITH RETRY
// =====================================================
function loadData() {
    const errorEl = document.getElementById('errorState');
    const retryBtn = document.getElementById('retryBtn');

    // Hide error, show loading
    if (errorEl) errorEl.style.display = 'none';
    grid.innerHTML = '';
    emptyState.style.display = 'none';

    fetch('extracted_prompts.json')
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
            return r.json();
        })
        .then(d => {
            DATA = d;
            if (errorEl) errorEl.style.display = 'none';
            render();
        })
        .catch(err => {
            console.error('Failed to load data:', err);
            if (errorEl) {
                errorEl.style.display = 'block';
                const errDesc = errorEl.querySelector('.error-desc');
                if (errDesc) errDesc.textContent = err.message || 'Could not load prompt data. Check your connection and try again.';
            }
            if (retryBtn) retryBtn.classList.remove('loading');
        });
}

// Retry button handler
document.getElementById('retryBtn').addEventListener('click', function() {
    this.classList.add('loading');
    this.textContent = 'Loading...';
    setTimeout(() => {
        this.textContent = '↻ Try Again';
        this.classList.remove('loading');
        loadData();
    }, 300);
});

// =====================================================
// EVENT LISTENERS
// =====================================================

// Search
searchInput.addEventListener('input', e => {
    searchQuery = e.target.value;
    render();
});

// Sort filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSort = btn.dataset.sort;
        render();
    });
});

// Total score filter
scoreFilter.addEventListener('change', e => {
    currentMinScore = parseInt(e.target.value);
    render();
});

// Category filters (fixing the missing event listeners bug)
['filterLegibility', 'filterHierarchy', 'filterConsistency', 'filterAtmosphere', 'filterThemeFit'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('change', () => {
            const cat = el.dataset.cat;
            categoryFilters[cat] = parseInt(el.value);
            render();
        });
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (compareOverlay.classList.contains('active')) {
            closeCompare();
        } else {
            closeModal();
        }
    }
});

// =====================================================
// INIT
// =====================================================
loadData();
