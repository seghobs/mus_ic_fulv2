async function featureRequest(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'İşlem tamamlanamadı.');
    return data;
}

async function optimizeMusicStyle(button) {
    const input = document.getElementById('songStyle');
    const panel = document.getElementById('styleSuggestion');
    const output = document.getElementById('suggestedStyle');
    if (!input.value.trim()) { input.focus(); return; }
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'İyileştiriliyor…';
    panel.classList.add('hidden');
    try {
        const data = await featureRequest('/api/features/style-optimize', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: input.value })
        });
        output.value = data.style;
        panel.classList.remove('hidden');
    } catch (error) {
        showNotification('Stil iyileştirilemedi', error.message, 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Stili iyileştir';
        if (typeof loadRights === 'function') loadRights();
    }
}

function applySuggestedStyle() {
    const input = document.getElementById('songStyle');
    const value = document.getElementById('suggestedStyle').value;
    if (Array.from(value).length > 800) {
        showNotification('Stili kısalt', 'Öneriyi 800 karaktere indirip tekrar uygula.', 'error');
        return;
    }
    input.value = value;
    state.style = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('styleSuggestion').classList.add('hidden');
}

async function prepareWav(songId, button) {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'WAV hazırlanıyor…';
    try {
        const data = await featureRequest('/api/features/wav/' + encodeURIComponent(songId), { method: 'POST' });
        const link = document.createElement('a');
        link.href = data.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = button.className;
        link.textContent = 'WAV indir';
        button.replaceWith(link);
    } catch (error) {
        button.disabled = false;
        button.textContent = 'WAV';
        showNotification('WAV hazırlanamadı', error.message, 'error');
    } finally {
        if (typeof loadRights === 'function') loadRights();
    }
}

let recordPage = 1;
let recordRequest = 0;
function openAccountRecords() {
    document.getElementById('accountRecords').showModal();
    loadAccountRecords(1);
}

async function loadAccountRecords(page) {
    const version = ++recordRequest;
    const kind = document.getElementById('recordKind').value;
    const container = document.getElementById('recordItems');
    const prev = document.getElementById('recordsPrev');
    const next = document.getElementById('recordsNext');
    prev.disabled = next.disabled = true;
    container.innerHTML = '<div class="feature-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>Kayıtların getiriliyor…</p></div>';
    try {
        const data = await featureRequest(`/api/features/lists/${kind}?page=${page}`);
        if (version !== recordRequest) return;
        recordPage = data.page;
        document.getElementById('recordPageLabel').textContent = 'Sayfa ' + recordPage;
        container.replaceChildren();
        if (!data.items.length) container.innerHTML = '<div class="feature-empty"><i class="fa-regular fa-folder-open"></i><h4>Henüz bir kayıt yok</h4><p>Bu listedeki hareketler burada görünecek.</p></div>';
        const labels = {created_at_unix:'Tarih',scene_description:'İşlem',title:'Başlık',name:'Ad',description:'Açıklama',content:'İçerik',message:'Mesaj',
            created_at:'Tarih',create_time:'Tarih',updated_at:'Güncelleme',date:'Tarih',time:'Tarih',
            credits:'Kredi',credit:'Kredi',amount:'Miktar',consume:'Harcama',cost:'Maliyet',balance:'Bakiye',
            scene:'İşlem',scene_type:'İşlem türü',type:'Tür',status:'Durum',song_count:'Şarkı sayısı',
            count:'Adet',song_title:'Şarkı',remark:'Açıklama',reason:'Açıklama',change:'Değişim',points:'Puan',used:'Kullanılan'};
        for (const item of data.items) {
            const card = document.createElement('div');
            card.className = 'record-card';
            for (const [key, value] of Object.entries(item)) {
                if (!labels[key] || value === '') continue;
                if (key === 'scene_type' && item.scene_description) continue;
                const line = document.createElement('p');
                let display = key === 'created_at_unix' ? new Date(Number(value) * 1000).toLocaleString('tr-TR') : value;
                if (key === 'scene_description' && value === '歌曲生成·创建（V3.0）') display = 'Şarkı oluşturma (V3.0)';
                line.className = 'record-line';
                const label = document.createElement('span');
                label.className = 'record-label';
                label.textContent = labels[key];
                const content = document.createElement('span');
                content.className = 'record-value';
                content.textContent = display;
                if (['credits', 'credit', 'amount', 'consume', 'cost'].includes(key)) {
                    content.classList.add('record-amount');
                    content.textContent = `${display} kredi`;
                }
                line.appendChild(label);
                line.appendChild(content);
                card.appendChild(line);
            }
            if (!card.childElementCount) card.textContent = 'Kayıt ' + (item.id || '');
            container.appendChild(card);
        }
        prev.disabled = recordPage <= 1;
        next.disabled = !data.has_more;
    } catch (error) {
        if (version === recordRequest) container.textContent = error.message;
    }
}

let librarySearchTimer;
function searchMusicLibrary() {
    clearTimeout(librarySearchTimer);
    librarySearchTimer = setTimeout(() => loadAllSongs(), 350);
}
