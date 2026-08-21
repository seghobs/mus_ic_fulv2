function showResults(songs) {
    // Sonuçlar paneli kaldırıldı, tüm şarkılar kütüphanede listeleniyor
}
let libraryPage = 1;
let libraryLoading = false;
let libraryHasMore = true;
const libraryLimit = 5;

async function loadAllSongs(isNextPage = false) {
    if (libraryLoading) return;
    if (isNextPage && !libraryHasMore) return;

    libraryLoading = true;
    
    if (!isNextPage) {
        libraryPage = 1;
        libraryHasMore = true;
    }

    const container = document.getElementById('allSongsContainer');
    
    let loadingSpinner = document.getElementById('libraryLoadingSpinner');
    if (!isNextPage) {
        container.innerHTML = '<div class="flex items-center justify-center py-12"><i class="fa-solid fa-spinner fa-spin text-zinc-500 mr-3"></i><span class="text-zinc-500 text-xs font-bold uppercase tracking-widest">Yükleniyor...</span></div>';
    } else {
        if (!loadingSpinner) {
            loadingSpinner = document.createElement('div');
            loadingSpinner.id = 'libraryLoadingSpinner';
            loadingSpinner.className = 'flex items-center justify-center py-4';
            loadingSpinner.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-zinc-500 mr-3"></i><span class="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Daha Fazla Yükleniyor...</span>';
            container.appendChild(loadingSpinner);
        }
    }

    try {
        const resp = await fetch(`/api/songs?page=${libraryPage}&limit=${libraryLimit}`);
        const data = await resp.json();
        const songs = data.data.list || [];
        
        if (loadingSpinner) {
            loadingSpinner.remove();
        }

        if (!isNextPage) {
            container.innerHTML = '';
        }

        if (!songs.length) {
            if (!isNextPage) {
                container.innerHTML = '<div class="text-center py-12 border-2 border-dashed border-zinc-900 rounded-lg"><i class="fa-regular fa-folder-open text-2xl text-zinc-700 mb-3"></i><p class="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Kütüphane Boş</p></div>';
            }
            libraryHasMore = false;
            libraryLoading = false;
            return;
        }

        if (songs.length < libraryLimit) {
            libraryHasMore = false;
        }

        songs.forEach((song, idx) => {
            knownSongs[song.song_id] = song;
            const dur = song.duration > 0 ? `${Math.round(song.duration / 1000)}s` : 'İşleniyor...';
            const isReady = song.audio_url && song.duration > 0;
            const songUuid = song.song_id;
            const url = `/api/download/${songUuid}`;
            const badge = song.is_cover ? '<span class="bg-zinc-900 border border-zinc-800 text-zinc-400 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md">Cover</span>' : song.is_upload ? '<span class="bg-zinc-900 border border-zinc-800 text-zinc-400 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md">Yüklendi</span>' : '';

            let actions = '';
            if (isReady) {
                actions = `
                    <a href="${url}" download class="shadcn-button-secondary px-3 py-1.5 text-xs flex items-center gap-2">
                        <i class="fa-solid fa-download text-[10px]"></i> İndir
                    </a>
                `;
            } else {
                actions = `<span class="text-zinc-500 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2"><i class="fa-solid fa-spinner fa-spin"></i> Hazırlanıyor</span>`;
            }

            const animDelay = isNextPage ? 0 : idx * 0.05;

            let coverHtml = '';
            if (isReady) {
                const isPlayingThis = (fpAudio && !fpAudio.paused && fpCurrentId && fpCurrentId.includes(songUuid));
                const overlayContent = isPlayingThis 
                    ? `<div class="audio-wave text-emerald-400 scale-75"><span class="bar bar1"></span><span class="bar bar2"></span><span class="bar bar3"></span><span class="bar bar4"></span></div>` 
                    : `<i class="fa-solid fa-play text-white text-sm"></i>`;
                    
                coverHtml = `
                    <div onclick="togglePlay('${songUuid}', this.querySelector('.play-btn-overlay'))" class="relative w-12 h-12 rounded-lg overflow-hidden border border-white/[0.06] flex-shrink-0 bg-zinc-900 group cursor-pointer">
                        ${song.cover_url 
                            ? `<img src="${song.cover_url}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=&quot;w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-indigo-500/10 text-violet-400&quot;><i class=&quot;fa-solid fa-music text-xs&quot;></i></div>'">`
                            : `<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-indigo-500/10 text-violet-400"><i class="fa-solid fa-music text-xs"></i></div>`
                        }
                        <div class="play-btn-overlay absolute inset-0 bg-black/40 flex items-center justify-center ${isPlayingThis ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity duration-200">
                            ${overlayContent}
                        </div>
                    </div>
                `;
            } else {
                coverHtml = `
                    <div class="relative w-12 h-12 rounded-lg overflow-hidden border border-white/[0.06] flex-shrink-0 bg-zinc-900">
                        ${song.cover_url 
                            ? `<img src="${song.cover_url}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=&quot;w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-indigo-500/10 text-violet-400&quot;><i class=&quot;fa-solid fa-music text-xs&quot;></i></div>'">`
                            : `<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-indigo-500/10 text-violet-400"><i class="fa-solid fa-music text-xs"></i></div>`
                        }
                    </div>
                `;
            }

            container.innerHTML += `
                <div class="shadcn-card p-4 mb-2 fade-in" data-sid="${songUuid}" data-title="${(song.title || 'Adsız').replace(/"/g, '&quot;')}" data-dur="${song.duration || 0}" data-ready="${isReady}" style="animation-delay:${animDelay}s">
                    <div class="flex justify-between items-center gap-3">
                        <div class="flex items-center gap-3 flex-1 min-w-0">
                            ${coverHtml}
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-3 mb-1">
                                    <span class="font-bold truncate text-sm tracking-tight">${song.title || 'Adsız'}</span>
                                    ${badge}
                                </div>
                                <div class="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-3">
                                    <i class="fa-regular fa-clock"></i> ${dur}
                                </div>
                            </div>
                        </div>
                        <div class="flex gap-2 flex-shrink-0">${actions}</div>
                    </div>
                    ${song.lyrics ? `<div class="pl-[60px]"><details class="mt-2"><summary class="text-[10px] font-bold uppercase tracking-widest text-zinc-600 cursor-pointer hover:text-zinc-400 transition"><i class="fa-solid fa-chevron-right mr-1.5"></i>Sözler & Tarz</summary><div class="text-[10px] text-zinc-500 mt-2 bg-zinc-950 border border-zinc-900 rounded-md p-3 leading-relaxed">${song.style ? `<div class="mb-2 pb-2 border-b border-zinc-900/60"><span class="text-zinc-400 font-bold uppercase mr-1">Tarz:</span> ${song.style}</div>` : ''}<pre class="whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">${song.lyrics}</pre></div></details></div>` : ''}
                </div>
            `;
        });

        libraryPage++;
    } catch (e) {
        if (loadingSpinner) loadingSpinner.remove();
        if (!isNextPage) {
            container.innerHTML = `<div class="text-center py-12"><i class="fa-solid fa-triangle-exclamation text-2xl text-red-500 mb-3"></i><p class="text-red-500 text-xs font-bold uppercase tracking-widest">${e.message}</p></div>`;
        } else {
            console.error(e);
        }
    } finally {
        libraryLoading = false;
        if(typeof syncLibraryPlayButtons === 'function') syncLibraryPlayButtons();
    }
}
function togglePlay(uuid, btn) {
    const title = btn.closest('.shadcn-card')?.dataset?.title || 'Şarkı';
    const url = '/api/download/' + uuid;

    if(fpAudio && fpCurrentId === url) {
        if (fpAudio.paused) {
            fpAudio.play().catch(e => console.warn('Oynatma hatası:', e));
        } else {
            fpAudio.pause();
        }
        return;
    }

    if(typeof playLocalSong === 'function') playLocalSong(uuid, title);
}

function syncLibraryPlayButtons() {
    let activeUuid = null;
    if (fpCurrentId && fpCurrentId.includes('/api/download/')) {
        activeUuid = fpCurrentId.split('/api/download/')[1];
    }
    
    document.querySelectorAll('.shadcn-card[data-sid]').forEach(card => {
        const uuid = card.dataset.sid;
        const overlay = card.querySelector('.play-btn-overlay');
        if (!overlay) return;
        
        if (uuid === activeUuid) {
            if (fpAudio && !fpAudio.paused) {
                overlay.innerHTML = `<div class="audio-wave text-emerald-400 scale-75"><span class="bar bar1"></span><span class="bar bar2"></span><span class="bar bar3"></span><span class="bar bar4"></span></div>`;
                overlay.classList.remove('opacity-0');
                overlay.classList.add('opacity-100');
            } else {
                overlay.innerHTML = `<i class="fa-solid fa-play text-white/70 text-sm"></i>`;
                overlay.classList.remove('opacity-0');
                overlay.classList.add('opacity-100');
            }
        } else {
            overlay.innerHTML = `<i class="fa-solid fa-play text-white text-sm"></i>`;
            overlay.classList.remove('opacity-100');
            overlay.classList.add('opacity-0');
        }
    });
}

function resetLibraryPlayButtons() {
    document.querySelectorAll('.play-btn-overlay').forEach(overlay => {
        overlay.innerHTML = `<i class="fa-solid fa-play text-white text-sm"></i>`;
        overlay.classList.remove('opacity-100');
        overlay.classList.add('opacity-0');
    });
}
function syncSongs(newSongs) {
    const container = document.getElementById('allSongsContainer');
    newSongs.forEach(song => {
        const sid = song.song_id;
        const isReady = song.audio_url && song.duration > 0;
        const prev = knownSongs[sid];
        const wasReady = prev ? (prev.audio_url && prev.duration > 0) : null;
        knownSongs[sid] = song;
        if(prev === undefined) { loadAllSongs(); return; }
        if(isReady && !wasReady) {
            const card = container.querySelector(`[data-sid="${sid}"]`);
            if(card) {
                const url = `/api/download/${sid}`;
                const dur = song.duration > 0 ? `${Math.round(song.duration/1000)}s` : 'N/A';
                const badge = song.is_cover ? '<span class="bg-zinc-900 border border-zinc-800 text-zinc-400 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md">Cover</span>' : song.is_upload ? '<span class="bg-zinc-900 border border-zinc-800 text-zinc-400 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md">Yüklendi</span>' : '';
                const coverHtml = song.cover_url 
                    ? `<div class="w-12 h-12 rounded-lg overflow-hidden border border-white/[0.06] flex-shrink-0 bg-zinc-900">
                         <img src="${song.cover_url}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=&quot;w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-indigo-500/10 text-violet-400&quot;><i class=&quot;fa-solid fa-music text-xs&quot;></i></div>'">
                       </div>`
                    : `<div class="w-12 h-12 rounded-lg border border-white/[0.06] flex-shrink-0 bg-gradient-to-br from-violet-500/20 to-indigo-500/10 flex items-center justify-center text-violet-400">
                         <i class="fa-solid fa-music text-xs"></i>
                       </div>`;
                card.innerHTML = `
                    <div class="flex justify-between items-center gap-3">
                        <div class="flex items-center gap-3 flex-1 min-w-0">
                            ${coverHtml}
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-3 mb-1">
                                    <span class="font-bold truncate text-sm tracking-tight">${song.title || 'Adsız'}</span>
                                    ${badge}
                                </div>
                                <div class="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-3">
                                    <i class="fa-regular fa-clock"></i> ${dur}
                                </div>
                            </div>
                        </div>
                        <div class="flex gap-2 flex-shrink-0">
                            <button onclick="togglePlay('${sid}',this)" class="shadcn-button-secondary px-3 py-1.5 text-xs flex items-center gap-2">
                                <i class="fa-solid fa-play text-[10px]"></i> Dinle
                            </button>
                            <a href="${url}" download class="shadcn-button-secondary px-3 py-1.5 text-xs flex items-center gap-2">
                                <i class="fa-solid fa-download text-[10px]"></i> İndir
                            </a>
                        </div>
                    </div>
                    ${song.lyrics ? `<div class="pl-[60px]"><details class="mt-2"><summary class="text-[10px] font-bold uppercase tracking-widest text-zinc-600 cursor-pointer hover:text-zinc-400 transition"><i class="fa-solid fa-chevron-right mr-1.5"></i>Sözler & Tarz</summary><div class="text-[10px] text-zinc-500 mt-2 bg-zinc-950 border border-zinc-900 rounded-md p-3 leading-relaxed">${song.style ? `<div class="mb-2 pb-2 border-b border-zinc-900/60"><span class="text-zinc-400 font-bold uppercase mr-1">Tarz:</span> ${song.style}</div>` : ''}<pre class="whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">${song.lyrics}</pre></div></details></div>` : ''}
                `;
                card.classList.add('border-white');
                setTimeout(() => card.classList.remove('border-white'), 3000);
            }
        }
    });
}
document.addEventListener('click', () => document.getElementById('ctxMenu')?.classList.add('hidden'));
document.addEventListener('contextmenu', (e) => {
    if(!e.target.closest('.shadcn-card')) return;
    e.preventDefault();
    const card = e.target.closest('.shadcn-card');
    if(!card.dataset.sid) return;
    ctxSong = { id: card.dataset.sid, title: card.dataset.title, dur: card.dataset.dur, ready: card.dataset.ready==='true' };
    const menu = document.getElementById('ctxMenu');
    if(!menu) return;
    menu.classList.remove('hidden');
    let x = e.clientX, y = e.clientY;
    if(x + 200 > window.innerWidth) x = window.innerWidth - 210;
    if(y + 150 > window.innerHeight) y = window.innerHeight - 160;
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
});
function ctxDinle() { if(ctxSong.ready && typeof playLocalSong === 'function') playLocalSong(ctxSong.id, ctxSong.title); }
function ctxIndir() { if(ctxSong.ready) window.location.href = '/api/download/'+ctxSong.id; }
function ctxVideo() { if(ctxSong.ready && typeof openVideoModal === 'function') openVideoModal(ctxSong.id, ctxSong.title); }
function ctxCover() {
    if(!ctxSong.ready) return;
    const song = knownSongs[ctxSong.id] || {};
    state.audioId = ctxSong.id;
    document.getElementById('songTitle').value = song.title || ctxSong.title || '';
    document.getElementById('songLyrics').value = song.lyrics || song.lyric || '';
    document.getElementById('songStyle').value = song.style || '';
    goToStep(2);
    window.scrollTo({top:0, behavior:'smooth'});
}
setInterval(() => {
    const hasProcessing = Object.values(knownSongs).some(s => !(s.audio_url && s.duration > 0));
    if(!hasProcessing || document.hidden) return;
    fetch('/api/songs?limit=20').then(r => r.json()).then(data => {
        if(data.data && data.data.list) syncSongs(data.data.list);
    }).catch(() => {});
}, 10000);

window.addEventListener('scroll', () => {
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 150) {
        if (libraryHasMore && !libraryLoading) {
            loadAllSongs(true);
        }
    }
});