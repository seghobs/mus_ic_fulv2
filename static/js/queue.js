function toggleQueuePanel() {
    const sidebar = document.getElementById('queueSidebar');
    if(!sidebar) return;

    const isHidden = sidebar.classList.contains('-translate-x-[calc(100%+1rem)]');

    // YouTube Arşivi açıksa kapat
    const ytSidebar = document.getElementById('ytVideosSidebar');
    if (isHidden && ytSidebar && !ytSidebar.classList.contains('-translate-x-[calc(100%+1rem)]')) {
        if (typeof toggleYtVideosSidebar === 'function') toggleYtVideosSidebar();
    }
    
    // Taslaklar açıksa kapat
    const draftsPanel = document.getElementById('draftsPanel');
    if (isHidden && draftsPanel && !draftsPanel.classList.contains('-translate-x-[calc(100%+1rem)]')) {
        if (typeof toggleDraftsPanel === 'function') toggleDraftsPanel();
    }

    if(isHidden) {
        sidebar.classList.remove('-translate-x-[calc(100%+1rem)]');
        sidebar.classList.add('translate-x-0');
    } else {
        sidebar.classList.add('-translate-x-[calc(100%+1rem)]');
        sidebar.classList.remove('translate-x-0');
    }
}

function getTaskIcon(type) {
    const icons = { youtube: 'fa-brands fa-youtube', video: 'fa-solid fa-film', play: 'fa-solid fa-headphones', cover: 'fa-solid fa-wand-magic-sparkles', seo: 'fa-solid fa-tags' };
    return (icons[type] || 'fa-solid fa-gear') + ' text-zinc-500';
}
function getTaskLabel(type) {
    const labels = { youtube: 'YouTube İndir', video: 'Video Oluştur', play: 'Dinle', cover: 'Şarkı Üretimi', seo: 'SEO Üretimi' };
    return labels[type] || type;
}

function showNotification(title, msg, type = 'success') {
    const container = document.getElementById('notificationContainer') || document.body;
    const toast = document.createElement('div');
    toast.className = 'notification-toast notification-in';
    
    const icon = type === 'success' ? 'fa-check' : (type === 'error' ? 'fa-xmark' : 'fa-info');
    const iconColor = type === 'error' ? 'bg-red-500 text-white' : 'bg-white text-black';

    toast.innerHTML = `
        <div class="notif-icon ${iconColor}">
            <i class="fa-solid ${icon}"></i>
        </div>
        <div class="notif-content">
            <div class="notif-title">${title}</div>
            <div class="notif-msg">${msg}</div>
        </div>
    `;

    container.appendChild(toast);

    // Auto remove after 5s
    setTimeout(() => {
        toast.classList.replace('notification-in', 'notification-out');
        setTimeout(() => toast.remove(), 500);
    }, 5000);
}

function _showQueueToast(msg, isError) {
    showNotification(isError ? 'Hata' : 'Bilgi', msg, isError ? 'error' : 'info');
}

function navigateToTask(type, taskId) {
    if (window.innerWidth < 768) toggleQueuePanel(); // Close on mobile after navigation
    
    if (type === 'video') {
        if (typeof getDrafts === 'function') {
            const drafts = getDrafts();
            for (let sid in drafts) {
                const d = drafts[sid];
                if (d.type === 'video') {
                    if ((d.videoState && d.videoState.task_id === taskId) || sid === taskId.replace('video_','')) {
                        resumeDraft(sid, 'video');
                        return;
                    }
                }
            }
        }
        const modal = document.getElementById('videoModal');
        if(modal && !modal.classList.contains('hidden')) return;
        _showQueueToast('Video modalı açılıyor...');
    } else if (type === 'cover') {
        if (typeof goToStep === 'function') goToStep(3);
    } else if (type === 'youtube') {
        _showQueueToast('⏬ YouTube indirme devam ediyor...');
    } else if (type === 'seo') {
        const modal = document.getElementById('videoModal');
        if(modal && modal.classList.contains('hidden')) {
            _showQueueToast('SEO üretimi arka planda devam ediyor.');
        }
    } else {
        _showQueueToast('İşlem arka planda devam ediyor.');
    }
}

function updateQueueUI() {
    const sideBadge   = document.getElementById('queueSidebarBadge');
    const mobileBadge = document.getElementById('queueMobileBadge');
    const emptyState  = document.getElementById('queueEmptyState');
    const list        = document.getElementById('queuePanelList');

    const running = Object.values(activeTasks).filter(t => t.status === 'running');
    const pending = Object.values(activeTasks).filter(t => t.status === 'pending');
    const all     = [...running, ...pending];

    if(all.length > 0) {
        if(sideBadge) { sideBadge.textContent = all.length; sideBadge.classList.remove('hidden'); }
        if(mobileBadge) { mobileBadge.textContent = all.length; mobileBadge.classList.remove('hidden'); }
        if(emptyState) emptyState.style.display = 'none';

        let html = '';
        all.forEach(t => {
            if(!taskStartTimes[t.id]) taskStartTimes[t.id] = Date.now();
            const elapsed = Math.round((Date.now() - taskStartTimes[t.id]) / 1000);
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            const timeStr = mins > 0 ? `${mins}dk ${secs}sn` : `${secs}sn`;
            const spinIcon = t.status === 'running'
                ? '<i class="fa-solid fa-spinner fa-spin text-white text-[10px]"></i>'
                : '<i class="fa-solid fa-clock text-zinc-500 text-[10px]"></i>';

            let navFn = '';
            let navHint = '';
            if (t.type === 'video') { navFn = `navigateToTask('video','${t.id}')`; navHint = 'Video modalını aç'; }
            else if (t.type === 'cover') { navFn = `navigateToTask('cover','${t.id}')`; navHint = 'Üretim adımına git'; }
            else if (t.type === 'youtube') { navFn = `navigateToTask('youtube','${t.id}')`; navHint = 'İndirme devam ediyor'; }
            else if (t.type === 'seo') { navFn = `navigateToTask('seo','${t.id}')`; navHint = 'SEO adımına git'; }
            else { navFn = `navigateToTask('other','${t.id}')`; navHint = 'Göreve git'; }

            const titleHtml = t.title
                ? `<div class="text-[9px] font-bold uppercase tracking-widest text-zinc-500 truncate mt-0.5" title="${t.title}">${t.title}</div>`
                : '';
            const phaseLabel = t.phase
                ? `<span class="text-white text-[8px] font-bold uppercase tracking-[0.2em]">${t.phase}</span>`
                : `<span class="text-zinc-500 text-[8px] font-bold uppercase tracking-[0.2em]">${t.status === 'running' ? 'İŞLENİYOR' : 'BEKLİYOR'}</span>`;

            // Simple progress bar for queue items
            const currentProgress = t.progress || (t.status === 'running' ? 35 : 0);
            const progressBar = `
                <div class="w-full bg-black/40 border border-zinc-800/50 rounded-full h-1 mt-2.5 overflow-hidden">
                    <div class="bg-white h-full rounded-full transition-all duration-700 ${t.status === 'running' ? 'opacity-100' : 'opacity-20'}" style="width: ${currentProgress}%"></div>
                </div>
            `;

            html += `<div onclick="${navFn}" oncontextmenu="handleTaskContextMenu(event, '${t.id}')" title="${navHint}"
                class="group bg-zinc-900/30 border border-zinc-900 hover:border-zinc-700/50 hover:bg-zinc-900/50
                       rounded-xl p-4 flex flex-col cursor-pointer transition-all duration-300 select-none relative overflow-hidden">
                <div class="flex items-center gap-4">
                    <div class="w-9 h-9 rounded-lg bg-zinc-950 group-hover:bg-black border border-zinc-800 flex items-center justify-center flex-shrink-0 transition-all duration-500 shadow-xl">
                        <i class="${getTaskIcon(t.type)} text-xs transition-transform group-hover:scale-110"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="text-[9px] font-black uppercase tracking-[0.15em] text-white/90 group-hover:text-white transition-colors">${getTaskLabel(t.type)}</div>
                        ${titleHtml}
                        <div class="flex items-center gap-2 mt-1">${phaseLabel}</div>
                    </div>
                </div>
                ${progressBar}
                <div class="absolute right-0 top-0 bottom-0 w-0.5 bg-white opacity-0 group-hover:opacity-100 transition-opacity"></div>
            </div>`;
        });

        if(list) {
            list.innerHTML = html;
            const emptyEl = document.createElement('div');
            emptyEl.id = 'queueEmptyState';
            emptyEl.style.display = 'none';
            emptyEl.className = 'text-center py-20 text-zinc-700';
            emptyEl.innerHTML = '<div class="w-12 h-12 bg-zinc-900/50 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-800/50"><i class="fa-solid fa-check text-sm opacity-20"></i></div><p class="text-[10px] font-bold uppercase tracking-widest opacity-40">Her Şey Hazır</p>';
            list.appendChild(emptyEl);
        }
    } else {
        if(sideBadge) { sideBadge.textContent = '0'; sideBadge.classList.add('hidden'); }
        if(mobileBadge) { mobileBadge.textContent = '0'; mobileBadge.classList.add('hidden'); }
        const emptyEl = document.getElementById('queueEmptyState');
        if(emptyEl) { emptyEl.style.display = ''; }
        if(list) {
            Array.from(list.children).forEach(c => { if(c.id !== 'queueEmptyState') c.remove(); });
        }
    }
}

/* ===== CONTEXT MENU LOGIC ===== */
function handleTaskContextMenu(e, taskId) {
    e.preventDefault();
    currentCtxTaskId = taskId;
    const menu = document.getElementById('contextMenu');
    if(!menu) return;

    const qSec = document.getElementById('ctxQueueSection');
    const uSec = document.getElementById('ctxUploadSection');
    
    if(qSec) qSec.classList.remove('hidden');
    if(uSec) uSec.classList.add('hidden');
    
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.classList.remove('hidden');

    const closeMenu = () => {
        menu.classList.add('hidden');
        document.removeEventListener('click', closeMenu);
    };
    document.addEventListener('click', closeMenu);
}

function cancelQueueTask() {
    if (!currentCtxTaskId) return;
    fetch(`/api/queue/cancel/${currentCtxTaskId}`, { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            if (data.ok) {
                delete activeTasks[currentCtxTaskId];
                if(typeof saveActiveTasks === 'function') saveActiveTasks();
                updateQueueUI();
                _showQueueToast('İşlem başarıyla iptal edildi.');
            } else {
                _showQueueToast('Hata: ' + data.error, true);
            }
        });
}

function showQueueTask() {
    if (!currentCtxTaskId) return;
    const t = activeTasks[currentCtxTaskId];
    if (t) navigateToTask(t.type, t.id);
}

setInterval(updateQueueUI, 1000);

async function initSSE() {
    await loadActiveTasks();
    await _verifyRestoredTasks();

    const es = new EventSource('/api/events');

    es.addEventListener('relogin_success', (e) => {
        const data = JSON.parse(e.data);
        if (typeof handleReloginSuccess === 'function') {
            handleReloginSuccess(data);
        }
    });

    es.addEventListener('relogin_error', (e) => {
        const data = JSON.parse(e.data);
        if (typeof handleReloginError === 'function') {
            handleReloginError(data);
        }
    });

    es.addEventListener('rights_update', (e) => {
        const data = JSON.parse(e.data);
        if (typeof updateRightsUI === 'function') {
            updateRightsUI(data);
        }
    });

    es.addEventListener('library_update', (e) => {
        if (typeof loadAllSongs === 'function') {
            loadAllSongs();
        }
    });

    es.addEventListener('task_update', (e) => {
        const data = JSON.parse(e.data);
        if(data.status === 'done' || data.status === 'error' || data.status === 'cancelled') {
            delete activeTasks[data.id];
            if(typeof saveActiveTasks === 'function') saveActiveTasks();
            
            if (data.status === 'cancelled') {
                updateQueueUI();
                showNotification('İptal Edildi', `${getTaskLabel(data.type)} işlemi iptal edildi.`, 'info');
                return;
            }

            if (data.status === 'done') {
                showNotification('İşlem Tamamlandı', `${getTaskLabel(data.type)} başarıyla bitirildi.`);
            } else if (data.status === 'error') {
                showNotification('İşlem Başarısız', `${getTaskLabel(data.type)} işlemi sırasında hata: ${data.error || 'Bilinmeyen hata'}`, 'error');
                
                // Tüm kutuları sıfırla
                if (document.getElementById('songTitle')) document.getElementById('songTitle').value = '';
                if (document.getElementById('songLyrics')) document.getElementById('songLyrics').value = '';
                if (document.getElementById('songStyle')) document.getElementById('songStyle').value = '';
                if (document.getElementById('ytUrl')) document.getElementById('ytUrl').value = '';
                if (typeof goToStep === 'function') goToStep(1);
            }

            if(data.type === 'youtube') {
                if(data.status === 'error') {
                    const statusText = document.getElementById('ytStatusText');
                    const btn = document.getElementById('ytBtn');
                    if(statusText) statusText.innerHTML = `<i class="fa-solid fa-xmark mr-1 text-red-400"></i>${data.error || 'Hata'}`;
                    if(btn) { btn.disabled = false; btn.classList.remove('opacity-50'); }
                } else {
                    fetch('/api/youtube/status/' + data.id).then(r => r.json()).then(pdata => {
                        if(pdata.status === 'done' && pdata.data && pdata.data.song_ids) {
                            const ytTitle = pdata._yt_title || 'YouTube Şarkı';
                            const songId = pdata.data.song_ids[0];
                            state.audioId = songId;
                            state.title = ytTitle;

                            const status = document.getElementById('uploadStatus');
                            const label = document.getElementById('fileLabel');
                            const statusDiv = document.getElementById('ytStatus');
                            const btn = document.getElementById('ytBtn');

                            if(status) status.classList.remove('hidden');
                            if(label) label.innerHTML = `<div class="w-16 h-16 bg-red-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4"><i class="fa-brands fa-youtube text-3xl text-red-400"></i></div><div class="text-red-400 font-medium mb-1">${ytTitle}</div><div class="text-dark-500 text-sm">YouTube'dan indirildi</div>`;
                            if(statusDiv) statusDiv.classList.add('hidden');
                            if(btn) { btn.disabled = false; btn.classList.remove('opacity-50'); }
                            if(typeof pollForLyrics === 'function') pollForLyrics(songId);
                        }
                    });
                }
            }
        } else {
            activeTasks[data.id] = data;
        }
        updateQueueUI();
    });

    es.addEventListener('song_ready', (e) => {
        const song = JSON.parse(e.data);
        if(typeof syncSongs === 'function') syncSongs([song]);
    });

    es.onerror = () => {
        setTimeout(initSSE, 5000);
        es.close();
    };
}