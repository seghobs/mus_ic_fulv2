let generationSubmitting = false;
let generationSubmitted = false;

function setGenerationSubmitted(submitted) {
    generationSubmitted = submitted;
    document.getElementById('generationConfirmation')?.classList.toggle('hidden', submitted);
    const tracking = document.getElementById('generationTracking');
    tracking?.classList.toggle('hidden', !submitted);
    if (submitted && tracking) {
        tracking.focus({preventScroll: true});
        tracking.scrollIntoView({block: 'nearest'});
    }
}

async function createSong() {
    if (generationSubmitting || generationSubmitted) return;
    generationSubmitting = true;
    const button = document.getElementById('createBtn');
    const buttonLabel = button?.innerHTML;
    if (button) {
        button.disabled = true;
        button.textContent = 'Üretim başlatılıyor…';
    }
    activeTaskCounter++;
    const taskId = 'task_' + activeTaskCounter;
    const taskList = document.getElementById('createTaskList');

    const card = document.createElement('div');
    card.id = taskId;
    card.className = 'shadcn-card p-4 mb-3 fade-in';
    card.innerHTML = `
        <div class="flex items-center gap-3 mb-4">
            <div class="w-8 h-8 bg-zinc-900 border border-zinc-800 rounded-md flex items-center justify-center">
                <i class="fa-solid fa-spinner fa-spin text-white text-xs"></i>
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Şarkı Üretimi</div>
                <div class="ct-text text-xs font-bold text-white truncate">${state.title || 'Yeni Şarkı'}</div>
            </div>
        </div>
        <div class="bg-zinc-900 border border-zinc-800 rounded-full h-2 overflow-hidden">
            <div class="ct-bar bg-white h-full rounded-full transition-all duration-500" style="width:10%"></div>
        </div>
    `;
    taskList.prepend(card);
    activeTasks[taskId] = { id: taskId, type: 'cover', status: 'running', title: state.title };
    saveActiveTasks();

    try {
        const endpoint = state.mode === 'text-to-song' ? '/api/text-to-song' : '/api/make-song';
        const bodyData = state.mode === 'text-to-song' 
            ? { 
                title: state.title, 
                lyrics: state.lyrics, 
                style: state.style, 
                mv: state.mv, 
                weirdness: state.weirdness,
                style_influence: state.styleInfluence
              }
            : { 
                audio_id: state.audioId, 
                title: state.title, 
                lyrics: state.lyrics, 
                style: state.style, 
                mv: state.mv, 
                weirdness: state.weirdness,
                style_influence: state.styleInfluence
              };

        const resp = await fetch(endpoint, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify(bodyData)
        });
        const data = await resp.json();
        if(resp.ok && Array.isArray(data.data?.song_ids) && data.data.song_ids.length > 0) {
            if(typeof removeDraftState === 'function') removeDraftState('active_cover');
            const songIds = data.data.song_ids;
            const text = card.querySelector('.ct-text');
            const bar = card.querySelector('.ct-bar');
            // Keep song title, don't overwrite with version count
            bar.style.width = '20%';
            if (activeTasks[taskId]) {
                activeTasks[taskId].songIds = songIds;
                saveActiveTasks();
            }
            setGenerationSubmitted(true);
            pollForTask(taskId, songIds);
        } else {
            taskError(card, data.error || data.message || data.msg || 'Üretim başlatılamadı. Lütfen tekrar deneyin.');
        }
    } catch(e) {
        taskError(card, e.message);
    } finally {
        generationSubmitting = false;
        if (button) {
            button.disabled = false;
            button.innerHTML = buttonLabel;
        }
    }
}
function taskError(card, msg) {
    const taskId = card.id;
    if(activeTasks[taskId]) { delete activeTasks[taskId]; saveActiveTasks(); }
    if(card) {
        card.querySelector('.ct-text').innerHTML = `<span class="text-red-500">${msg}</span>`;
        const bar = card.querySelector('.ct-bar');
        if (bar) {
            bar.className = "ct-bar bg-red-600 h-full rounded-full transition-all duration-500";
            bar.style.width = '100%';
        }
        const spinner = card.querySelector('.fa-spinner');
        if (spinner) {
            spinner.className = 'fa-solid fa-circle-exclamation text-red-500 text-xs';
        }
        
        setTimeout(() => {
            card.style.opacity = '0';
            card.style.transition = 'all 0.5s ease-out';
            card.style.transform = 'translateY(-10px)';
            setTimeout(() => {
                card.remove();
            }, 500);
        }, 8000);
    }
    
    if (typeof showNotification === 'function') {
        showNotification('İşlem Başarısız', msg, 'error');
    }
}
// Keep SSE progress even when a status request is still in flight.
const generationTrackers = new Map();

function finishGeneration(tracker) {
    if (tracker.done) return;
    tracker.done = true;
    const card = document.getElementById(tracker.taskId);
    if (card) {
        const bar = card.querySelector('.ct-bar');
        if (bar) { bar.style.transition = 'width 0.3s ease-out'; bar.style.width = '100%'; }
        card.querySelector('.ct-text').textContent = 'Tamamlandı!';
        const spinner = card.querySelector('.fa-spinner');
        if (spinner) spinner.className = 'fa-solid fa-circle-check text-emerald-400 text-xs';
        setTimeout(() => card.remove(), 5000);
    }
    delete activeTasks[tracker.taskId];
    saveActiveTasks();
    if (typeof updateQueueUI === 'function') updateQueueUI();
    loadAllSongs();
}

// Called only after queue.js verifies the event belongs to the current account.
function handleGenerationReady(signal) {
    const signalIds = [signal.song_id, ...(signal.ids || [])].map(String);
    for (const tracker of generationTrackers.values()) {
        if (tracker.done) continue;
        tracker.ids.filter(id => signalIds.includes(id)).forEach(id => tracker.ready.add(id));
        if (tracker.ids.every(id => tracker.ready.has(id))) finishGeneration(tracker);
    }
}

async function pollForTask(taskId, songIds) {
    const card = document.getElementById(taskId);
    if (!card || generationTrackers.has(taskId)) return;
    if (!Array.isArray(songIds) || songIds.length === 0) {
        taskError(card, 'Takip edilecek şarkı bulunamadı. Lütfen tekrar deneyin.');
        return;
    }
    const tracker = {taskId, ids: [...new Set(songIds.map(String))], ready: new Set(), done: false};
    generationTrackers.set(taskId, tracker);
    const bar = card.querySelector('.ct-bar');
    const text = card.querySelector('.ct-text');
    try {
        for (let elapsed = 0; elapsed < 300000; elapsed += 5000) {
            if (tracker.done || !document.getElementById(taskId)) return;
            try {
                const resp = await fetch(`/api/poll/${tracker.ids.join(',')}`);
                const data = await resp.json();
                // An SSE completion must never be overwritten by an older response.
                if (tracker.done) return;
                if (!resp.ok) throw new Error(data.error || 'Durum kontrolü yeniden deneniyor…');
                const results = Array.isArray(data.data?.result) ? data.data.result : [];
                const songs = tracker.ids.map(id => results.find(song =>
                    song && [String(song.song_id), String(song.id)].includes(id))).filter(Boolean);
                if (songs.some(song => [3, 500227, 500235, 500233, 500234, 505262].includes(Number(song.status)))) {
                    taskError(card, 'Üretim tamamlanamadı. Şarkının hata bilgisini kontrol edin.');
                    return;
                }
                songs.forEach(song => {
                    if (Number(song.status) === 0) tracker.ids.filter(id =>
                        [String(song.song_id), String(song.id)].includes(id)).forEach(id => tracker.ready.add(id));
                });
                if (tracker.ids.every(id => tracker.ready.has(id))) {
                    finishGeneration(tracker);
                    return;
                }
                if (bar) bar.style.width = Math.min(20 + tracker.ready.size / tracker.ids.length * 60 + elapsed / 120000 * 15, 95) + '%';
            } catch (error) {
                if (tracker.done) return;
                text.textContent = 'Durum kontrolü yeniden deneniyor…';
            }
            if (tracker.done) return;
            if (typeof waitForMusicfulSignal === 'function') await waitForMusicfulSignal(tracker.ids, 5000);
            else await sleep(5000);
        }
        if (!tracker.done) taskError(card, 'Durum takibi zaman aşımına uğradı. Kütüphaneyi kontrol edin.');
    } finally {
        generationTrackers.delete(taskId);
    }
}
async function checkCDNReady(songs) {
    if (!Array.isArray(songs) || songs.length === 0) return false;
    const ready = await Promise.all(songs.map(async song => {
        const id = song.song_id || song.id;
        if (!id) return false;
        try { const r = await fetch(`/api/check-download/${encodeURIComponent(id)}`); const d = await r.json(); if(!r.ok || !d.ready) return false; }
        catch(e) { return false; }
        return true;
    }));
    return ready.every(Boolean);
}

async function restoreCoverTasks() {
    const taskList = document.getElementById('createTaskList');
    if (!taskList) return;

    Object.values(activeTasks).forEach(t => {
        if (t.type === 'cover' && t.status === 'running' && t.songIds) {
            const taskId = t.id;
            
            const numId = parseInt(taskId.replace('task_', ''));
            if (!isNaN(numId) && numId > activeTaskCounter) {
                activeTaskCounter = numId;
            }

            if (document.getElementById(taskId)) return;

            const card = document.createElement('div');
            card.id = taskId;
            card.className = 'shadcn-card p-4 mb-3 fade-in';
            card.innerHTML = `
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-8 h-8 bg-zinc-900 border border-zinc-800 rounded-md flex items-center justify-center">
                        <i class="fa-solid fa-spinner fa-spin text-white text-xs"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Şarkı Üretimi</div>
                        <div class="ct-text text-xs font-bold text-white truncate">${t.title || 'Yeni Şarkı'}</div>
                    </div>
                </div>
                <div class="bg-zinc-900 border border-zinc-800 rounded-full h-2 overflow-hidden">
                    <div class="ct-bar bg-white h-full rounded-full transition-all duration-500" style="width:20%"></div>
                </div>
            `;
            taskList.prepend(card);
            pollForTask(taskId, t.songIds);
        }
    });
}
