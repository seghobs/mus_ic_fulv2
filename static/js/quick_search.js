let qsSelectedIndex = -1;
let qsResultsData = [];

function openQuickSearch() {
    const modal = document.getElementById('quickSearchModal');
    const input = document.getElementById('qsInput');
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.add('visible');
        input.focus();
    }, 10);
    document.body.style.overflow = 'hidden';
}

function closeQuickSearch() {
    const modal = document.getElementById('quickSearchModal');
    modal.classList.remove('visible');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
    document.body.style.overflow = '';
}

let qsCurrentPage = 1;
let qsIsLoading = false;
let qsHasMore = true;

function clearQuickSearch() {
    document.getElementById('qsInput').value = '';
    document.getElementById('qsResults').innerHTML = `<div class="qs-empty"><span class="qs-empty-icon"><i class="fa-solid fa-music"></i></span><h3>Sıradaki ilhamını bul</h3><p>Şarkı veya sanatçı yaz, Enter'a bas.</p><span class="qs-empty-hint">Önce dinle, sonra stüdyona ekle.</span></div>`;
    qsResultsData = [];
    qsSelectedIndex = -1;
    qsCurrentPage = 1;
    qsHasMore = true;
    qsIsLoading = false;
    
    // Clear localStorage
    localStorage.removeItem('qs_query');
    localStorage.removeItem('qs_page');
    localStorage.removeItem('qs_has_more');
    localStorage.removeItem('qs_results');
}

async function qsSearch() {
    const q = document.getElementById('qsInput').value.trim();
    if (q.length < 2) return;

    qsCurrentPage = 1;
    qsHasMore = true;
    const resultsDiv = document.getElementById('qsResults');
    resultsDiv.innerHTML = `
        <div class="py-12 text-center">
            <i class="fa-solid fa-spinner fa-spin text-zinc-700 text-xl"></i>
        </div>
    `;

    try {
        qsIsLoading = true;
        const r = await fetch(`/api/yt-search?q=${encodeURIComponent(q)}&page=${qsCurrentPage}`);
        const data = await r.json();
        const results = data.results || [];
        qsHasMore = data.has_more !== false;
        qsResultsData = results;
        renderQsResults(results);
        saveQsState(); // Save state after initial search
    } catch (e) {
        resultsDiv.innerHTML = `<div class="p-4 text-center text-red-500 text-xs">Arama hatası oluştu.</div>`;
    } finally {
        qsIsLoading = false;
    }
}

function saveQsState() {
    const q = document.getElementById('qsInput')?.value || '';
    localStorage.setItem('qs_query', q);
    localStorage.setItem('qs_page', qsCurrentPage);
    localStorage.setItem('qs_has_more', qsHasMore ? '1' : '0');
    try {
        localStorage.setItem('qs_results', JSON.stringify(qsResultsData));
    } catch(e) {
        // Ignored if too large
    }
}

function loadQsState() {
    try {
        const savedQuery = localStorage.getItem('qs_query');
        if (savedQuery && savedQuery.trim() !== '') {
            const qsInput = document.getElementById('qsInput');
            if (qsInput) qsInput.value = savedQuery;
            
            const savedResultsStr = localStorage.getItem('qs_results');
            if (savedResultsStr) {
                const results = JSON.parse(savedResultsStr);
                if (Array.isArray(results) && results.length > 0) {
                    qsResultsData = results;
                    qsCurrentPage = parseInt(localStorage.getItem('qs_page')) || 1;
                    qsHasMore = localStorage.getItem('qs_has_more') !== '0';
                    renderQsResults(results, false, 0);
                }
            }
        }
    } catch(e) {}
}

async function qsLoadMore() {
    const q = document.getElementById('qsInput').value.trim();
    if (q.length < 2 || qsIsLoading || !qsHasMore) return;

    qsIsLoading = true;
    qsCurrentPage++;
    
    const resultsDiv = document.getElementById('qsResults');
    const loadingEl = document.createElement('div');
    loadingEl.id = 'qsLoadingIndicator';
    loadingEl.className = 'py-4 text-center';
    loadingEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-zinc-700 text-sm"></i>';
    resultsDiv.appendChild(loadingEl);

    try {
        const r = await fetch(`/api/yt-search?q=${encodeURIComponent(q)}&page=${qsCurrentPage}`);
        const data = await r.json();
        const results = data.results || [];
        qsHasMore = data.has_more !== false;
        
        if (results.length > 0) {
            const startIdx = qsResultsData.length;
            qsResultsData = qsResultsData.concat(results);
            renderQsResults(results, true, startIdx);
            saveQsState(); // Save state after loading more
        }
    } catch (e) {
        console.error('Yükleme hatası:', e);
    } finally {
        const loadingEl = document.getElementById('qsLoadingIndicator');
        if (loadingEl) loadingEl.remove();
        qsIsLoading = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadQsState(); // Load state on init
    
    const resultsDiv = document.getElementById('qsResults');
    if (resultsDiv) {
        resultsDiv.addEventListener('scroll', () => {
            if (resultsDiv.scrollHeight - resultsDiv.scrollTop <= resultsDiv.clientHeight + 50) {
                if (!qsIsLoading && qsHasMore) qsLoadMore();
            }
        });
    }
});

function renderQsResults(data, append = false, startIdx = 0) {
    const resultsDiv = document.getElementById('qsResults');
    if (!data.length && !append) {
        resultsDiv.innerHTML = `<div class="qs-empty"><span class="qs-empty-icon"><i class="fa-solid fa-magnifying-glass"></i></span><h3>Henüz bir eşleşme yok</h3><p>Farklı bir şarkı veya sanatçı adı dene.</p></div>`;
        return;
    }

    let html = '';
    data.forEach((v, i) => {
        const idx = startIdx + i;
        const safeTitle = v.title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        html += `
            <div class="qs-item group/item" id="qs-item-${idx}" onclick="qsSelectVideo('${v.id}', '${safeTitle}', this)">
                <div class="relative flex-shrink-0 cursor-pointer" onclick="event.stopPropagation(); playYtVideo('${v.id}', '${safeTitle}')">
                    <img src="${v.thumbnail}" class="qs-thumb">
                    <div class="qs-play">
                        <i class="fa-solid fa-play text-white text-xs"></i>
                    </div>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-bold text-white truncate group-hover/item:text-zinc-300 transition-colors">${v.title}</div>
                    <div class="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">${v.duration || 'Video'} • YouTube</div>
                </div>
                <div class="qs-add text-zinc-700 group-hover/item:text-white transition-colors pr-2" title="Stüdyoya ekle">
                    <i class="fa-solid fa-plus text-xs"></i>
                </div>
            </div>
        `;
    });
    
    if (append) {
        resultsDiv.insertAdjacentHTML('beforeend', html);
    } else {
        resultsDiv.innerHTML = html;
        qsSelectedIndex = -1;
    }
}

function qsSelectVideo(id, title, element) {
    // Fill the main YouTube URL input and trigger download
    const ytUrl = document.getElementById('ytUrl');
    if (ytUrl) {
        ytUrl.value = 'https://www.youtube.com/watch?v=' + id;
        downloadYoutube();
        
        // Add visual feedback to the clicked item
        if (element) {
            const icon = element.querySelector('.fa-plus');
            if (icon) {
                icon.className = 'fa-solid fa-check text-emerald-400';
            }
            element.classList.add('bg-zinc-800/50');
        }
        
        // Show a quick toast so the user knows it's added to the background queue
        if (typeof _showQueueToast === 'function') {
            _showQueueToast('✅ İndirme Kuyruğuna Eklendi');
        }
        
        // NOTE: User requested NOT to close the modal automatically so they can keep experimenting
        // closeQuickSearch(); 
    }
}

// Global Key Listeners
document.addEventListener('keydown', (e) => {
    // Ctrl + F for Quick Search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openQuickSearch();
    }

    // Escape to close
    if (e.key === 'Escape') {
        closeQuickSearch();
    }

    // Modal is open navigation
    const modal = document.getElementById('quickSearchModal');
    if (!modal.classList.contains('hidden')) {
        const input = document.getElementById('qsInput');
        
        if (e.key === 'Enter' && document.activeElement === input) {
            e.preventDefault();
            qsSearch();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            moveQsSelection(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            moveQsSelection(-1);
        } else if (e.key === 'Enter' && qsSelectedIndex !== -1) {
            e.preventDefault();
            const v = qsResultsData[qsSelectedIndex];
            if (v) qsSelectVideo(v.id, v.title);
        }
    }
});

function moveQsSelection(dir) {
    const items = document.querySelectorAll('.qs-item');
    if (!items.length) return;

    if (qsSelectedIndex !== -1) {
        items[qsSelectedIndex].classList.remove('selected');
    }

    qsSelectedIndex += dir;
    if (qsSelectedIndex >= items.length) qsSelectedIndex = 0;
    if (qsSelectedIndex < 0) qsSelectedIndex = items.length - 1;

    const selected = items[qsSelectedIndex];
    selected.classList.add('selected');
    selected.scrollIntoView({ block: 'nearest' });
}
