function openAiLyricModal() {
    const modal = document.getElementById('aiLyricsModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    
    const card = modal.querySelector('.modal-card');
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.3s ease';
    if(card) {
        card.style.transform = 'scale(0.95) translateY(10px)';
        card.style.opacity = '0';
        card.style.transition = 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    }
    
    setTimeout(() => {
        modal.style.opacity = '1';
        if(card) {
            card.style.transform = 'scale(1) translateY(0)';
            card.style.opacity = '1';
        }
    }, 10);

    document.getElementById('aiLyricTopic').value = '';
    document.getElementById('aiLyricStyleHint').value = '';
    document.getElementById('aiLyricStatus').classList.add('hidden');
}

function closeAiLyricModal() {
    const modal = document.getElementById('aiLyricsModal');
    if (!modal) return;
    const card = modal.querySelector('.modal-card');
    
    modal.style.opacity = '0';
    if(card) {
        card.style.transform = 'scale(0.95) translateY(10px)';
        card.style.opacity = '0';
    }
    
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

async function generateAiLyrics() {
    const topic = document.getElementById('aiLyricTopic').value.trim();
    const styleHint = document.getElementById('aiLyricStyleHint').value.trim();
    const statusDiv = document.getElementById('aiLyricStatus');
    const statusText = document.getElementById('aiLyricStatusText');
    const generateBtn = document.getElementById('btnGenerateAiLyrics');

    if (!topic) {
        alert("Lütfen bir şarkı konusu veya teması belirtin.");
        return;
    }

    statusDiv.classList.remove('hidden');
    statusDiv.className = "p-3 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center gap-3 text-xs text-zinc-400";
    statusText.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-violet-400 mr-1"></i>Sözler ve stil tasarlanıyor, lütfen bekleyin...';
    generateBtn.disabled = true;
    generateBtn.style.opacity = '0.5';

    try {
        const resp = await fetch('/api/generate-lyrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic: topic, style: styleHint })
        });
        const data = await resp.json();

        if (data.error) {
            throw new Error(data.error);
        }

        const res = data.result || {};
        
        // Update input fields
        if (document.getElementById('songTitle')) document.getElementById('songTitle').value = res.title || '';
        if (document.getElementById('songLyrics')) document.getElementById('songLyrics').value = res.lyrics || '';
        if (document.getElementById('songStyle')) document.getElementById('songStyle').value = res.style || '';

        // Update state
        if (typeof state !== 'undefined') {
            state.title = res.title || '';
            state.lyrics = res.lyrics || '';
            state.style = res.style || '';
            
            // Save draft state if available
            if (typeof saveDraftState === 'function') {
                saveDraftState('active_cover', {
                    title: state.title,
                    lyrics: state.lyrics,
                    style: state.style
                });
            }
        }

        closeAiLyricModal();
        if (typeof showNotification === 'function') {
            showNotification('Başarılı', 'Şarkı sözü ve stil başarıyla oluşturuldu ve yüklendi.', 'success');
        }

    } catch (e) {
        statusDiv.className = "p-3 bg-red-950/20 border border-red-900/50 rounded-lg flex items-center gap-3 text-xs text-red-400";
        statusText.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1"></i>Hata: ${e.message}`;
    } finally {
        generateBtn.disabled = false;
        generateBtn.style.opacity = '1';
    }
}
