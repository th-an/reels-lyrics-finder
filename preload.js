const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectVideo: () => ipcRenderer.invoke('select-video'),
  startRender: () => ipcRenderer.invoke('start-render'),
  saveFrame: (tempDir, frameIndex, base64Data) => ipcRenderer.invoke('save-frame', tempDir, frameIndex, base64Data),
  finishRender: (videoPath, tempDir, fps, width, height) => ipcRenderer.invoke('finish-render', videoPath, tempDir, fps, width, height),
  saveVideo: (data) => ipcRenderer.invoke('save-video', data)
});
