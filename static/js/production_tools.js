let productionAccount = '';
let productionJobs = [];
let productionTimer;
let productionReading = false;
let productionSubmitting = false;
let productionSession = 0;

function productionStorageKey() { return 'musicful-production-' + productionAccount; }
function saveProductionJobs() {
    try { localStorage.setItem(productionStorageKey(), JSON.stringify(productionJobs.slice(-50))); }
    catch (_) { /* Tracking continues in memory if browser storage is unavailable. */ }
}

async function openProductionTools() {
    if (productionSubmitting) return;
    clearTimeout(productionTimer);
    const session = ++productionSession;
    productionAccount = '';
    productionJobs = [];
    document.getElementById('productionTools').showModal();
    document.getElementById('productionSubmit').disabled = true;
    document.getElementById('productionMessage').textContent = 'Hesap hazırlanıyor…';
    document.getElementById('productionLyricsResult').classList.add('hidden');
    renderProductionJobs();
    const select = document.getElementById('productionSong');
    select.replaceChildren();
    for (const song of Object.values(knownSongs)) {
        const option = document.createElement('option');
        option.value = song.song_id;
        option.textContent = song.title || 'Adsız şarkı';
        select.appendChild(option);
    }
    changeProductionKind();
    try {
        const data = await featureRequest('/api/features/production/account');
        if (session !== productionSession) return;
        productionAccount = data.account;
        try {
            const saved = JSON.parse(localStorage.getItem(productionStorageKey()) || '[]');
            productionJobs = Array.isArray(saved) ? saved.filter(j => j && Array.isArray(j.ids) && j.ids.length) : [];
        } catch (_) { productionJobs = []; }
        document.getElementById('productionSubmit').disabled = false;
        document.getElementById('productionMessage').textContent = '';
        selectProductionSong();
        renderProductionJobs();
        refreshProductionJobs();
    } catch (error) { document.getElementById('productionMessage').textContent = error.message; }
}

function changeProductionKind() {
    const kind = document.getElementById('productionKind').value;
    document.querySelectorAll('[data-production-kinds]').forEach(group => {
        const visible = group.dataset.productionKinds.split(' ').includes(kind);
        group.hidden = !visible;
        group.classList.toggle('hidden', !visible);
        group.querySelectorAll('input,textarea,select').forEach(input => input.disabled = !visible);
    });
    document.getElementById('productionLyricsResult').classList.add('hidden');
}

function selectProductionSong() {
    const song = knownSongs[document.getElementById('productionSong').value];
    if (!song) return;
    const form = document.getElementById('productionForm');
    form.elements.title.value = song.title || '';
    form.elements.full_lyrics.value = song.lyrics || song.lyric || '';
    if (['v5.0', 'v5.5'].includes(song.mv)) form.elements.mv.value = song.mv;
    form.elements.end.value = Math.min(30, (song.duration || 30000) / 1000);
}

async function submitProduction(event) {
    event.preventDefault();
    if (productionSubmitting || !productionAccount) return;
    const form = document.getElementById('productionForm');
    const kind = document.getElementById('productionKind').value;
    const jobName = document.getElementById('productionKind').selectedOptions[0].textContent;
    const payload = Object.fromEntries(new FormData(form));
    payload.account = productionAccount;
    payload.instrumental = form.elements.instrumental.checked;
    for (const key of ['bpm', 'start', 'end']) if (key in payload) payload[key] = Number(payload[key]);
    const button = document.getElementById('productionSubmit');
    const message = document.getElementById('productionMessage');
    productionSubmitting = true;
    button.disabled = true;
    message.textContent = kind === 'soundtrack' ? 'Video hazırlanıyor ve müzik isteği gönderiliyor…' : 'İstek gönderiliyor…';
    try {
        const result = await featureRequest('/api/features/production/' + kind, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
        });
        if (result.lyrics) {
            document.getElementById('productionOutput').value = result.lyrics;
            document.getElementById('productionLyricsResult').classList.remove('hidden');
            message.textContent = 'Sözler hazır.';
        } else {
            productionJobs.push({ids: result.song_ids, name: jobName,
                started: Date.now(), state: 'pending'});
            saveProductionJobs();
            renderProductionJobs();
            message.textContent = 'Üretim başladı. Pencereyi kapatsan da görev kaydı korunur.';
            refreshProductionJobs();
        }
    } catch (error) { message.textContent = error.message; }
    finally {
        productionSubmitting = false;
        button.disabled = false;
        if (typeof loadRights === 'function') loadRights();
    }
}

function renderProductionJobs() {
    const container = document.getElementById('productionJobs');
    container.replaceChildren();
    if (!productionJobs.length) container.innerHTML = '<div class="feature-empty"><i class="fa-solid fa-music"></i><h4>Yeni seslere hazır</h4><p>İlk üretimini başlattığında burada takip edebilirsin.</p></div>';
    const labels = {pending: 'İşleniyor', done: 'Tamamlandı — kütüphanede görebilirsin', failed: 'Üretim başarısız'};
    for (const job of [...productionJobs].reverse()) {
        const card = document.createElement('div');
        card.className = 'production-job-card';
        card.dataset.state = job.state;
        const title = document.createElement('h4');
        title.textContent = job.name;
        const status = document.createElement('p');
        status.className = 'production-job-status';
        status.textContent = job.error || labels[job.state] || 'Durumu güncelle';
        const date = document.createElement('time');
        date.textContent = new Date(job.started).toLocaleString('tr-TR');
        card.appendChild(title);
        card.appendChild(status);
        card.appendChild(date);
        container.appendChild(card);
    }
}

function handleProductionReady(signal) {
    if (signal.account !== productionAccount) return;
    for (const job of productionJobs.filter(j => j.state === 'pending')) {
        const signalIds = [signal.song_id, ...(signal.ids || [])].map(String);
        const matches = job.ids.map(String).filter(id => signalIds.includes(id));
        if (!matches.length) continue;
        job.readyIds = [...new Set([...(job.readyIds || []), ...matches])];
        if (job.ids.every(id => job.readyIds.includes(String(id)))) {
            job.state = 'done';
            job.error = '';
        }
    }
    saveProductionJobs();
    renderProductionJobs();
    if (!productionJobs.some(job => job.state === 'pending')) clearTimeout(productionTimer);
}

async function refreshProductionJobs() {
    if (!productionAccount || productionReading) return;
    productionReading = true;
    clearTimeout(productionTimer);
    const session = productionSession;
    try {
        for (const job of productionJobs.filter(j => j.state === 'pending')) {
            try {
                const data = await featureRequest('/api/features/production/results?' + new URLSearchParams({account: productionAccount, ids: job.ids.join(',')}));
                if (session !== productionSession) return;
                if (job.state !== 'pending') continue;
                const rows = job.ids.map(id => data.results.find(r => [String(r.song_id), String(r.id)].includes(String(id))));
                job.error = '';
                if (rows.some(r => r?.status === 3)) job.state = 'failed';
                else if (rows.every(r => r?.ready)) {
                    job.state = 'done';
                    loadAllSongs();
                    if (typeof loadRights === 'function') loadRights();
                } else if (Date.now() - job.started > 900000) job.error = 'Üretim sürüyor olabilir; durumları güncelle';
            } catch (error) { if (job.state === 'pending') job.error = error.message; }
            if (session !== productionSession) return;
            saveProductionJobs();
            renderProductionJobs();
        }
    } finally {
        productionReading = false;
        if (session === productionSession && productionJobs.some(j => j.state === 'pending' && !j.error)) {
            productionTimer = setTimeout(refreshProductionJobs, 4000);
        }
    }
}
