const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

// Set ffmpeg path to the static binary
ffmpeg.setFfmpegPath(ffmpegStatic);

// Enable M2 Hardware Acceleration & GPU Optimizations
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('enable-webgl-draft-extensions');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // allow loading local video files
    }
  });

  // In production, load the built index.html. In dev, load Vite's server.
  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, 'dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

// Select video file
ipcMain.handle('select-video', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'avi'] }]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('start-render', async () => {
  const tempDir = path.join(app.getPath('temp'), `reels_render_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return { success: true, tempDir };
});

ipcMain.handle('save-frame', async (event, tempDir, frameIndex, base64Data) => {
  try {
    const data = base64Data.replace(/^data:image\/png;base64,/, "");
    const filename = `frame_${String(frameIndex).padStart(5, '0')}.png`;
    const imgPath = path.join(tempDir, filename);
    fs.writeFileSync(imgPath, data, 'base64');
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('finish-render', async (event, videoPath, tempDir, fps, vWidth, vHeight) => {
  try {
    const outputPath = path.join(app.getPath('temp'), `render_final_${Date.now()}.mp4`);
    
    return new Promise((resolve) => {
      ffmpeg()
        .input(videoPath)
        .input(path.join(tempDir, 'frame_%05d.png'))
        .inputOptions([
          `-framerate ${fps}`
        ])
        .complexFilter([
          `[1:v]scale=${vWidth}:${vHeight}:flags=lanczos[ov]`,
          '[0:v][ov]overlay=0:0'
        ])
        .outputOptions([
          '-c:v libx264',
          '-crf 14',       // Visually lossless quality
          '-preset slow',  // Better compression efficiency
          '-pix_fmt yuv420p', // Maximum compatibility
          '-c:a copy' 
        ])
        .output(outputPath)
        .on('end', () => {
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(e) {}
          resolve({ success: true, path: outputPath });
        })
        .on('error', (err) => {
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(e) {}
          resolve({ success: false, error: err.message });
        })
        .run();
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Save exported video to user-selected location
ipcMain.handle('save-video', async (event, { tempPath }) => {
  try {
    const saveResult = await dialog.showSaveDialog({
      title: 'Save Rendered Video',
      defaultPath: path.join(app.getPath('videos'), 'reels_lyrics_synced.mp4'),
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, error: 'Save canceled' };
    }

    fs.copyFileSync(tempPath, saveResult.filePath);
    return { success: true, path: saveResult.filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
