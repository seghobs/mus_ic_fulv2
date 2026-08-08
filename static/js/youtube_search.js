function renderYtResult(v) {
    const safeTitle = (v.title||'').replace(/'/g,"\\'").replace(/"/g,"&quot;");
    return `
        <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-dark-700/50 cursor-pointer transition group" onclick="selectYtResult('${v.url.replace(/'/g,"\\'")}','${safeTitle}')">
            <div class="relative w-20 h-12 flex-shrink-0">
                <img src="${v.thumbnail}" class="w-20 h-12 rounded-lg object-cover">
                <div onclick="event.stopPropagation(); playYtVideo('${v.id}','${safeTitle}')" class="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <i class="fa-solid fa-play text-white text-sm"></i>
                </div>
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-xs font-medium truncate">${v.title||'Başlıksız'}</div>
                <div class="text-[10px] text-dark-500 flex items-center gap-2 mt-0.5">
                    <span>${v.channel||''}</span>
                    ${v.duration ? `<span>• ${v.duration}</span>` : ''}
                </div>
            </div>
            <div class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
                <i class="fa-solid fa-arrow-right text-xs text-indigo-400"></i>
            </div>
        </div>
    `;
}
async function searchYoutube() {
    const input = document.getElementById('ytSearch');
    const query = input.value.trim();
    if(!query) return;

    if(typeof stopYtPlayer === 'function') stopYtPlayer();
    
    ytCurrentQuery = query;
    ytCurrentPage = 1;

    const container = document.getElementById('ytResults');
    container.classList.remove('hidden');
    container.innerHTML = '<div class="flex items-center justify-center py-3"><i class="fa-solid fa-spinner fa-spin text-dark-500 mr-2"></i><span class="text-dark-500 text-xs">Aranıyor...</span></div>';

    try {
        const resp = await fetch('/api/yt-search?q=' + encodeURIComponent(query) + '&page=1');
        const data = await resp.json();
        if(!data.results || !data.results.length) {
            container.innerHTML = '<div class="text-center py-3 text-dark-500 text-xs">Sonuç bulunamadı</div>';
            return;
        }
        let html = '<div id="ytResultsList">';
        data.results.forEach(v => { html += renderYtResult(v); });
        html += '</div>';
        if(data.has_more) {
            html += `<div id="ytLoadMore" class="text-center py-2"><button onclick="loadMoreYoutube()" class="text-xs text-indigo-400 hover:text-indigo-300 transition px-4 py-1.5 rounded-lg bg-dark-700/50 hover:bg-dark-700"><i class="fa-solid fa-chevron-down mr-1"></i>Daha Fazla</button></div>`;
        }
        container.innerHTML = html;
    } catch(e) {
        container.innerHTML = `<div class="text-center py-3 text-red-400 text-xs">${e.message}</div>`;
    }
}
async function loadMoreYoutube() {
    if(!ytCurrentQuery) return;
    ytCurrentPage++;
    const btn = document.querySelector('#ytLoadMore button');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Yükleniyor...';
    btn.disabled = true;

    try {
        const resp = await fetch('/api/yt-search?q=' + encodeURIComponent(ytCurrentQuery) + '&page=' + ytCurrentPage);
        const data = await resp.json();
        if(data.results && data.results.length) {
            const list = document.getElementById('ytResultsList');
            data.results.forEach(v => { list.insertAdjacentHTML('beforeend', renderYtResult(v)); });
        }
        const loadMore = document.getElementById('ytLoadMore');
        if(data.has_more) {
            loadMore.innerHTML = `<button onclick="loadMoreYoutube()" class="text-xs text-indigo-400 hover:text-indigo-300 transition px-4 py-1.5 rounded-lg bg-dark-700/50 hover:bg-dark-700"><i class="fa-solid fa-chevron-down mr-1"></i>Daha Fazla</button>`;
        } else {
            loadMore.innerHTML = '<span class="text-[10px] text-dark-600">Tüm sonuçlar gösterildi</span>';
        }
    } catch(e) {
        const loadMore = document.getElementById('ytLoadMore');
        loadMore.innerHTML = `<span class="text-xs text-red-400">${e.message}</span>`;
    }
}
function selectYtResult(url, title) {
    document.getElementById('ytUrl').value = url;
    document.getElementById('ytResults').classList.add('hidden');
    document.getElementById('ytSearch').value = '';
    downloadYoutube();
}
async function downloadYoutube() {
    const urlInput = document.getElementById('ytUrl');
    const url = urlInput.value.trim();
    if(!url) return;

    const btn = document.getElementById('ytBtn');
    const statusDiv = document.getElementById('ytStatus');
    const statusText = document.getElementById('ytStatusText');
    
    // Progress bar elements
    const mainStatus = document.getElementById('uploadStatus');
    const progress = document.getElementById('uploadProgress');
    const mainText = document.getElementById('uploadText');
    const percent = null; // Removed percentage text display
    const label = document.getElementById('fileLabel');

    btn.disabled = true;
    btn.classList.add('opacity-50');
    statusDiv.classList.remove('hidden');
    statusText.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Kuyruğa eklendi...';

    // Activate main progress bar for YouTube
    if(mainStatus) mainStatus.classList.remove('hidden');
    if(progress) {
        progress.style.transition = 'none';
        progress.style.width = '5%';
    }
    if(percent) {} // Removed percentage update
    if(mainText) mainText.innerHTML = '<i class="fa-brands fa-youtube text-red-500 mr-2"></i><span class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">YouTube Hazırlanıyor...</span>';
    if(label) label.innerHTML = `
        <div class="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <i class="fa-brands fa-youtube text-3xl text-red-500"></i>
        </div>
        <div class="text-white font-bold tracking-tight mb-2">YouTube Aktarımı</div>
        <div class="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Video işleniyor...</div>
    `;
    try {
        const bypassCover = document.getElementById('bypassCoverFilter');
        const bypassVal = bypassCover && bypassCover.checked;
        if (bypassVal) {
            const bypassLyrics = document.getElementById('bypassFilter');
            if (bypassLyrics) bypassLyrics.checked = true;
        }

        const resp = await fetch('/api/youtube', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({url: url, bypass_filter: bypassVal})
        });
        const data = await resp.json();
        if(data.error) {
            statusText.innerHTML = `<i class="fa-solid fa-xmark mr-1 text-red-400"></i>${data.error}`;
            if(mainText) mainText.innerHTML = `<i class="fa-solid fa-xmark text-red-500 mr-2"></i>Hata: ${data.error}`;
            btn.disabled = false;
            btn.classList.remove('opacity-50');
            return;
        }
        
        if(progress) progress.style.width = '15%';
        if(percent) {} // Removed percentage update
        statusText.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>İndiriliyor ve yükleniyor...';
        if(mainText) mainText.innerHTML = '<i class="fa-solid fa-cloud-arrow-down fa-bounce text-zinc-400 mr-2"></i><span class="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Video indiriliyor ve sunucuya aktarılıyor...</span>';
    } catch(e) {
        statusText.innerHTML = `<i class="fa-solid fa-xmark mr-1 text-red-400"></i>${e.message}`;
        if(mainText) mainText.innerHTML = `<i class="fa-solid fa-xmark text-red-500 mr-2"></i>Ağ Hatası`;
        btn.disabled = false;
        btn.classList.remove('opacity-50');
    }
}