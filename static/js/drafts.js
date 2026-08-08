let drafts = {};

async function loadDraftsFromServer() {
    try {
        const resp = await fetch('/api/drafts');
        drafts = await resp.json();
        
        // MIGRATION: If we have old local drafts, merge them to server
        const local = localStorage.getItem('musicful_drafts');
        if (local) {
            try {
                const localData = JSON.parse(local);
                drafts = { ...drafts, ...localData };
                await saveDraftsToServer();
                localStorage.removeItem('musicful_drafts');
                console.log("[DRAFTS] Migrated local drafts to server.");
            } catch(e) {}
        }
        updateDraftsUI();
    } catch(e) {
        console.error("[DRAFTS] Failed to load drafts:", e);
    }
}

async function saveDraftsToServer() {
    try {
        await fetch('/api/drafts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(drafts)
        });
    } catch(e) {
        console.error("[DRAFTS] Failed to save drafts:", e);
    }
}

function getDrafts() {
    return drafts;
}

async function saveDraftState(id, data) {
    if (!drafts[id]) drafts[id] = { id: id, updatedAt: Date.now() };
    drafts[id] = { ...drafts[id], ...data, updatedAt: Date.now() };
    await saveDraftsToServer();
    updateDraftsUI();
}

async function removeDraftState(id) {
    if (drafts[id]) {
        delete drafts[id];
        await saveDraftsToServer();
        updateDraftsUI();
    }
}

function toggleDraftsPanel() {
    const p = document.getElementById('draftsPanel');
    const b = document.getElementById('draftsBackdrop');
    if (!p || !b) return;

    if (p.classList.contains('-translate-x-[calc(100%+1rem)]')) {
        // Close others before opening
        const ytSidebar = document.getElementById('ytVideosSidebar');
        if (ytSidebar && !ytSidebar.classList.contains('-translate-x-[calc(100%+1rem)]')) {
            if (typeof toggleYtVideosSidebar === 'function') toggleYtVideosSidebar();
        }
        const queueSidebar = document.getElementById('queueSidebar');
        if (queueSidebar && !queueSidebar.classList.contains('-translate-x-[calc(100%+1rem)]')) {
            if(typeof toggleQueuePanel === 'function') toggleQueuePanel();
        }

        // Open
        b.classList.remove('hidden');
        setTimeout(() => {
            b.classList.add('opacity-100');
            p.classList.remove('-translate-x-[calc(100%+1rem)]');
            p.classList.add('translate-x-0');
        }, 10);
        updateDraftsUI();
        document.body.style.overflow = 'hidden';
    } else {
        // Close
        p.classList.remove('translate-x-0');
        p.classList.add('-translate-x-[calc(100%+1rem)]');
        b.classList.remove('opacity-100');
        setTimeout(() => {
            b.classList.add('hidden');
        }, 300);
        document.body.style.overflow = '';
    }
}

function resumeDraft(id, type) {
    const draft = getDrafts()[id];
    if(!draft) return;
    
    if (type === 'cover') {
        state.audioId = draft.audioId || state.audioId;
        state.mode = draft.mode || 'cover';
        if(draft.songTitle) document.getElementById('songTitle').value = draft.songTitle;
        if(draft.songStyle) document.getElementById('songStyle').value = draft.songStyle;
        if(draft.songLyrics) document.getElementById('songLyrics').value = draft.songLyrics;
        
        if(draft.weirdness !== undefined) {
            state.weirdness = draft.weirdness;
            const wInput = document.getElementById('songWeirdness');
            if(wInput) wInput.value = draft.weirdness;
            const wVal = document.getElementById('weirdnessVal');
            if(wVal) wVal.textContent = parseFloat(draft.weirdness).toFixed(2);
        } else {
            state.weirdness = 0.50;
            const wInput = document.getElementById('songWeirdness');
            if(wInput) wInput.value = 0.50;
            const wVal = document.getElementById('weirdnessVal');
            if(wVal) wVal.textContent = "0.50";
        }

        if(draft.styleInfluence !== undefined) {
            state.styleInfluence = draft.styleInfluence;
            const sInput = document.getElementById('songStyleInfluence');
            if(sInput) sInput.value = draft.styleInfluence;
            const sVal = document.getElementById('styleInfluenceVal');
            if(sVal) sVal.textContent = parseFloat(draft.styleInfluence).toFixed(2);
        } else {
            state.styleInfluence = 0.50;
            const sInput = document.getElementById('songStyleInfluence');
            if(sInput) sInput.value = 0.50;
            const sVal = document.getElementById('styleInfluenceVal');
            if(sVal) sVal.textContent = "0.50";
        }

        if(typeof setMode === 'function') setMode(state.mode);
        goToStep(2);
        toggleDraftsPanel();
    } else if (type === 'video') {
        if(!window.videoStates) window.videoStates = {};
        const vs = draft.videoState || {};
        window.videoStates[id] = vs;

        // If draft was mid-encoding (step 2), verify the task still exists on server
        if (vs.step === 2 && vs.video_id) {
            fetch('/api/video-status/' + vs.video_id)
                .then(r => r.json())
                .then(t => {
                    if (t.status === 'done' && t.download) {
                        // Completed while we were away — restore to step 3
                        vs.step = 3;
                        vs.download_url = t.download;
                        window.videoStates[id] = vs;
                        saveDraftState(id, { videoState: vs });
                        openVideoModal(id, draft.title || id);
                    } else if (t.status === 'processing' || t.status === 'not_found' || !t.status) {
                        // Server restarted / task gone → reset to step 1, ask user to re-render
                        vs.step = 1;
                        vs.task_id = null;
                        window.videoStates[id] = vs;
                        saveDraftState(id, { videoState: vs });
                        openVideoModal(id, draft.title || id);
                        // Brief toast to explain
                        setTimeout(() => {
                            const info = document.createElement('div');
                            info.className = 'fixed top-4 right-4 z-50 bg-yellow-600/90 text-white text-sm px-4 py-2 rounded-xl shadow-lg fade-in';
                            info.innerHTML = '<i class="fa-solid fa-circle-info mr-2"></i>Sunucu yeniden başlatıldı — video yeniden oluşturulmalı.';
                            document.body.appendChild(info);
                            setTimeout(() => info.remove(), 5000);
                        }, 500);
                    } else {
                        // Still running — resume polling
                        openVideoModal(id, draft.title || id);
                        const queueKey = 'video_' + id;
                        if(!activeTasks[queueKey]) {
                            activeTasks[queueKey] = { id: queueKey, type: 'video', status: 'running', title: draft.title || id };
                            saveActiveTasks();
                        }
                        _pollVideoStatus(vs.video_id, queueKey);
                    }
                })
                .catch(() => {
                    // Network error — just open modal at step 1
                    vs.step = 1; vs.task_id = null;
                    window.videoStates[id] = vs;
                    openVideoModal(id, draft.title || id);
                });
        } else if (vs.step === 2) {
            // Old draft format: step 2 but no video_id stored — server state is gone, reset to step 1
            vs.step = 1;
            vs.task_id = null;
            window.videoStates[id] = vs;
            saveDraftState(id, { videoState: vs });
            openVideoModal(id, draft.title || id);
            setTimeout(() => {
                const info = document.createElement('div');
                info.className = 'fixed top-4 right-4 z-50 bg-yellow-600/90 text-white text-sm px-4 py-2 rounded-xl shadow-lg fade-in';
                info.innerHTML = '<i class="fa-solid fa-circle-info mr-2"></i>Video işlemi kayboldu — kapak seçip tekrar oluşturabilirsin.';
                document.body.appendChild(info);
                setTimeout(() => info.remove(), 6000);
            }, 400);
        } else {
            openVideoModal(id, draft.title || id);
        }
        toggleDraftsPanel();
    }
}

function updateDraftsUI() {
    const drafts = getDrafts();
    const list = document.getElementById('draftsList');
    const toggleBtn = document.getElementById('draftsToggleBtn');
    if (!list) return;
    
    const arr = Object.values(drafts).sort((a,b) => b.updatedAt - a.updatedAt);
    
    if (arr.length > 0) {
        toggleBtn.classList.remove('hidden');
        let html = '';
        arr.forEach(d => {
            const dateStr = new Date(d.updatedAt).toLocaleTimeString();
            let icon = 'fa-solid fa-file-pen pt-1 text-zinc-500';
            let title = d.title || 'İsimsiz Şarkı';
            let subtitle = 'Düzenleniyor';
            
            if (d.type === 'video') {
                icon = 'fa-solid fa-film text-zinc-400 pt-1';
                subtitle = 'Kapak / Video / SEO';
            } else if (d.type === 'cover') {
                icon = 'fa-solid fa-music text-zinc-400 pt-1';
                subtitle = 'Sözler & Stil';
                title = d.songTitle || 'Yeni Cover Projesi';
            }

            html += `
                <div class="shadcn-card p-4 space-y-3 fade-in group relative overflow-hidden">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex items-start gap-3">
                            <div class="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center flex-shrink-0">
                                <i class="${icon} text-sm"></i>
                            </div>
                            <div class="space-y-0.5">
                                <div class="font-bold text-sm text-white leading-tight break-words">${title}</div>
                                <div class="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">${subtitle}</div>
                            </div>
                        </div>
                        <button onclick="removeDraftState('${d.id}')" class="p-2 -mr-2 text-zinc-600 hover:text-white transition-colors">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    </div>
                    
                    <div class="flex items-center justify-between text-[10px] text-zinc-600 font-mono">
                        <span>SON GÜNCELLEME</span>
                        <span>${dateStr}</span>
                    </div>

                    <button onclick="resumeDraft('${d.id}', '${d.type}')" class="w-full shadcn-button-primary py-2.5 text-xs flex items-center justify-center gap-2">
                        <span>Devam Et</span>
                        <i class="fa-solid fa-chevron-right text-[10px]"></i>
                    </button>
                </div>
            `;
        });
        list.innerHTML = html;
        const badge = document.getElementById('draftsCountBadge');
        if(badge) {
            badge.textContent = arr.length;
            badge.classList.remove('hidden');
        }
    } else {
        toggleBtn.classList.add('hidden');
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 text-center space-y-4">
                <div class="w-16 h-16 rounded-full bg-zinc-900/50 border border-dashed border-zinc-800 flex items-center justify-center">
                    <i class="fa-solid fa-check text-zinc-700 text-xl"></i>
                </div>
                <div class="space-y-1">
                    <div class="text-white font-bold text-sm">Taslak Yok</div>
                    <div class="text-zinc-600 text-xs">Şu an yarım kalmış bir projen bulunmuyor.</div>
                </div>
            </div>
        `;
    }
}

document.addEventListener('DOMContentLoaded', () => { 
    loadDraftsFromServer();
    setTimeout(updateDraftsUI, 1000); 
});
