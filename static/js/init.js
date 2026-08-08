window.addEventListener('load', () => { 
    if(typeof loadAppSettings === 'function') loadAppSettings();
    if(typeof loadActiveTasks === 'function') loadActiveTasks();
    if(typeof loadRights === 'function') loadRights(); 
    if(typeof setupDropzone === 'function') setupDropzone(); 
    if(typeof loadAllSongs === 'function') loadAllSongs(); 
    if(typeof setupImgDrop === 'function') setupImgDrop(); 
    if(typeof initSSE === 'function') initSSE(); 
});