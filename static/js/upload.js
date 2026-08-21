function updateRightsUI(r) {
    try {
        const d = r.data.result;
        const pct = Math.round((d.left/d.all)*100);
        document.getElementById('rights-bar').innerHTML = `
            <div class="flex items-center gap-6 flex-wrap">
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-ticket text-zinc-500"></i>
                    <span class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Kalan: <b class="text-white">${d.left}</b> / ${d.all}</span>
                </div>
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-chart-pie text-zinc-500"></i>
                    <span class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Kullanılan: <b class="text-white">${d.used}</b></span>
                </div>
                <div class="flex-1 min-w-[100px] max-w-[200px] bg-zinc-900 border border-zinc-800 rounded-full h-2 overflow-hidden">
                    <div class="bg-white h-full rounded-full transition-all duration-500" style="width:${pct}%"></div>
                </div>
                ${d.is_vip ? '<span class="bg-white text-black text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md shadow-[0_0_15px_rgba(255,255,255,0.3)]">VIP</span>' : ''}
            </div>
        `;
    } catch(e) {
        document.getElementById('rights-bar').innerHTML = '<span class="text-red-400 font-bold text-[10px] uppercase tracking-widest"><i class="fa-solid fa-triangle-exclamation mr-2"></i>Hak bilgisi alınamadı</span>';
    }
}

async function loadRights() {
    try {
        const r = await fetch('/api/rights').then(r=>r.json());
        updateRightsUI(r);
    } catch(e) {
        document.getElementById('rights-bar').innerHTML = '<span class="text-red-400 font-bold text-[10px] uppercase tracking-widest"><i class="fa-solid fa-triangle-exclamation mr-2"></i>Hak bilgisi alınamadı</span>';
    }
}

function setupDropzone() {
    const dz = document.getElementById('dropzone');
    const fi = document.getElementById('fileInput');
    if(!dz || !fi) return;

    dz.onclick = () => fi.click();
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('border-white','bg-zinc-900/50'); };
    dz.ondragleave = () => { dz.classList.remove('border-white','bg-zinc-900/50'); };
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('border-white','bg-zinc-900/50'); if(e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]); };
    fi.onchange = () => { if(fi.files.length) uploadFile(fi.files[0]); };

    // Use addEventListener to prevent conflicts
    dz.addEventListener('contextmenu', (e) => {
        if (!state.audioId) return; 
        if(typeof showContextMenu === 'function') {
            showContextMenu(e, 'upload');
        }
    });
}

function listenToUpload() {
    if(!state.audioId && !state.audioUrl && !state.localAudioUrl) return;
    if(typeof playSong === 'function') {
        const url = state.localAudioUrl || state.audioUrl || ('/api/download/' + state.audioId);
        playSong(url, state.title || 'Yüklenen Şarkı');
    }
}

function clearUploadedFile() {
    state.audioId = null;
    state.title = '';
    state.lyrics = '';
    
    const status = document.getElementById('uploadStatus');
    const label = document.getElementById('fileLabel');
    const fi = document.getElementById('fileInput');

    if(status) status.classList.add('hidden');
    if(label) label.innerHTML = `
        <div class="w-12 h-12 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-center mx-auto mb-4 group-hover:border-zinc-700 transition-colors">
            <i class="fa-solid fa-upload text-zinc-500 group-hover:text-zinc-300"></i>
        </div>
        <div class="text-sm font-medium mb-1">Dosyayı buraya bırakın</div>
        <div class="text-zinc-500 text-xs">veya tıklayarak seçin</div>
    `;
    if(fi) fi.value = '';
}

async function uploadFile(file) {
    const status = document.getElementById('uploadStatus');
    const progress = document.getElementById('uploadProgress');
    const text = document.getElementById('uploadText');
    const percent = null; // Removed percentage text display
    const label = document.getElementById('fileLabel');

    if(status) status.classList.remove('hidden');
    console.log("[UPLOAD] Starting upload for:", file.name);

    if(label) label.innerHTML = `
        <div class="w-16 h-16 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl">
            <i class="fa-solid fa-file-audio text-2xl text-white"></i>
        </div>
        <div class="text-white font-bold tracking-tight mb-2">${file.name}</div>
        <div class="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">${(file.size/1024/1024).toFixed(1)} MB</div>
    `;
    
    if(text) text.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-zinc-500 mr-2"></i><span class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Yükleme başlıyor...</span>';
    
    // Force immediate UI update by removing transition temporarily
    if(progress) {
        progress.style.transition = 'none';
        progress.style.width = '5%';
        progress.offsetHeight; // trigger reflow
    }
    if(percent) {} // Removed percentage update

    // Save local URL so we can play it instantly without waiting for server
    if(state.localAudioUrl) URL.revokeObjectURL(state.localAudioUrl);
    state.localAudioUrl = URL.createObjectURL(file);
    state.title = file.name.replace(/\.[^/.]+$/, ""); // Set title from filename without extension

    const formData = new FormData();
    formData.append('audio', file);
    const bypassCover = document.getElementById('bypassCoverFilter');
    if (bypassCover && bypassCover.checked) {
        formData.append('bypass_filter', 'true');
        const bypassLyrics = document.getElementById('bypassFilter');
        if (bypassLyrics) bypassLyrics.checked = true;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const p = Math.round((e.loaded / e.total) * 100);
            const displayPercent = 5 + Math.round(p * 0.4);
            if(progress) progress.style.width = displayPercent + '%';
            if(percent) {} // Removed percentage update
            console.log("[UPLOAD] Progress:", displayPercent + "%");
            
            if (p >= 100 && text) {
                text.innerHTML = '<i class="fa-solid fa-cloud-arrow-up fa-bounce text-zinc-400 mr-2"></i><span class="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Sunucuya aktarılıyor...</span>';
            }
        }
    };

    xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
            try {
                const data = JSON.parse(xhr.responseText);
                if(data.data && data.data.song_ids) {
                    if(progress) progress.style.width = '50%';
                    if(percent) {} // Removed percentage update
                    if(text) text.innerHTML = '<i class="fa-solid fa-cog fa-spin text-zinc-500 mr-2"></i><span class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">İşleniyor...</span>';
                    const songId = data.data.song_ids[0];
                    state.audioId = songId;
                    await pollForLyrics(songId, progress, text, percent, file.name);
                } else {
                    if(text) text.innerHTML = '<i class="fa-solid fa-xmark mr-1 text-red-500"></i><span class="text-[10px] font-bold uppercase tracking-widest text-red-500">Hata: Sunucu dosyayı reddetti</span>';
                    if (typeof showNotification === 'function') showNotification('Yükleme Başarısız', `${file.name} yüklenirken sunucu reddetti.`, 'error');
                }
            } catch(e) {
                if(text) text.innerHTML = '<i class="fa-solid fa-xmark mr-1 text-red-500"></i><span class="text-[10px] font-bold uppercase tracking-widest text-red-500">Hata: Yanıt işlenemedi</span>';
                if (typeof showNotification === 'function') showNotification('Yükleme Başarısız', `${file.name} yüklenirken yanıt işlenemedi.`, 'error');
            }
        } else {
            if(text) text.innerHTML = `<i class="fa-solid fa-xmark mr-1 text-red-500"></i><span class="text-[10px] font-bold uppercase tracking-widest text-red-500">Hata: ${xhr.status}</span>`;
            if (typeof showNotification === 'function') showNotification('Yükleme Başarısız', `${file.name} yüklenemedi (Hata Kodu: ${xhr.status}).`, 'error');
        }
    };

    xhr.onerror = () => {
        if(text) text.innerHTML = '<i class="fa-solid fa-xmark mr-1 text-red-500"></i><span class="text-[10px] font-bold uppercase tracking-widest text-red-500">Ağ Hatası</span>';
        if (typeof showNotification === 'function') showNotification('Yükleme Başarısız', `${file.name} yüklenirken ağ hatası oluştu.`, 'error');
    };

    xhr.send(formData);
}

async function pollForLyrics(songId, progress, text, percent, fileName = 'Dosya') {
    // If elements are not passed (common when called from queue.js for YouTube), find them manually
    if (!progress) progress = document.getElementById('uploadProgress');
    if (!text) text = document.getElementById('uploadText');
    if (!percent) percent = document.getElementById('uploadPercent');

    let elapsed = 0;
    let emptyRetries = 0;
    const MAX_EMPTY_RETRIES = 6;
    
    if (progress) progress.style.transition = 'width 0.5s ease-in-out';

    while(elapsed < 120000) {
        try {
            const resp = await fetch(`/api/task/${songId}`);
            const data = await resp.json();
            const song = data.data.result[0];
            if(song.audio_url && song.status === 0) {
                const lyricsRaw = (song.lyrics || song.lyric || '').trim();
                const styleRaw  = (song.style || '').trim();

                if(!lyricsRaw && !styleRaw && emptyRetries < MAX_EMPTY_RETRIES) {
                    emptyRetries++;
                    const remaining = MAX_EMPTY_RETRIES - emptyRetries;
                    if(text) text.innerHTML = `<i class="fa-solid fa-cog fa-spin mr-1"></i>Sözler bekleniyor... (${remaining} deneme kaldı)`;
                    await sleep(5000);
                    elapsed += 5000;
                    continue;
                }

                if(progress) progress.style.width = '100%';
                if(percent) {} // Removed percentage update
                if(text) text.innerHTML = '<i class="fa-solid fa-check mr-1 text-white"></i><span class="text-[10px] font-bold uppercase tracking-widest text-white">Tamamlandı!</span>';
                if(!state.title) state.title = song.title || 'Cover';
                state.lyrics  = lyricsRaw.replace(/\r\n/g, '\n');
                state.audioId = song.song_id || songId;
                state.audioUrl = song.audio_url;
                
                const titleInput = document.getElementById('songTitle');
                const lyricsInput = document.getElementById('songLyrics');
                const styleInput = document.getElementById('songStyle');
                
                if(titleInput) titleInput.value  = state.title;
                if(lyricsInput) lyricsInput.value = state.lyrics;
                if(styleRaw && styleInput) {
                    styleInput.value = styleRaw;
                    state.style = styleRaw;
                }
                setTimeout(()=>goToStep(2), 500);
                return;
            } else if(song.status === 3) {
                if(progress) {
                    progress.style.width = '100%';
                    progress.className = "bg-red-500 h-full rounded-full transition-all duration-500";
                }
                if(percent) {} // Removed percentage update
                if(text) text.innerHTML = '<i class="fa-solid fa-xmark mr-1 text-red-500"></i><span class="text-[10px] font-bold uppercase tracking-widest text-red-500">Başarısız</span>';
                if (typeof showNotification === 'function') showNotification('İşlem Başarısız', `${fileName} dosyası işlenirken hata oluştu veya reddedildi.`, 'error');
                return;
            } else {
                const p = Math.min(50 + (elapsed/120000)*45, 95);
                if(progress) progress.style.width = p+'%';
                if(percent) {} // Removed percentage update
                if(text) text.innerHTML = `<i class="fa-solid fa-cog fa-spin text-zinc-500 mr-2"></i><span class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">İşleniyor...</span>`;
            }
        } catch(e) {}
        await sleep(5000);
        elapsed += 5000;
    }
    if(text) text.innerHTML = '<i class="fa-solid fa-clock mr-1 text-yellow-400"></i>Zaman aşımı';
    if (typeof showNotification === 'function') showNotification('Zaman Aşımı', `${fileName} dosyasının işlenmesi beklenenden çok uzun sürdü.`, 'error');
}