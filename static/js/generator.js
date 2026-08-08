async function createSong() {
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
        if(typeof removeDraftState === 'function') removeDraftState('active_cover');
        const endpoint = state.mode === 'text-to-song' ? '/api/text-to-song' : '/api/make-song';
        const bodyData = state.mode === 'text-to-song' 
            ? { 
                title: state.title, 
                lyrics: state.lyrics, 
                style: state.style, 
                mv: state.mv, 
                bypass_filter: state.bypassFilter,
                weirdness: state.weirdness,
                style_influence: state.styleInfluence
              }
            : { 
                audio_id: state.audioId, 
                title: state.title, 
                lyrics: state.lyrics, 
                style: state.style, 
                mv: state.mv, 
                bypass_filter: state.bypassFilter,
                weirdness: state.weirdness,
                style_influence: state.styleInfluence
              };

        const resp = await fetch(endpoint, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify(bodyData)
        });
        const data = await resp.json();
        if(data.data && data.data.song_ids) {
            const songIds = data.data.song_ids;
            const text = card.querySelector('.ct-text');
            const bar = card.querySelector('.ct-bar');
            // Keep song title, don't overwrite with version count
            bar.style.width = '20%';
            if (activeTasks[taskId]) {
                activeTasks[taskId].songIds = songIds;
                saveActiveTasks();
            }
            pollForTask(taskId, songIds);
        } else {
            taskError(card, 'Hata: ' + JSON.stringify(data));
        }
    } catch(e) {
        taskError(card, e.message);
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
    
    // Tüm kutuları sıfırla
    if (document.getElementById('songTitle')) document.getElementById('songTitle').value = '';
    if (document.getElementById('songLyrics')) document.getElementById('songLyrics').value = '';
    if (document.getElementById('songStyle')) document.getElementById('songStyle').value = '';
    if (document.getElementById('ytUrl')) document.getElementById('ytUrl').value = '';
    if (typeof goToStep === 'function') goToStep(1);
}
async function pollForTask(taskId, songIds) {
    const card = document.getElementById(taskId);
    if(!card) return;
    const bar = card.querySelector('.ct-bar');
    const text = card.querySelector('.ct-text');
    const ids = songIds.join(',');
    let elapsed = 0;
    
    // Smooth transition settings
    if(bar) bar.style.transition = 'width 2s linear';

    while(elapsed < 300000) {
        if(!document.getElementById(taskId)) return;
        try {
            const resp = await fetch(`/api/poll/${ids}`);
            const data = await resp.json();
            const songs = data.data.result;
            const allDone = songs.every(s=>s.status===0);
            const anyFailed = songs.some(s=>s.status===3);

            if(anyFailed && !allDone) {
                taskError(card, 'Üretilemedi! Farklı şarkı deneyin.');
                return;
            }

            const doneCount = songs.filter(s=>s.status===0).length;
            
            // Calculate a fluid progress: Base (20%) + Per Done (35% each) + Time Crawl (up to 10%)
            // This ensures it moves even when server hasn't finished a version
            const base = 20 + (doneCount / songs.length) * 60;
            const crawl = Math.min((elapsed / 120000) * 15, 15); // Add up to 15% crawl over 2 mins
            const p = Math.min(base + crawl, 95);
            
            if(bar) bar.style.width = p + '%';

            if(allDone) {
                const allReady = await checkCDNReady(songs);
                if(!allReady) {
                    if(bar) bar.style.width = '98%';
                } else {
                    if(bar) {
                        bar.style.transition = 'width 0.5s ease-out';
                        bar.style.width = '100%';
                        bar.className = "ct-bar bg-white h-full rounded-full transition-all duration-500";
                    }
                    text.innerHTML = '<span class="text-white">Tamamlandı!</span>';
                    
                    const spinner = card.querySelector('.fa-spinner');
                    if (spinner) {
                        spinner.className = 'fa-solid fa-circle-check text-emerald-400 text-xs';
                    }

                    loadAllSongs();
                    if(activeTasks[taskId]) { delete activeTasks[taskId]; saveActiveTasks(); }
                    
                    setTimeout(() => {
                        card.style.opacity = '0';
                        card.style.transition = 'all 0.5s ease-out';
                        card.style.transform = 'translateY(-10px)';
                        setTimeout(() => {
                            card.remove();
                        }, 500);
                    }, 5000);

                    return;
                }
            }
        } catch(e) {
            text.innerHTML = `<span class="text-red-500">${e.message}</span>`;
        }
        await sleep(5000);
        elapsed += 5000;
    }
    
    const spinner = card.querySelector('.fa-spinner');
    if (spinner) {
        spinner.className = 'fa-solid fa-circle-exclamation text-red-500 text-xs';
    }
    if (bar) {
        bar.className = "ct-bar bg-red-600 h-full rounded-full transition-all duration-500";
        bar.style.width = '100%';
    }
    text.innerHTML = '<span class="text-red-500 font-bold uppercase tracking-widest">Zaman aşımı</span>';
    if(activeTasks[taskId]) { delete activeTasks[taskId]; saveActiveTasks(); }
    
    setTimeout(() => {
        card.style.opacity = '0';
        card.style.transition = 'all 0.5s ease-out';
        card.style.transform = 'translateY(-10px)';
        setTimeout(() => {
            card.remove();
        }, 500);
    }, 8000);
}
async function checkCDNReady(songs) {
    for(const song of songs) {
        try { const r = await fetch(`/api/check-download/${song.song_id}`); const d = await r.json(); if(!d.ready) return false; }
        catch(e) { return false; }
    }
    return true;
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