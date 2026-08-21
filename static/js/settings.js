function openSettings() {
    const modal = document.getElementById('settingsModal');
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
    
    loadTokens();
    loadAllAccountsList();
    if(!window.botPollInterval) window.botPollInterval = setInterval(pollBotStatus, 2000);
}

function closeSettings() { 
    const modal = document.getElementById('settingsModal');
    const card = modal.querySelector('.modal-card');
    
    modal.style.opacity = '0';
    if(card) {
        card.style.transform = 'scale(0.95) translateY(10px)';
        card.style.opacity = '0';
    }
    
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);

    if(window.botPollInterval) {
        clearInterval(window.botPollInterval);
        window.botPollInterval = null;
    }
    if(typeof browserPollInterval !== 'undefined' && browserPollInterval) {
        clearInterval(browserPollInterval);
        browserPollInterval = null;
    }
    if(window.bulkRefreshInterval) {
        clearInterval(window.bulkRefreshInterval);
        window.bulkRefreshInterval = null;
    }
}

function switchTab(tabName) {
    const tabs = ['Tokens', 'Accounts', 'Bot', 'Analysis'];
    
    tabs.forEach(t => {
        const view = document.getElementById('view' + t);
        if (view) view.classList.add('hidden');
        const btn = document.getElementById('tab' + t);
        if (btn) {
            btn.className = 'flex-1 py-2 text-[10px] font-bold bg-[#0c0c14] border border-white/[0.04] text-zinc-500 hover:text-white hover:border-violet-500/20 rounded-lg transition-all duration-300';
            btn.classList.remove('tab-active');
        }
    });

    const activeView = document.getElementById('view' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
    const activeTab = document.getElementById('tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
    
    if (activeView) {
        activeView.classList.remove('hidden');
        activeView.style.opacity = '0';
        activeView.style.transform = 'translateX(10px)';
        activeView.style.transition = 'all 0.3s ease';
        
        setTimeout(() => {
            activeView.style.opacity = '1';
            activeView.style.transform = 'translateX(0)';
        }, 10);
    }
    
    if (activeTab) {
        activeTab.className = 'flex-1 py-2 text-[10px] font-black rounded-lg tab-active transition-all duration-300';
    }

    if (tabName === 'analysis') {
        renderAnalysisTab();
    }
}

let allAccountsData = [];

async function loadAllAccountsList() {
    try {
        const resp = await fetch('/api/accounts/list');
        const data = await resp.json();
        allAccountsData = data.accounts || [];
        applyAccountSort();
    } catch(e) {}
}

function applyAccountSort() {
    const container = document.getElementById('accountsList');
    if (!container) return;
    
    const sortType = document.getElementById('accountsSort') ? document.getElementById('accountsSort').value : 'credits_desc';
    
    let sorted = [...allAccountsData];
    
    if(sortType === 'credits_desc') {
        sorted.sort((a, b) => parseFloat(b.credits || 0) - parseFloat(a.credits || 0));
    } else if(sortType === 'credits_asc') {
        sorted.sort((a, b) => parseFloat(a.credits || 0) - parseFloat(b.credits || 0));
    } else if(sortType === 'spent_desc') {
        sorted.sort((a, b) => parseFloat(b.spent || 0) - parseFloat(a.spent || 0));
    } else if(sortType === 'spent_asc') {
        sorted.sort((a, b) => parseFloat(a.spent || 0) - parseFloat(b.spent || 0));
    } else if(sortType === 'songs_desc') {
        sorted.sort((a, b) => parseInt(b.songs_count || 0) - parseInt(a.songs_count || 0));
    } else if(sortType === 'newest') {
        sorted.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    } else if(sortType === 'oldest') {
        sorted.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    }

    container.innerHTML = '';
    sorted.forEach(a => {
        container.innerHTML += `
            <div ondblclick="manualAccountSwitch('${a.email}', '${a.password}')" class="bg-zinc-900 rounded-lg p-3 border border-zinc-800 flex justify-between items-center cursor-pointer hover:bg-zinc-800 transition group select-none">
                <div>
                    <div class="text-xs font-bold text-white group-hover:text-emerald-400 transition">${a.email}</div>
                    <div class="text-[10px] text-zinc-500 font-mono">${a.password}</div>
                </div>
                <div class="text-right">
                    <div class="text-xs font-black text-emerald-400">${a.credits || 0} Kredi</div>
                    <div class="text-[9px] text-zinc-500 font-bold">${Math.round(a.spent || 0)} Harcanan | ${a.songs_count || 0} Şarkı</div>
                    <div class="text-[9px] text-zinc-600">${a.timestamp || '-'}</div>
                </div>
            </div>
        `;
    });
}

let isSwitching = false;
async function manualAccountSwitch(email, password) {
    if(isSwitching) return;
    
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center';
    overlay.innerHTML = `
        <div class="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-6"></div>
        <div class="text-xl font-black text-white mb-2">Hesap Değiştiriliyor</div>
        <div class="text-sm font-bold text-zinc-400">${email}</div>
        <div class="text-[10px] text-zinc-500 mt-1 uppercase tracking-widest">Lütfen bekleyin, şifre ile yeni token alınıyor...</div>
    `;
    document.body.appendChild(overlay);
    isSwitching = true;
    
    try {
        const r = await fetch('/api/accounts/switch-manual', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({email, password})
        });
        const d = await r.json();
        
        if(d.ok) {
            overlay.innerHTML = `
                <div class="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center mb-6">
                    <i class="fa-solid fa-check text-2xl text-black"></i>
                </div>
                <div class="text-xl font-black text-white mb-2">Geçiş Başarılı!</div>
                <div class="text-sm font-bold text-emerald-400">Güncel Kredi: ${d.credits}</div>
            `;
            setTimeout(() => {
                overlay.remove();
                isSwitching = false;
                loadTokens();
                loadAllAccountsList();
                switchTab('tokens');
                
                // Ana sayfa kredi barini ve sarki listesini animasyonlu guncelle
                if (typeof loadRights === 'function') {
                    const rightsBar = document.getElementById('rights-bar');
                    if(rightsBar) {
                        rightsBar.style.opacity = '0';
                        rightsBar.style.transform = 'translateY(-10px)';
                        rightsBar.style.transition = 'all 0.4s ease';
                        setTimeout(() => {
                            loadRights();
                            rightsBar.style.opacity = '1';
                            rightsBar.style.transform = 'translateY(0)';
                        }, 400);
                    } else {
                        loadRights();
                    }
                }
                
                if (typeof loadAllSongs === 'function') {
                    const songsContainer = document.getElementById('allSongsContainer');
                    if(songsContainer) {
                        songsContainer.style.opacity = '0';
                        songsContainer.style.transition = 'opacity 0.3s ease';
                        setTimeout(() => {
                            loadAllSongs();
                            songsContainer.style.opacity = '1';
                        }, 300);
                    } else {
                        loadAllSongs();
                    }
                }
                
            }, 1500);
        } else {
            overlay.innerHTML = `
                <div class="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mb-6">
                    <i class="fa-solid fa-xmark text-2xl text-white"></i>
                </div>
                <div class="text-xl font-black text-white mb-2">Geçiş Başarısız</div>
                <div class="text-sm font-bold text-red-400">${d.error}</div>
            `;
            setTimeout(() => {
                overlay.remove();
                isSwitching = false;
            }, 2000);
        }
    } catch (e) {
        overlay.remove();
        isSwitching = false;
        alert(e.message);
    }
}

async function startBot() {
    const count = document.getElementById('botCount').value;
    const pwd = document.getElementById('botPassword').value;
    try {
        await fetch('/api/bot/start', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({count, password: pwd})
        });
        document.getElementById('btnStartBot').classList.add('hidden');
        document.getElementById('btnStopBot').classList.remove('hidden');
        document.getElementById('botProgress').classList.remove('hidden');
    } catch(e) { alert(e.message); }
}

async function stopBot() {
    await fetch('/api/bot/stop', {method: 'POST'});
}

async function pollBotStatus() {
    try {
        const r = await fetch('/api/bot/status');
        const d = await r.json();
        
        if(d.is_running) {
            document.getElementById('btnStartBot').classList.add('hidden');
            document.getElementById('btnStopBot').classList.remove('hidden');
            document.getElementById('botProgress').classList.remove('hidden');
            document.getElementById('botParentInfo').classList.remove('hidden');
            document.getElementById('botStatusBadge').className = 'bg-emerald-900/50 text-emerald-400 text-[10px] px-2 py-1 rounded font-bold uppercase';
            document.getElementById('botStatusBadge').innerText = 'Çalışıyor';
            
            if (d.current_parent && d.current_parent !== "UNKNOWN" && d.current_parent !== "") {
                document.getElementById('botParentEmailText').innerText = d.current_parent;
            } else if (d.current_parent === "UNKNOWN") {
                document.getElementById('botParentEmailText').innerText = "Boşta (Ana Hesap)";
            } else {
                document.getElementById('botParentEmailText').innerText = "Aranıyor...";
            }
        } else {
            document.getElementById('btnStartBot').classList.remove('hidden');
            document.getElementById('btnStopBot').classList.add('hidden');
            if (document.getElementById('botParentInfo')) document.getElementById('botParentInfo').classList.add('hidden');
            document.getElementById('botStatusBadge').className = 'bg-zinc-800 text-zinc-400 text-[10px] px-2 py-1 rounded font-bold uppercase';
            document.getElementById('botStatusBadge').innerText = 'Beklemede';
        }

        if(d.total > 0) {
            document.getElementById('botProgressText').innerText = d.success + ' / ' + d.total;
            document.getElementById('botProgressPercent').innerText = d.progress + '%';
            document.getElementById('botProgressBar').style.width = d.progress + '%';
        }

        const cons = document.getElementById('botConsole');
        cons.innerHTML = d.logs.join('<br>');
        cons.scrollTop = cons.scrollHeight;

    } catch(e) {}
}

async function startBrowserToken() {
    try {
        const resp = await fetch('/api/browser-token/start', {method:'POST'});
        const data = await resp.json();
        if(data.error) { alert(data.error); return; }
        document.getElementById('browserTokenSection').querySelector('button').classList.add('hidden');
        document.getElementById('browserTokenWaiting').classList.remove('hidden');
        browserPollInterval = setInterval(pollBrowserToken, 2000);
    } catch(e) { alert('Hata: ' + e.message); }
}
async function pollBrowserToken() {
    try {
        const resp = await fetch('/api/browser-token/status');
        const data = await resp.json();
        if(data.status === 'done' && data.token) {
            clearInterval(browserPollInterval);
            browserPollInterval = null;
            document.getElementById('browserTokenWaiting').classList.add('hidden');
            document.getElementById('browserTokenSection').querySelector('button').classList.remove('hidden');
            loadTokens();
            if(typeof loadRights === 'function') loadRights();
            alert('Token başarıyla eklendi: ' + data.token.name);
        } else if(data.status === 'error') {
            clearInterval(browserPollInterval);
            browserPollInterval = null;
            document.getElementById('browserTokenWaiting').classList.add('hidden');
            document.getElementById('browserTokenSection').querySelector('button').classList.remove('hidden');
            alert('Hata: ' + (data.error || 'Bilinmeyen hata'));
        } else if(data.status === 'cancelled' || data.status === 'idle') {
            clearInterval(browserPollInterval);
            browserPollInterval = null;
            document.getElementById('browserTokenWaiting').classList.add('hidden');
            document.getElementById('browserTokenSection').querySelector('button').classList.remove('hidden');
        }
    } catch(e) {}
}

async function syncDrisionToken() {
    const btn = document.getElementById('drisionSyncBtn');
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<div class="w-full flex items-center justify-center py-2"><i class="fa-solid fa-spinner fa-spin text-emerald-400"></i><span class="ml-3 text-sm font-bold text-emerald-400">Hesap aranıyor ve bağlanılıyor...</span></div>';
    btn.disabled = true;
    try {
        const resp = await fetch('/api/tokens/drision-sync', {method:'POST'});
        const data = await resp.json();
        if(data.error) {
            alert('Hata: ' + data.error);
        } else {
            alert('Yeni hesaba geçildi ve token başarıyla alındı!');
            loadTokens();
            if(typeof loadRights === 'function') loadRights();
        }
    } catch(e) {
        alert('Bağlantı hatası: ' + e.message);
    }
    btn.innerHTML = origHtml;
    btn.disabled = false;
}

async function cancelBrowserToken() {
    await fetch('/api/browser-token/cancel', {method:'POST'});
    if(browserPollInterval) { clearInterval(browserPollInterval); browserPollInterval = null; }
    document.getElementById('browserTokenWaiting').classList.add('hidden');
    document.getElementById('browserTokenSection').querySelector('button').classList.remove('hidden');
}
async function checkBrowserTokenStatus() {
    try {
        const resp = await fetch('/api/browser-token/status');
        const data = await resp.json();
        if(data.status === 'waiting') {
            document.getElementById('browserTokenSection').querySelector('button').classList.add('hidden');
            document.getElementById('browserTokenWaiting').classList.remove('hidden');
            if(!browserPollInterval) browserPollInterval = setInterval(pollBrowserToken, 2000);
        } else {
            document.getElementById('browserTokenWaiting').classList.add('hidden');
            document.getElementById('browserTokenSection').querySelector('button').classList.remove('hidden');
        }
    } catch(e) {}
}

async function loadTokens() {
    const container = document.getElementById('tokenList');
    container.innerHTML = '<div class="flex items-center justify-center py-4"><i class="fa-solid fa-spinner fa-spin text-dark-500"></i></div>';
    try {
        const resp = await fetch('/api/tokens');
        const data = await resp.json();
        if(!data.tokens.length) {
            container.innerHTML = '<div class="text-center py-4 text-dark-500 text-sm">Henüz token eklenmemiş</div>';
            return;
        }
        container.innerHTML = '';
        
        // Aktif olani en uste getirme siralama
        data.tokens.sort((a, b) => (b.active === true ? 1 : 0) - (a.active === true ? 1 : 0));
        
        data.tokens.forEach((t) => {
            const isActive = t.active !== false;
            container.innerHTML += `
                <div class="bg-zinc-900/50 rounded-xl p-4 border ${isActive ? 'border-white shadow-[0_0_15px_rgba(255,255,255,0.05)]' : 'border-zinc-800 opacity-50'} transition">
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 ${isActive ? 'bg-zinc-800 border-zinc-500' : 'bg-zinc-950 border-zinc-700'} border rounded-lg flex items-center justify-center flex-shrink-0">
                            <i class="fa-solid ${isActive ? 'fa-check text-white' : 'fa-pause text-zinc-600'} text-xs"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="text-sm font-bold tracking-tight flex items-center gap-2">
                                ${t.name}
                                ${isActive ? '<span class="bg-white text-black text-[9px] px-1.5 py-0.5 rounded-sm font-bold uppercase tracking-widest">Aktif</span>' : '<span class="bg-zinc-800 text-zinc-500 text-[9px] px-1.5 py-0.5 rounded-sm font-bold uppercase tracking-widest">Pasif</span>'}
                            </div>
                        </div>
                        <div class="flex gap-2 flex-shrink-0">
                            <button onclick="reloginToken(this, '${t.id}', '${t.name}')" class="w-9 h-9 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 flex items-center justify-center transition" title="Yeniden Giriş Yap">
                                <i class="fa-solid fa-right-to-bracket text-xs text-zinc-500 hover:text-white"></i>
                            </button>
                            <button onclick="toggleToken('${t.id}')" class="w-9 h-9 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 flex items-center justify-center transition" title="${isActive ? 'Pasif Yap' : 'Aktif Yap'}">
                                <i class="fa-solid fa-power-off text-xs ${isActive ? 'text-white' : 'text-zinc-600'}"></i>
                            </button>
                            <button onclick="deleteToken('${t.id}')" class="w-9 h-9 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-red-900/20 flex items-center justify-center transition" title="Sil">
                                <i class="fa-solid fa-trash text-xs text-zinc-500 hover:text-red-500"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });
    } catch(e) {
        container.innerHTML = `<div class="text-red-400 text-sm text-center py-4">${e.message}</div>`;
    }
}
async function toggleToken(id) {
    await fetch('/api/tokens/toggle/'+id, {method:'POST'});
    loadTokens();
    if(typeof loadRights === 'function') loadRights();
}
function openEditModal(id) {
    editingTokenId = id;
    fetch('/api/tokens').then(r=>r.json()).then(data=>{
        const t = data.tokens.find(x=>x.id===id);
        if(!t) return;
        document.getElementById('editTokenName').value = t.name;
        document.getElementById('editTokenValue').value = t.token;
        document.getElementById('editTokenModal').classList.remove('hidden');
    });
}
function closeEditModal() {
    editingTokenId = null;
    document.getElementById('editTokenModal').classList.add('hidden');
}
async function saveEditToken() {
    if(!editingTokenId) return;
    const name = document.getElementById('editTokenName').value.trim();
    const token = document.getElementById('editTokenValue').value.trim();
    if(!token) return;
    await fetch('/api/tokens/'+editingTokenId, {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({name, token})
    });
    closeEditModal();
    loadTokens();
    if(typeof loadRights === 'function') loadRights();
}
async function addToken() {
    const name = document.getElementById('newTokenName').value.trim();
    const token = document.getElementById('newTokenValue').value.trim();
    if(!token) return;
    await fetch('/api/tokens', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({name, token})
    });
    document.getElementById('newTokenName').value = '';
    document.getElementById('newTokenValue').value = '';
    loadTokens();
    if(typeof loadRights === 'function') loadRights();
}
async function deleteToken(id) {
    if(!confirm('Bu token silinsin mi?')) return;
    await fetch('/api/tokens/'+id, {method:'DELETE'});
    loadTokens();
    if(typeof loadRights === 'function') loadRights();
}

async function startBulkRefresh() {
    if (window.bulkRefreshInterval) return;
    try {
        const resp = await fetch('/api/accounts/refresh-bulk', { method: 'POST' });
        const data = await resp.json();
        if (data.error) {
            alert(data.error);
            return;
        }
        
        document.getElementById('bulkRefreshProgress').classList.remove('hidden');
        window.bulkRefreshInterval = setInterval(pollBulkRefreshStatus, 2000);
        pollBulkRefreshStatus();
    } catch(e) {
        alert('Hata: ' + e.message);
    }
}

async function pollBulkRefreshStatus() {
    try {
        const resp = await fetch('/api/accounts/refresh-status');
        const data = await resp.json();
        
        if (data.is_running) {
            document.getElementById('bulkRefreshProgress').classList.remove('hidden');
            const progressPercent = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
            document.getElementById('bulkProgressText').textContent = `${data.current} / ${data.total}`;
            document.getElementById('bulkProgressBar').style.width = `${progressPercent}%`;
        } else {
            clearInterval(window.bulkRefreshInterval);
            window.bulkRefreshInterval = null;
            document.getElementById('bulkRefreshProgress').classList.add('hidden');
            loadAllAccountsList();
            if (data.error) {
                alert("Toplu güncelleme hatası: " + data.error);
            }
        }
    } catch(e) {
        // network blip
    }
}

function renderAnalysisTab() {
    const statsContainer = document.getElementById('analysisStats');
    if (!statsContainer) return;

    let totalCredits = 0;
    let totalSpent = 0;
    let totalSongs = 0;
    let totalAccounts = allAccountsData.length;

    allAccountsData.forEach(a => {
        totalCredits += parseFloat(a.credits || 0);
        totalSpent += parseFloat(a.spent || 0);
        totalSongs += parseInt(a.songs_count || 0);
    });

    statsContainer.innerHTML = `
        <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between">
            <span class="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Sistemdeki Toplam Kredi</span>
            <span class="text-xl font-black text-emerald-400 mt-2">${Math.round(totalCredits)} Kredi</span>
        </div>
        <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between">
            <span class="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Harcanan Toplam Kredi</span>
            <span class="text-xl font-black text-amber-500 mt-2">${Math.round(totalSpent)} Kredi</span>
        </div>
        <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between">
            <span class="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Toplam Üretilen Şarkı</span>
            <span class="text-xl font-black text-violet-400 mt-2">${totalSongs} Şarkı</span>
        </div>
        <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between">
            <span class="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Kayıtlı Toplam Hesap</span>
            <span class="text-xl font-black text-white mt-2">${totalAccounts} Hesap</span>
        </div>
    `;

    buildReferralTree();
}

function buildReferralTree() {
    const treeContainer = document.getElementById('referralTree');
    if (!treeContainer) return;

    const groups = {};
    allAccountsData.forEach(a => {
        const parent = a.parent_group || "UNKNOWN";
        if (!groups[parent]) groups[parent] = [];
        groups[parent].push(a);
    });

    function renderNode(inviteCode, depth = 0) {
        const children = groups[inviteCode] || [];
        if (inviteCode !== "UNKNOWN" && children.length === 0) return '';

        let html = '';
        children.forEach(child => {
            const childInvite = child.new_invite_code;
            const childHasChildren = groups[childInvite] && groups[childInvite].length > 0;
            
            const indent = '&nbsp;'.repeat(depth * 4);
            const branchIcon = childHasChildren ? '📂' : '📄';
            
            html += `<div class="py-1 hover:text-white transition-colors">
                <span>${indent}${branchIcon} <strong>${child.email}</strong> (${child.credits} Kr | ${child.songs_count} Şarkı)</span>
            </div>`;
            
            if (childHasChildren) {
                html += renderNode(childInvite, depth + 1);
            }
        });
        return html;
    }

    const treeHtml = renderNode("UNKNOWN", 0);
    treeContainer.innerHTML = treeHtml || '<div class="text-zinc-600 italic">Henüz referans ilişkisi bulunamadı.</div>';
}

async function reloginToken(btn, id, email) {
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs text-violet-400"></i>';
    btn.disabled = true;
    
    try {
        let resp = await fetch('/api/tokens/relogin/' + id, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({})
        });
        let data = await resp.json();
        
        if (data.need_password) {
            const password = prompt(`${email} hesabı sistemde kayıtlı değil veya şifresi bulunamadı. Lütfen şifresini girin:`);
            if (!password) {
                btn.innerHTML = origHtml;
                btn.disabled = false;
                return;
            }
            
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs text-violet-400"></i>';
            btn.disabled = true;
            
            resp = await fetch('/api/tokens/relogin/' + id, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({password})
            });
            data = await resp.json();
        }
        
        if (data.ok) {
            // Processing in background thread. We wait for SSE relogin_success/error.
        } else {
            alert('Hata: ' + (data.error || 'Bilinmeyen bir hata oluştu.'));
            btn.innerHTML = origHtml;
            btn.disabled = false;
        }
    } catch (e) {
        alert('Hata: ' + e.message);
        btn.innerHTML = origHtml;
        btn.disabled = false;
    }
}

function handleReloginSuccess(data) {
    openLoginSuccessModal(data.email, data.credits);
    loadTokens();
    if (typeof loadRights === 'function') loadRights();
    if (typeof loadAllAccountsList === 'function') loadAllAccountsList();
}

function handleReloginError(data) {
    if (typeof showNotification === 'function') {
        showNotification('Oturum Açma Başarısız', `${data.email} için: ${data.error}`, 'error');
    } else {
        alert(`Hata: ${data.error}`);
    }
    loadTokens();
}

function openLoginSuccessModal(email, credits) {
    const modal = document.getElementById('loginSuccessModal');
    const emailEl = document.getElementById('loginSuccessEmail');
    const creditsEl = document.getElementById('loginSuccessCredits');
    if (emailEl) emailEl.innerText = email;
    if (creditsEl) creditsEl.innerText = (credits !== null && credits !== undefined) ? `${credits} Kr` : 'Bilinmiyor';
    if (modal) modal.classList.remove('hidden');
}

function closeLoginSuccessModal() {
    const modal = document.getElementById('loginSuccessModal');
    if (modal) modal.classList.add('hidden');
}