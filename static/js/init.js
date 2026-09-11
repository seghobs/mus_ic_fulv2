window.addEventListener('load', async () => {
    if(typeof loadAppSettings === 'function') loadAppSettings();
    if(typeof setupDropzone === 'function') setupDropzone(); 
    if(typeof setupImgDrop === 'function') setupImgDrop(); 
    const rightsBar = document.getElementById('rights-bar');
    if (rightsBar) rightsBar.textContent = 'Oturum yenileniyor…';
    try {
        const response = await fetch('/api/session/refresh', { method: 'POST' });
        const result = await response.json();
        if (!response.ok || !result.ok) {
            throw new Error(result.error || 'Oturum yenilenemedi.');
        }
    } catch (error) {
        if (rightsBar) rightsBar.textContent = error.message;
        if (typeof showNotification === 'function') {
            showNotification('Oturum yenilenemedi', error.message, 'error');
        }
        return;
    }
    if(typeof initSSE === 'function') initSSE(); 
    if(typeof loadActiveTasks === 'function') loadActiveTasks();
    if(typeof loadRights === 'function') loadRights();
    if(typeof loadAllSongs === 'function') loadAllSongs();
});
