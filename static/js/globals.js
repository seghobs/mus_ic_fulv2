function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function formatTime(s) {
    if(!s || isNaN(s)) return '0:00';
    const m = Math.floor(s/60);
    const sec = Math.floor(s%60);
    return m + ':' + (sec<10?'0':'') + sec;
}
let state = { mode: 'cover', audioId: null, title: '', lyrics: '', style: 'Guitar,Piano', mv: 'v5.5', songIds: [], results: [], bypassFilter: false, weirdness: 0.50, styleInfluence: 0.50 };
let knownSongs = {};
let activeTaskCounter = 0;
const activeTasks = {};
const taskStartTimes = {};

// Persist active tasks to server JSON so restarts/refreshes can restore queue
async function saveActiveTasks() {
    try {
        await fetch('/api/active-tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(activeTasks)
        });
    } catch(e) {
        console.error("[TASKS] Failed to save tasks:", e);
    }
}

async function loadActiveTasks() {
    try {
        const resp = await fetch('/api/active-tasks');
        const saved = await resp.json();
        Object.assign(activeTasks, saved);
        
        // MIGRATION: If we have old local tasks, merge them to server
        const local = localStorage.getItem('musicful_active_tasks');
        if (local) {
            try {
                const localData = JSON.parse(local);
                Object.assign(activeTasks, localData);
                await saveActiveTasks();
                localStorage.removeItem('musicful_active_tasks');
                console.log("[TASKS] Migrated local tasks to server.");
            } catch(e) {}
        }

        // Record start times so elapsed timer works
        Object.keys(activeTasks).forEach(id => {
            if (!taskStartTimes[id]) taskStartTimes[id] = Date.now();
        });
        
        if (typeof updateQueueUI === 'function') updateQueueUI();
        if (typeof restoreCoverTasks === 'function') restoreCoverTasks();
    } catch(e) {
        console.error("[TASKS] Failed to load tasks:", e);
    }
}

// Cross-check restored tasks against the server queue; purge completed/stale ones
async function _verifyRestoredTasks() {
    if (Object.keys(activeTasks).length === 0) return;
    try {
        const resp = await fetch('/api/queue');
        const data = await resp.json();
        const serverTaskIds = new Set((data.tasks || []).filter(t => t.status === 'running' || t.status === 'pending').map(t => t.id));
        let changed = false;
        Object.keys(activeTasks).forEach(id => {
            // Only verify generic server tasks, keep custom ones like 'youtube_' or 'video_'
            if (id.length > 10 && !id.startsWith('youtube_') && !id.startsWith('video_')) {
                if (!serverTaskIds.has(id)) {
                    delete activeTasks[id];
                    changed = true;
                }
            }
        });
        if (changed) await saveActiveTasks();
    } catch(e) {}
}
// Update the live sub-step label shown in the Queue panel for a given task id
function updateTaskPhase(taskId, phase) {
    if (!activeTasks[taskId]) return;
    activeTasks[taskId].phase = phase;
    // no need to persist to localStorage – phase is ephemeral
}
let fpAudio = null;
let fpBound = false;
let fpCurrentId = null;
let fpSeekTimer = null;
let fpSeekAccel = 0;
let fpBarDragging = false;
let videoSongId = '';
let activeVideoTaskId = null;
let selectedAiCover = null;
let activeVideoIdForUpload = null;
let ytSearchTimeout = null;
let ytCurrentQuery = '';
let ytCurrentPage = 1;
let browserPollInterval = null;
let editingTokenId = null;
let ctxSong = {};

function goToStep(n) {
    if(n>=2) {
        state.title = document.getElementById('songTitle').value;
        state.lyrics = document.getElementById('songLyrics').value;
        state.style = document.getElementById('songStyle').value;
        state.mv = document.getElementById('modelSelect').value;
        state.bypassFilter = document.getElementById('bypassFilter') ? document.getElementById('bypassFilter').checked : false;
        state.weirdness = document.getElementById('songWeirdness') ? parseFloat(document.getElementById('songWeirdness').value) : 0.50;
        state.styleInfluence = document.getElementById('songStyleInfluence') ? parseFloat(document.getElementById('songStyleInfluence').value) : 0.50;
    }
    if(n===3) {
        document.getElementById('confirmTitle').textContent = state.title;
        document.getElementById('confirmStyle').textContent = state.style;
        document.getElementById('confirmLyrics').textContent = state.lyrics;
        const modelEl = document.getElementById('modelSelect');
        document.getElementById('confirmModel').textContent = modelEl.options[modelEl.selectedIndex].text;
        
        document.getElementById('confirmWeirdness').textContent = state.weirdness;
        document.getElementById('confirmStyleInfluence').textContent = state.styleInfluence;
    }
    for(let i=1;i<=4;i++) {
        const panel = document.getElementById('panel'+i);
        const step = document.getElementById('step'+i);
        if(!panel) continue;
        panel.classList.toggle('hidden', i!==n);
        step.classList.remove('border-white','border-zinc-800');
        step.classList.toggle('opacity-40', i>n);
        if(i<n) step.classList.add('border-zinc-800');
        if(i===n) step.classList.add('border-white');
    }

    if (n === 2 && typeof saveDraftState === 'function') {
        saveDraftState('active_cover', {
            type: 'cover',
            mode: state.mode,
            audioId: state.audioId,
            songTitle: document.getElementById('songTitle').value,
            songStyle: document.getElementById('songStyle').value,
            songLyrics: document.getElementById('songLyrics').value,
            weirdness: state.weirdness,
            styleInfluence: state.styleInfluence
        });
    }
}
function setMode(mode) {
    state.mode = mode;
    const coverBtn = document.getElementById('modeCoverBtn');
    const textBtn = document.getElementById('modeTextToSongBtn');
    const coverSection = document.getElementById('modeCoverSection');
    const textSection = document.getElementById('modeTextSection');
    
    if (coverBtn && textBtn && coverSection && textSection) {
        if (mode === 'text-to-song') {
            coverBtn.className = 'flex-1 py-2 text-xs font-bold text-zinc-500 hover:text-white rounded-lg transition-all duration-300';
            coverBtn.classList.remove('tab-active');
            textBtn.className = 'flex-1 py-2 text-xs font-black rounded-lg tab-active transition-all duration-300';
            
            coverSection.classList.add('hidden');
            textSection.classList.remove('hidden');
        } else {
            textBtn.className = 'flex-1 py-2 text-xs font-bold text-zinc-500 hover:text-white rounded-lg transition-all duration-300';
            textBtn.classList.remove('tab-active');
            coverBtn.className = 'flex-1 py-2 text-xs font-black rounded-lg tab-active transition-all duration-300';
            
            coverSection.classList.remove('hidden');
            textSection.classList.add('hidden');
        }
    }
    
    if (typeof saveDraftState === 'function') {
        saveDraftState('active_cover', { mode: mode });
    }
}
function setStyle(s) { 
    document.getElementById('songStyle').value = s; 
    if(typeof saveDraftState === 'function') {
        saveDraftState('active_cover', { songStyle: s });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    ['songTitle', 'songLyrics', 'songStyle'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => {
            if(typeof saveDraftState === 'function') {
                saveDraftState('active_cover', {
                    type: 'cover',
                    audioId: state.audioId,
                    songTitle: document.getElementById('songTitle').value,
                    songStyle: document.getElementById('songStyle').value,
                    songLyrics: document.getElementById('songLyrics').value
                });
            }
        });
    });
});

/* ===== CONTEXT MENU SYSTEM ===== */
let currentCtxTaskId = null;

function showContextMenu(e, type) {
    e.preventDefault();
    const menu = document.getElementById('contextMenu');
    if(!menu) return;

    const qSec = document.getElementById('ctxQueueSection');
    const uSec = document.getElementById('ctxUploadSection');

    if(qSec) qSec.classList.toggle('hidden', type !== 'queue');
    if(uSec) uSec.classList.toggle('hidden', type !== 'upload');

    menu.classList.remove('hidden');

    let x = e.clientX;
    let y = e.clientY;

    if (x + menu.offsetWidth > window.innerWidth) {
        x = window.innerWidth - menu.offsetWidth - 10;
    }
    if (y + menu.offsetHeight > window.innerHeight) {
        y = window.innerHeight - menu.offsetHeight - 10;
    }

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const closeMenu = (evt) => {
        menu.classList.add('hidden');
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu);
    };

    setTimeout(() => {
        document.addEventListener('click', closeMenu);
        document.addEventListener('contextmenu', closeMenu);
    }, 10);
}

async function loadAppSettings() {
    try {
        const resp = await fetch('/api/settings');
        const settings = await resp.json();
        
        if (settings.weirdness !== undefined) {
            state.weirdness = parseFloat(settings.weirdness);
            const wInput = document.getElementById('songWeirdness');
            if (wInput) wInput.value = state.weirdness;
            const wVal = document.getElementById('weirdnessVal');
            if (wVal) wVal.textContent = state.weirdness.toFixed(2);
        }
        
        if (settings.style_influence !== undefined) {
            state.styleInfluence = parseFloat(settings.style_influence);
            const sInput = document.getElementById('songStyleInfluence');
            if (sInput) sInput.value = state.styleInfluence;
            const sVal = document.getElementById('styleInfluenceVal');
            if (sVal) sVal.textContent = state.styleInfluence.toFixed(2);
        }
    } catch (e) {
        console.error("[SETTINGS] Failed to load app settings:", e);
    }
}

async function saveAppSettings(weirdness, styleInfluence) {
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                weirdness: weirdness !== undefined ? weirdness : state.weirdness,
                style_influence: styleInfluence !== undefined ? styleInfluence : state.styleInfluence
            })
        });
    } catch (e) {
        console.error("[SETTINGS] Failed to save app settings:", e);
    }
}