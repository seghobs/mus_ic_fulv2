/* ===== HOLD-TO-SEEK WITH ACCELERATION ===== */
function fpStartSeek(direction) {
    if(!fpAudio || !fpAudio.duration) return;
    fpStopSeek();
    fpSeekAccel = 0;

    const doSeek = () => {
        if(!fpAudio || !fpAudio.duration) { fpStopSeek(); return; }
        fpSeekAccel = Math.min(fpSeekAccel + 1, 30);
        // Acceleration: 1s base, grows by 0.5s per tick, max 16s per tick
        const step = 1 + Math.floor(fpSeekAccel * 0.5);
        const amount = direction * step;
        fpAudio.currentTime = Math.max(0, Math.min(fpAudio.currentTime + amount, fpAudio.duration));

        // Visual feedback
        const indicator = document.getElementById('fpSeekIndicator');
        const sign = direction > 0 ? '+' : '';
        indicator.textContent = sign + step + 's';
        indicator.classList.add('visible');

        // Update bar immediately
        document.getElementById('fpBar').style.width = (fpAudio.currentTime / fpAudio.duration * 100) + '%';
        document.getElementById('fpCur').textContent = formatTime(fpAudio.currentTime);
    };

    doSeek(); // Immediate first seek
    fpSeekTimer = setInterval(doSeek, 200);
}

function fpStopSeek() {
    if(fpSeekTimer) {
        clearInterval(fpSeekTimer);
        fpSeekTimer = null;
    }
    fpSeekAccel = 0;
    const indicator = document.getElementById('fpSeekIndicator');
    if(indicator) indicator.classList.remove('visible');
}

/* ===== PROGRESS BAR DRAG / TAP ===== */
function fpGetBarPct(e) {
    const wrap = document.getElementById('fpBarWrap');
    const rect = wrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
}

function fpBarDown(e) {
    if(!fpAudio || !fpAudio.duration) return;
    e.preventDefault();
    fpBarDragging = true;
    const wrap = document.getElementById('fpBarWrap');
    wrap.classList.add('dragging');
    const pct = fpGetBarPct(e);
    fpAudio.currentTime = pct * fpAudio.duration;
    document.getElementById('fpBar').style.width = (pct * 100) + '%';
    document.getElementById('fpCur').textContent = formatTime(fpAudio.currentTime);
}

function fpBarMove(e) {
    if(!fpBarDragging || !fpAudio || !fpAudio.duration) return;
    e.preventDefault();
    const pct = fpGetBarPct(e);
    fpAudio.currentTime = pct * fpAudio.duration;
    document.getElementById('fpBar').style.width = (pct * 100) + '%';
    document.getElementById('fpCur').textContent = formatTime(fpAudio.currentTime);
}

function fpBarUp(e) {
    if(!fpBarDragging) return;
    fpBarDragging = false;
    const wrap = document.getElementById('fpBarWrap');
    wrap.classList.remove('dragging');
}

/* ===== VOLUME ===== */
function fpVolume(val) {
    localStorage.setItem('global_volume', val);
    if(fpAudio) fpAudio.volume = val;
    const icon = document.getElementById('fpVolIcon');
    if (icon) {
        if(val == 0) icon.className = 'fa-solid fa-volume-xmark fp-vol-icon';
        else if(val < 0.5) icon.className = 'fa-solid fa-volume-low fp-vol-icon';
        else icon.className = 'fa-solid fa-volume-high fp-vol-icon';
    }
}

function fpMute() {
    if(!fpAudio) return;
    const slider = document.getElementById('fpVolSlider');
    if(fpAudio.volume > 0) {
        fpAudio._prevVol = fpAudio.volume;
        fpAudio.volume = 0;
        slider.value = 0;
    } else {
        fpAudio.volume = fpAudio._prevVol || 1;
        slider.value = fpAudio.volume;
    }
    fpVolume(fpAudio.volume);
}

function fpClose() {
    fpStopSeek();
    if(fpAudio) { fpAudio.pause(); fpAudio.src = ''; fpAudio = null; }
    fpBound = false;
    fpBarDragging = false;
    document.getElementById('footerPlayer').classList.remove('active');
    document.body.classList.remove('footer-open');
    document.getElementById('fpArt').classList.remove('playing');
    
    try { localStorage.removeItem('fp_state'); } catch(e) {}
    
    if (typeof resetLibraryPlayButtons === 'function') {
        resetLibraryPlayButtons();
    }
}

function stopYtPlayer() { fpClose(); }

// --- Player Core ---
function playSong(src, title, coverUrl = null) {
    if(fpAudio) { fpAudio.pause(); fpAudio.src = ''; }
    fpAudio = new Audio();
    fpAudio.preload = 'auto';
    fpAudio.src = src;
    fpAudio.coverUrl = coverUrl;
    fpCurrentId = src;
    
    // Ses düzeyini localStorage'dan yükle
    let savedVol = localStorage.getItem('global_volume');
    if (savedVol !== null) {
        fpAudio.volume = parseFloat(savedVol);
        const slider = document.getElementById('fpVolSlider');
        if(slider) slider.value = savedVol;
        
        const icon = document.getElementById('fpVolIcon');
        if(icon) {
            if(savedVol == 0) icon.className = 'fa-solid fa-volume-xmark fp-vol-icon';
            else if(savedVol < 0.5) icon.className = 'fa-solid fa-volume-low fp-vol-icon';
            else icon.className = 'fa-solid fa-volume-high fp-vol-icon';
        }
    }

    const titleEl = document.getElementById('fpTitle');
    if(titleEl) titleEl.textContent = title || 'Şarkı';
    const barEl = document.getElementById('fpBar');
    if(barEl) barEl.style.width = '0%';
    const curEl = document.getElementById('fpCur');
    if(curEl) curEl.textContent = '0:00';
    const durEl = document.getElementById('fpDur');
    if(durEl) durEl.textContent = '0:00';
    const iconEl = document.getElementById('fpPlayIcon');
    if(iconEl) iconEl.className = 'fa-solid fa-spinner fa-spin';
    
    const artEl = document.getElementById('fpArt');
    if (artEl) {
        artEl.classList.remove('playing');
        if (coverUrl) {
            artEl.style.backgroundImage = `url(${coverUrl})`;
            artEl.style.backgroundSize = 'cover';
            artEl.style.backgroundPosition = 'center';
            artEl.innerHTML = '';
        } else {
            artEl.style.backgroundImage = 'none';
            artEl.innerHTML = '<i class="fa-solid fa-music"></i>';
        }
    }
    document.getElementById('footerPlayer')?.classList.add('active');
    document.body.classList.add('footer-open');

    fpBind();

    fpAudio.addEventListener('canplay', function() {
        if(!fpAudio._started) {
            fpAudio._started = true;
            fpAudio.play().catch(() => {
                if(iconEl) iconEl.className = 'fa-solid fa-play';
            });
        }
    }, {once: true});
    fpAudio.load();
}

function playYtVideo(videoId, title) {
    playSong('/api/yt-play/' + videoId, title, `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
}

function playLocalSong(songId, title) {
    const song = typeof knownSongs !== 'undefined' ? knownSongs[songId] : null;
    const coverUrl = song ? song.cover_url : null;
    playSong('/api/download/' + songId, title, coverUrl);
}

function savePlayerState() {
    if (!fpAudio) return;
    try {
        localStorage.setItem('fp_state', JSON.stringify({
            src: fpAudio.src,
            currentId: fpCurrentId,
            title: document.getElementById('fpTitle')?.textContent || '',
            coverUrl: fpAudio.coverUrl || '',
            currentTime: fpAudio.currentTime,
            paused: fpAudio.paused,
            timestamp: Date.now()
        }));
    } catch(e) {}
}

function fpBind() {
    if(!fpAudio) return;
    const bar = document.getElementById('fpBar');
    const cur = document.getElementById('fpCur');
    const dur = document.getElementById('fpDur');
    const icon = document.getElementById('fpPlayIcon');
    const art = document.getElementById('fpArt');

    fpAudio.ontimeupdate = () => {
        if(!fpAudio) return;
        if(fpAudio.duration && !fpBarDragging) {
            if(bar) bar.style.width = (fpAudio.currentTime / fpAudio.duration * 100) + '%';
            if(cur) cur.textContent = formatTime(fpAudio.currentTime);
        }
        savePlayerState();
    };
    fpAudio.onloadedmetadata = () => {
        if(dur) dur.textContent = formatTime(fpAudio.duration);
    };
    fpAudio.onplay = () => {
        if(icon) icon.className = 'fa-solid fa-pause';
        if(art) art.classList.add('playing');
        savePlayerState();
        if(typeof syncLibraryPlayButtons === 'function') syncLibraryPlayButtons();
    };
    fpAudio.onpause = () => {
        if(icon) icon.className = 'fa-solid fa-play';
        if(art) art.classList.remove('playing');
        savePlayerState();
        if(typeof syncLibraryPlayButtons === 'function') syncLibraryPlayButtons();
    };
    fpAudio.onended = () => {
        if(icon) icon.className = 'fa-solid fa-play';
        if(art) art.classList.remove('playing');
        if(bar) bar.style.width = '0%';
        if(cur) cur.textContent = '0:00';
        
        try { localStorage.removeItem('fp_state'); } catch(e) {}
        
        if(typeof syncLibraryPlayButtons === 'function') syncLibraryPlayButtons();
        if (typeof playNextLibrarySong === 'function') {
            playNextLibrarySong();
        }
    };
}

function fpToggle() {
    if(!fpAudio) return;
    if(fpAudio.paused) {
        fpAudio.play().catch(e => console.warn('Oynatma hatası:', e));
    } else {
        fpAudio.pause();
    }
}

function createPlayer(id, src, theme) {
    const cls = theme === 'dark' ? 'cp-wrap dark' : 'cp-wrap';
    let savedVol = localStorage.getItem('global_volume');
    if(savedVol === null) savedVol = 1;
    
    let iconCls = 'fa-solid fa-volume-high';
    if(savedVol == 0) iconCls = 'fa-solid fa-volume-xmark';
    else if(savedVol < 0.5) iconCls = 'fa-solid fa-volume-low';

    return `
        <div class="${cls}" id="cp-${id}">
            <button class="cp-btn" onclick="cpToggle('${id}')">
                <i class="fa-solid fa-play" id="cp-icon-${id}"></i>
            </button>
            <div class="cp-info">
                <div class="cp-progress-wrap" onclick="cpSeek(event,'${id}')" id="cp-pw-${id}">
                    <div class="cp-progress-bar" id="cp-bar-${id}" style="width:0%"></div>
                </div>
                <div class="cp-time">
                    <span id="cp-cur-${id}">0:00</span>
                    <span id="cp-dur-${id}">0:00</span>
                </div>
            </div>
            <div class="cp-vol">
                <i class="${iconCls} cp-vol-icon" id="cp-volicon-${id}" onclick="cpMute('${id}')"></i>
                <input type="range" class="cp-vol-slider" min="0" max="1" step="0.05" value="${savedVol}" oninput="cpVolume('${id}',this.value)">
            </div>
            <audio id="cp-audio-${id}" src="${src}" preload="none"></audio>
        </div>
    `;
}

function cpBind(id) {
    const audio = document.getElementById('cp-audio-'+id);
    if(!audio || audio._cpBound) return;
    audio._cpBound = true;
    
    let savedVol = localStorage.getItem('global_volume');
    if(savedVol !== null) audio.volume = parseFloat(savedVol);
    
    const bar = document.getElementById('cp-bar-'+id);
    const cur = document.getElementById('cp-cur-'+id);
    const dur = document.getElementById('cp-dur-'+id);
    const icon = document.getElementById('cp-icon-'+id);

    audio.addEventListener('timeupdate', () => {
        if(audio.duration) {
            bar.style.width = (audio.currentTime/audio.duration*100)+'%';
            cur.textContent = formatTime(audio.currentTime);
        }
    });
    audio.addEventListener('loadedmetadata', () => {
        dur.textContent = formatTime(audio.duration);
    });
    audio.addEventListener('play', () => { icon.className = 'fa-solid fa-pause'; });
    audio.addEventListener('pause', () => { icon.className = 'fa-solid fa-play'; });
    audio.addEventListener('ended', () => { icon.className = 'fa-solid fa-play'; bar.style.width = '0%'; cur.textContent = '0:00'; });
}

function cpToggle(id) {
    const audio = document.getElementById('cp-audio-'+id);
    if(!audio) return;
    cpBind(id);
    if(audio.paused) {
        document.querySelectorAll('audio[id^="cp-audio-"]').forEach(a => { if(a!==audio && !a.paused) a.pause(); });
        audio.play().catch(e => console.warn('Oynatma hatası:', e));
    } else {
        audio.pause();
    }
}

function cpSeek(e, id) {
    const audio = document.getElementById('cp-audio-'+id);
    if(!audio || !audio.duration) return;
    const wrap = document.getElementById('cp-pw-'+id);
    const rect = wrap.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
}

function cpVolume(id, val) {
    localStorage.setItem('global_volume', val);
    const audio = document.getElementById('cp-audio-'+id);
    if(audio) audio.volume = val;
    const icon = document.getElementById('cp-volicon-'+id);
    if(val == 0) icon.className = 'fa-solid fa-volume-xmark cp-vol-icon';
    else if(val < 0.5) icon.className = 'fa-solid fa-volume-low cp-vol-icon';
    else icon.className = 'fa-solid fa-volume-high cp-vol-icon';
}

function cpMute(id) {
    const audio = document.getElementById('cp-audio-'+id);
    if(!audio) return;
    if(audio.volume > 0) { audio._prevVol = audio.volume; audio.volume = 0; }
    else { audio.volume = audio._prevVol || 1; }
    const slider = document.querySelector('#cp-'+id+' .cp-vol-slider');
    if(slider) slider.value = audio.volume;
    cpVolume(id, audio.volume);
}

function playNextLibrarySong() {
    if (!fpCurrentId) return;
    
    let currentUuid = "";
    if (fpCurrentId.includes("/api/download/")) {
        currentUuid = fpCurrentId.split("/api/download/")[1];
    } else {
        return;
    }
    
    const container = document.getElementById('allSongsContainer');
    if (!container) return;
    
    const cards = Array.from(container.querySelectorAll('.shadcn-card[data-sid]'));
    const currentCard = container.querySelector(`.shadcn-card[data-sid="${currentUuid}"]`);
    if (!currentCard) return;
    
    const currentIndex = cards.indexOf(currentCard);
    if (currentIndex === -1) return;
    
    let nextIndex = currentIndex + 1;
    while (nextIndex < cards.length) {
        const nextCard = cards[nextIndex];
        if (nextCard.dataset.ready === "true") {
            const playBtn = nextCard.querySelector('button[onclick^="togglePlay"]');
            if (playBtn) {
                if (typeof resetLibraryPlayButtons === 'function') {
                    resetLibraryPlayButtons();
                }
                playBtn.click();
                break;
            }
        }
        nextIndex++;
    }
}

function restorePlayerState() {
    try {
        const saved = localStorage.getItem('fp_state');
        if (!saved) return;
        
        const stateObj = JSON.parse(saved);
        if (Date.now() - stateObj.timestamp > 600000) {
            localStorage.removeItem('fp_state');
            return;
        }
        
        if (stateObj.src && stateObj.title) {
            const titleEl = document.getElementById('fpTitle');
            if (titleEl) titleEl.textContent = stateObj.title;
            document.getElementById('footerPlayer')?.classList.add('active');
            document.body.classList.add('footer-open');
            
            fpAudio = new Audio();
            fpAudio.preload = 'auto';
            fpAudio.src = stateObj.src;
            fpAudio.coverUrl = stateObj.coverUrl || '';
            fpCurrentId = stateObj.currentId || stateObj.src;
            
            const artEl = document.getElementById('fpArt');
            if (artEl) {
                if (fpAudio.coverUrl) {
                    artEl.style.backgroundImage = `url(${fpAudio.coverUrl})`;
                    artEl.style.backgroundSize = 'cover';
                    artEl.style.backgroundPosition = 'center';
                    artEl.innerHTML = '';
                } else {
                    artEl.style.backgroundImage = 'none';
                    artEl.innerHTML = '<i class="fa-solid fa-music"></i>';
                }
            }
            
            let savedVol = localStorage.getItem('global_volume');
            if (savedVol !== null) {
                fpAudio.volume = parseFloat(savedVol);
                const slider = document.getElementById('fpVolSlider');
                if(slider) slider.value = savedVol;
            }
            
            fpBind();
            
            fpAudio.addEventListener('loadedmetadata', () => {
                fpAudio.currentTime = stateObj.currentTime;
                const bar = document.getElementById('fpBar');
                const cur = document.getElementById('fpCur');
                const dur = document.getElementById('fpDur');
                if(bar) bar.style.width = (stateObj.currentTime / fpAudio.duration * 100) + '%';
                if(cur) cur.textContent = formatTime(stateObj.currentTime);
                if(dur) dur.textContent = formatTime(fpAudio.duration);
                
                if (!stateObj.paused) {
                    fpAudio.play().then(() => {
                        updateLibraryPlayButtons(fpCurrentId);
                    }).catch(err => {
                        console.log("Autoplay blocked by browser policy. Adding one-time interaction handler to resume.");
                        const icon = document.getElementById('fpPlayIcon');
                        if (icon) icon.className = 'fa-solid fa-play';
                        document.getElementById('fpArt')?.classList.remove('playing');
                        
                        const resumeAudio = () => {
                            if (fpAudio && fpAudio.paused) {
                                fpAudio.play().then(() => {
                                    updateLibraryPlayButtons(fpCurrentId);
                                }).catch(e => console.warn("Failed to resume on click:", e));
                            }
                            document.removeEventListener('click', resumeAudio);
                            document.removeEventListener('keydown', resumeAudio);
                        };
                        document.addEventListener('click', resumeAudio);
                        document.addEventListener('keydown', resumeAudio);
                    });
                } else {
                    const icon = document.getElementById('fpPlayIcon');
                    if (icon) icon.className = 'fa-solid fa-play';
                    document.getElementById('fpArt')?.classList.remove('playing');
                }
            }, {once: true});
            
            fpAudio.load();
        }
    } catch (e) {
        console.warn("Could not restore player state:", e);
    }
}

function updateLibraryPlayButtons(currentId) {
    if (!currentId) return;
    let songUuid = "";
    if (currentId.includes("/api/download/")) {
        songUuid = currentId.split("/api/download/")[1];
    } else {
        return;
    }
    const card = document.querySelector(`.shadcn-card[data-sid="${songUuid}"]`);
    if (card) {
        const btn = card.querySelector('button[onclick^="togglePlay"]');
        if (btn) {
            btn.innerHTML = '<div class="audio-wave text-emerald-400"><span class="bar bar1"></span><span class="bar bar2"></span><span class="bar bar3"></span><span class="bar bar4"></span></div><span class="text-emerald-400 font-semibold">Dinleniyor..</span>';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(restorePlayerState, 500);
});