import React, { useState, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas';
import pixelmatch from 'pixelmatch';

function App() {
  const [videoSrc, setVideoSrc] = useState(null);
  const [videoPath, setVideoPath] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [lyrics, setLyrics] = useState([]);
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [renderProgress, setRenderProgress] = useState(null);
  const [renderedVideoPath, setRenderedVideoPath] = useState(null);
  const [renderedVideoSrc, setRenderedVideoSrc] = useState(null);

  // Analyzer States
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAnalyzer, setShowAnalyzer] = useState(false);
  const [analyzerData, setAnalyzerData] = useState(null);
  
  // Audio Beat States
  const [beatTimestamps, setBeatTimestamps] = useState([]);
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState(false);

  // Styling States
  const [fontFamily, setFontFamily] = useState('Tamil MN'); 
  const [fontSize, setFontSize] = useState(60);
  const [fontColor, setFontColor] = useState('#ffffff');
  const [highlightColor, setHighlightColor] = useState('#ffff00');
  const [placement, setPlacement] = useState('pos-bottom'); 
  const [animationStyle, setAnimationStyle] = useState('Karaoke Wave');
  const [exportFps, setExportFps] = useState(60);

  // Animation Studio States
  const [waveTarget, setWaveTarget] = useState('Word');
  const [waveAmplitude, setWaveAmplitude] = useState(15);
  const [waveSmoothness, setWaveSmoothness] = useState(0.4);
  
  const videoRef = useRef(null);
  const measureCache = useRef({});

  const handleSelectVideo = async () => {
    if (window.electronAPI) {
      const path = await window.electronAPI.selectVideo();
      if (path) {
        setVideoPath(path);
        setVideoSrc(`local-resource://${path}`); 
        setRenderedVideoPath(null);
        setRenderedVideoSrc(null);
        analyzeAudioBeats(`file://${path}`);
      }
    } else {
      alert("Electron API not available");
    }
  };

  const analyzeAudioBeats = async (url) => {
    setIsAnalyzingAudio(true);
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const windowSize = Math.floor(sampleRate * 0.05); // 50ms
      
      let maxDecibel = -Infinity;
      const energyLevels = [];
      
      for (let i = 0; i < channelData.length; i += windowSize) {
        let sum = 0;
        for (let j = 0; j < windowSize && (i + j) < channelData.length; j++) {
          sum += channelData[i + j] * channelData[i + j];
        }
        const rms = Math.sqrt(sum / windowSize);
        const decibel = 20 * Math.log10(rms || 1e-10);
        energyLevels.push({ time: i / sampleRate, db: decibel });
        if (decibel > maxDecibel) maxDecibel = decibel;
      }
      
      const threshold = maxDecibel - 12; // Top 12dB
      const spikes = [];
      let lastSpikeTime = -1;
      
      for (const level of energyLevels) {
        if (level.db > threshold && (level.time - lastSpikeTime) > 0.3) {
          spikes.push(level.time);
          lastSpikeTime = level.time;
        }
      }
      
      setBeatTimestamps(spikes);
    } catch (e) {
      console.error("Audio analysis failed:", e);
    }
    setIsAnalyzingAudio(false);
  };

  const getGraphemeMeasurements = (word) => {
    const cacheKey = `${word}_${fontFamily}`;
    if (measureCache.current[cacheKey]) return measureCache.current[cacheKey];

    const div = document.createElement('div');
    div.style.fontFamily = fontFamily;
    div.style.fontSize = '100px'; 
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'nowrap';
    div.textContent = word;
    document.body.appendChild(div);

    const segmenter = new Intl.Segmenter('ta', { granularity: 'grapheme' });
    const segments = Array.from(segmenter.segment(word));
    
    const textNode = div.firstChild;
    const range = document.createRange();
    const wordRect = div.getBoundingClientRect();
    const graphemes = [];

    let currentIndex = 0;
    for (const seg of segments) {
      try {
        range.setStart(textNode, currentIndex);
        range.setEnd(textNode, currentIndex + seg.segment.length);
        const rect = range.getBoundingClientRect();
        
        let lPercent = ((rect.left - wordRect.left) / wordRect.width) * 100;
        let rPercent = ((rect.right - wordRect.left) / wordRect.width) * 100;
        
        lPercent = Math.max(0, Math.min(100, lPercent));
        rPercent = Math.max(0, Math.min(100, rPercent));

        graphemes.push({
          text: seg.segment,
          leftPercent: lPercent,
          rightPercent: rPercent,
        });
      } catch (e) {
        graphemes.push({ text: seg.segment, leftPercent: 0, rightPercent: 100 });
      }
      currentIndex += seg.segment.length;
    }

    document.body.removeChild(div);
    measureCache.current[cacheKey] = graphemes;
    return graphemes;
  };

  const handleSearchLyrics = async () => {
    try {
      const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (data && data.length > 0) {
        setSearchResults(data);
      } else {
        alert("No lyrics found");
        setSearchResults([]);
      }
    } catch (e) {
      console.error(e);
      alert("Error fetching lyrics");
    }
  };

  const handleSelectSearchResult = (result) => {
    let parsed = [];
    if (result.syncedLyrics) {
      const lines = result.syncedLyrics.split('\n');
      parsed = lines.map(line => {
        const match = line.match(/\[(\d+):(\d+\.\d+)\](.*)/);
        if (match) {
          const minutes = parseInt(match[1]);
          const seconds = parseFloat(match[2]);
          const time = minutes * 60 + seconds;
          return { text: match[3].trim(), startTime: time, endTime: null };
        }
        return null;
      }).filter(Boolean);
    } else if (result.plainLyrics) {
      const lines = result.plainLyrics.split('\n');
      parsed = lines.map(line => ({ text: line.trim(), startTime: null, endTime: null })).filter(l => l.text);
    } else {
      alert("This song has no lyrics available.");
      return;
    }
    setLyrics(parsed);
    setSearchResults([]);
  };

  const handleManualPaste = (e) => {
    const text = e.target.value;
    const lines = text.split('\n').filter(l => l.trim() !== '');
    setLyrics(lines.map(l => ({ text: l.trim(), startTime: null, endTime: null })));
  };

  const updateLyricTime = (index, type) => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    setLyrics(prev => {
      const newLyrics = [...prev];
      newLyrics[index] = { ...newLyrics[index], [type]: time };
      return newLyrics;
    });
  };

  const deleteLyric = (index) => {
    setLyrics(prev => prev.filter((_, i) => i !== index));
  };

  const shiftLyricsOffset = (index) => {
    if (!videoRef.current) return;
    const currentVideoTime = videoRef.current.currentTime;
    const targetLyric = lyrics[index];
    
    if (targetLyric.startTime === null) {
      alert("This lyric doesn't have an original timestamp.");
      return;
    }

    const offset = targetLyric.startTime - currentVideoTime;

    setLyrics(prev => prev.map(l => ({
      ...l,
      startTime: l.startTime !== null ? l.startTime - offset : null,
      endTime: l.endTime !== null ? l.endTime - offset : null,
    })));
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current || isExporting) return;
    const time = videoRef.current.currentTime;
    setCurrentTime(time);
    
    const activeIdx = lyrics.findIndex((l, idx) => {
      const nextLyric = lyrics[idx + 1];
      const start = l.startTime !== null ? l.startTime : -1;
      let end = nextLyric && nextLyric.startTime !== null ? nextLyric.startTime : 999999;
      if (l.endTime !== null && l.endTime + 1 < end) {
        end = l.endTime + 1; // Stay on screen for 1 second after sweep ends, then clear
      }
      return time >= start && time < end;
    });
    setActiveLyricIndex(activeIdx);
  };

  const handleRenderPreview = async () => {
    if (!videoPath || lyrics.length === 0 || !videoRef.current) return;
    setIsExporting(true);
    setRenderProgress('Initializing...');
    
    try {
      const startResult = await window.electronAPI.startRender();
      if (!startResult.success) throw new Error("Failed to start render");
      const tempDir = startResult.tempDir;

      const vHeight = videoRef.current.videoHeight || 1920;
      const container = document.querySelector('.video-container');
      const scale = vHeight / container.clientHeight;
      
      // Hide video during capture to get transparent background
      videoRef.current.style.opacity = '0';
      
      const FPS = exportFps;
      const duration = videoRef.current.duration;
      const totalFrames = Math.floor(duration * FPS);

      for (let i = 0; i < totalFrames; i++) {
        const time = i / FPS;
        videoRef.current.currentTime = time;
        
        // Wait for video to seek
        await new Promise(r => {
          const handler = () => { videoRef.current.removeEventListener('seeked', handler); r(); };
          videoRef.current.addEventListener('seeked', handler);
          setTimeout(r, 200); // safety fallback
        });
        
        // Manually calculate active lyric for this exact frame
        const activeIdx = lyrics.findIndex((l, idx) => {
          const nextLyric = lyrics[idx + 1];
          const start = l.startTime !== null ? l.startTime : -1;
          let end = nextLyric && nextLyric.startTime !== null ? nextLyric.startTime : 999999;
          if (l.endTime !== null && l.endTime + 1 < end) {
            end = l.endTime + 1;
          }
          return time >= start && time < end;
        });
        setActiveLyricIndex(activeIdx);
        setCurrentTime(time);
        
        // Wait for React to render the DOM update
        await new Promise(r => setTimeout(r, 50)); 
        
        const canvas = await html2canvas(container, {
          backgroundColor: null,
          scale: scale,
          useCORS: true
        });
        
        const base64 = canvas.toDataURL('image/png');
        await window.electronAPI.saveFrame(tempDir, i, base64);
        
        setRenderProgress(`Rendering frame ${i + 1} / ${totalFrames}`);
      }

      setRenderProgress('Stitching video with FFmpeg...');
      
      // Restore video opacity
      videoRef.current.style.opacity = '1';
      
      const vWidth = videoRef.current.videoWidth || 1080;
      const result = await window.electronAPI.finishRender(videoPath, tempDir, FPS, vWidth, vHeight);
      
      setIsExporting(false);
      setRenderProgress(null);
      
      if (result.success) {
        setRenderedVideoPath(result.path);
        setRenderedVideoSrc(`file://${result.path}`);
      } else {
        alert("Render failed: " + result.error);
      }
    } catch (e) {
      console.error("Render loop error:", e);
      alert("Failed to render video: " + e.message);
      videoRef.current.style.opacity = '1';
      setIsExporting(false);
      setRenderProgress(null);
    }
  };

  const handleSaveExport = async () => {
    if (!renderedVideoPath) return;
    const result = await window.electronAPI.saveVideo({ tempPath: renderedVideoPath });
    if (result.success) {
      alert("Export successful: " + result.path);
    } else if (result.error !== 'Save canceled') {
      alert("Export failed: " + result.error);
    }
  };

  const runAnalyzer = async () => {
    if (!videoSrc || !renderedVideoPath) return;
    setIsAnalyzing(true);
    
    try {
      const lyric = lyrics.find(l => l.startTime !== null);
      if (!lyric) {
        alert("No synced lyrics found to analyze.");
        setIsAnalyzing(false);
        return;
      }
      const targetTime = lyric.startTime + 0.5;
      
      setRenderedVideoSrc(null); // Force HTML overlay preview mode
      
      await new Promise(r => setTimeout(r, 200)); // wait for React render
      
      videoRef.current.currentTime = targetTime;
      await new Promise(r => {
        const handler = () => { videoRef.current.removeEventListener('seeked', handler); r(); };
        videoRef.current.addEventListener('seeked', handler);
        setTimeout(r, 1000);
      });

      const container = document.querySelector('.video-container');
      const targetCanvas = await html2canvas(container, { useCORS: true, allowTaint: true });
      const targetCtx = targetCanvas.getContext('2d');
      const targetData = targetCtx.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
      const targetUrl = targetCanvas.toDataURL('image/png');

      const actualVid = document.createElement('video');
      actualVid.src = `file://${renderedVideoPath}`;
      actualVid.currentTime = targetTime;
      await new Promise((resolve) => {
        actualVid.onseeked = resolve;
        actualVid.onloadeddata = () => { actualVid.currentTime = targetTime; };
        setTimeout(resolve, 2000); 
      });

      const actualCanvas = document.createElement('canvas');
      actualCanvas.width = targetCanvas.width;
      actualCanvas.height = targetCanvas.height;
      const actualCtx = actualCanvas.getContext('2d');
      
      actualCtx.drawImage(actualVid, 0, 0, actualCanvas.width, actualCanvas.height);
      const actualData = actualCtx.getImageData(0, 0, actualCanvas.width, actualCanvas.height);
      const actualUrl = actualCanvas.toDataURL('image/png');

      const diffCanvas = document.createElement('canvas');
      diffCanvas.width = targetCanvas.width;
      diffCanvas.height = targetCanvas.height;
      const diffCtx = diffCanvas.getContext('2d');
      const diffImageData = diffCtx.createImageData(diffCanvas.width, diffCanvas.height);

      const numDiffPixels = pixelmatch(
        targetData.data, 
        actualData.data, 
        diffImageData.data, 
        targetCanvas.width, 
        targetCanvas.height, 
        { threshold: 0.1, alpha: 0.5, diffColor: [255, 0, 0] }
      );
      
      diffCtx.putImageData(diffImageData, 0, 0);
      const diffUrl = diffCanvas.toDataURL('image/png');
      
      const totalPixels = targetCanvas.width * targetCanvas.height;
      const accuracy = ((1 - (numDiffPixels / totalPixels)) * 100).toFixed(2);

      setAnalyzerData({ targetUrl, actualUrl, diffUrl, accuracy });
      setShowAnalyzer(true);
      
      setRenderedVideoSrc(`file://${renderedVideoPath}`);
    } catch (err) {
      console.error(err);
      alert("Error running analyzer: " + err.message);
      setRenderedVideoSrc(`file://${renderedVideoPath}`);
    }
    setIsAnalyzing(false);
  };

  return (
    <div className="app-container">
      {showAnalyzer && analyzerData && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.95)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px', overflowY: 'auto' }}>
          <h1 style={{ color: 'white', marginBottom: '10px' }}>Preview Analyzer</h1>
          <h2 style={{ color: analyzerData.accuracy > 95 ? '#4CAF50' : '#f44336', marginTop: 0 }}>Accuracy Match Score: {analyzerData.accuracy}%</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '30px' }}>Notice any broken or separated Tamil fonts in the Diff map marked in red.</p>
          
          <div style={{ display: 'flex', gap: '30px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ color: 'white' }}>1. Target (Editable HTML)</h3>
              <img src={analyzerData.targetUrl} style={{ width: '300px', border: '1px solid #444', borderRadius: '8px' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ color: 'white' }}>2. Actual (FFmpeg Render)</h3>
              <img src={analyzerData.actualUrl} style={{ width: '300px', border: '1px solid #444', borderRadius: '8px' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ color: '#f44336' }}>3. Diff Map (Red = Errors)</h3>
              <img src={analyzerData.diffUrl} style={{ width: '300px', border: '1px solid #444', borderRadius: '8px' }} />
            </div>
          </div>
          
          <button onClick={() => setShowAnalyzer(false)} style={{ marginTop: '40px', padding: '12px 30px', fontSize: '18px', backgroundColor: '#2196F3' }}>Close Analyzer</button>
        </div>
      )}

      <div className="video-workspace">
        <div style={{ marginBottom: '15px', display: 'flex', gap: '10px', width: '100%', maxWidth: '800px', justifyContent: 'center' }}>
          <button onClick={handleSelectVideo} disabled={renderedVideoSrc !== null || isAnalyzingAudio}>
            {isAnalyzingAudio ? 'Analyzing Beats...' : (videoSrc ? 'Change Video' : 'Load Reels Footage')}
          </button>
          {videoSrc && !renderedVideoSrc && (
            <button 
              onClick={() => { setVideoSrc(null); setVideoPath(null); }}
              style={{ backgroundColor: 'var(--danger)' }}
            >
              Unload Video
            </button>
          )}
          {renderedVideoSrc && (
            <button 
              onClick={() => { setRenderedVideoSrc(null); setRenderedVideoPath(null); }}
              style={{ backgroundColor: '#ff9800', color: '#fff' }}
            >
              Return to Editor
            </button>
          )}
        </div>
        
        <div className="video-container">
          {videoSrc || renderedVideoSrc ? (
            <video 
              ref={videoRef}
              src={renderedVideoSrc || ("file://" + videoSrc.replace("local-resource://", ""))} 
              controls 
              onTimeUpdate={handleTimeUpdate}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
              No footage loaded
            </div>
          )}
          {!renderedVideoSrc && activeLyricIndex !== -1 && lyrics[activeLyricIndex] && (
            <div 
              key={activeLyricIndex} 
              className={`lyrics-overlay ${placement}`}
              style={{
                fontFamily: fontFamily,
                fontSize: `${fontSize}px`,
                textAlign: 'center',
                lineHeight: '1.4'
              }}
            >
              {(() => {
                const lyric = lyrics[activeLyricIndex];
                if (!lyric || lyric.startTime === null) return <span style={{ color: fontColor }}>{lyric ? lyric.text : ''}</span>;
                if (animationStyle === 'None') return <span style={{ color: fontColor }}>{lyric.text}</span>;

                const text = lyric.text;
                let duration = 5;
                if (lyric.endTime !== null) {
                  duration = lyric.endTime - lyric.startTime;
                } else if (lyrics[activeLyricIndex + 1] && lyrics[activeLyricIndex + 1].startTime !== null) {
                  duration = lyrics[activeLyricIndex + 1].startTime - lyric.startTime;
                }
                
                const segmenter = new Intl.Segmenter('ta', { granularity: 'grapheme' });
                const totalChars = Array.from(segmenter.segment(text)).length;
                const charDuration = duration / (totalChars || 1);

                const words = text.split(' ');
                let charAccumulator = 0;

                return words.map((word, wordIndex) => {
                  const wordChars = Array.from(segmenter.segment(word)).length;
                  const wordStartTime = lyric.startTime + (charAccumulator * charDuration);
                  const wordDuration = wordChars * charDuration;
                  
                  charAccumulator += wordChars + 1; // +1 for the space

                  let progressPercentage = 0;
                  if (currentTime >= wordStartTime + wordDuration) {
                    progressPercentage = 100;
                  } else if (currentTime >= wordStartTime) {
                    const elapsed = currentTime - wordStartTime;
                    const charsRevealed = Math.floor(elapsed / charDuration);
                    progressPercentage = (charsRevealed / wordChars) * 100;
                  }

                  let scale = 1.0;
                  if (animationStyle === 'Karaoke Pop' && currentTime >= wordStartTime && currentTime <= wordStartTime + wordDuration) {
                    let closestSpike = -1;
                    for (let i = beatTimestamps.length - 1; i >= 0; i--) {
                      if (beatTimestamps[i] <= currentTime) {
                        closestSpike = beatTimestamps[i];
                        break;
                      }
                    }
                    if (closestSpike !== -1) {
                      const elapsedSinceSpike = currentTime - closestSpike;
                      if (elapsedSinceSpike < 0.25) {
                        const decay = 1.0 - (elapsedSinceSpike / 0.25);
                        scale = 1.0 + (0.25 * decay); // Max scale 1.25
                      }
                    }
                  }

                  if (animationStyle === 'Karaoke Wave') {
                    if (waveTarget === 'Word') {
                      let progressPercentage = 0;
                      if (currentTime >= wordStartTime + wordDuration) {
                        progressPercentage = 100;
                      } else if (currentTime >= wordStartTime) {
                        const elapsed = currentTime - wordStartTime;
                        const charsRevealed = Math.floor(elapsed / charDuration);
                        progressPercentage = (charsRevealed / wordChars) * 100;
                      }

                      let translateY = 0;
                      let scale = 1.0;
                      
                      if (currentTime >= wordStartTime) {
                          const elapsed = currentTime - wordStartTime;
                          if (elapsed < waveSmoothness) {
                              const progress = elapsed / waveSmoothness;
                              const wave = Math.sin(progress * Math.PI);
                              translateY = wave * -waveAmplitude; 
                              scale = 1.0 + (wave * 0.10);
                          }
                      }
                      
                      return (
                        <React.Fragment key={wordIndex}>
                          <span style={{ 
                            position: 'relative', 
                            display: 'inline-block',
                            transform: `translateY(${translateY}px) scale(${scale})`,
                            transformOrigin: 'center bottom',
                            transition: isExporting ? 'none' : 'transform 0.05s linear'
                          }}>
                            <span style={{ color: fontColor }}>{word}</span>
                            <span style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              bottom: 0,
                              width: `${progressPercentage}%`,
                              overflow: 'hidden',
                              color: highlightColor,
                              whiteSpace: 'nowrap'
                            }}>
                              {word}
                            </span>
                          </span>
                          {wordIndex < words.length - 1 && <span> </span>}
                        </React.Fragment>
                      );
                    } else {
                      const graphemes = getGraphemeMeasurements(word);
                      const activeProgress = (currentTime - wordStartTime) / wordDuration;

                      return (
                        <React.Fragment key={wordIndex}>
                          <span style={{ position: 'relative', display: 'inline-block' }}>
                            <span style={{ color: 'transparent' }}>{word}</span>
                            {graphemes.map((g, gIdx) => {
                              const gCenter = ((g.leftPercent + g.rightPercent) / 2) / 100;
                              const distance = activeProgress - gCenter;
                              
                              let wave = 0;
                              // The waveSmoothness controls the width of the bell curve swell.
                              if (Math.abs(distance) < waveSmoothness) {
                                  const phase = (distance / waveSmoothness) * (Math.PI / 2);
                                  wave = Math.cos(phase);
                              }
                              
                              const translateY = wave * -waveAmplitude; 
                              const scale = 1.0 + (wave * 0.10);
                              const color = activeProgress >= gCenter ? highlightColor : fontColor;
                              
                              return (
                                <span key={gIdx} style={{
                                  position: 'absolute', top: 0, left: 0, bottom: 0, right: 0,
                                  color: color,
                                  WebkitMaskImage: `linear-gradient(to right, transparent ${g.leftPercent}%, black ${g.leftPercent}%, black ${g.rightPercent}%, transparent ${g.rightPercent}%)`,
                                  maskImage: `linear-gradient(to right, transparent ${g.leftPercent}%, black ${g.leftPercent}%, black ${g.rightPercent}%, transparent ${g.rightPercent}%)`,
                                  transform: `translateY(${translateY}px) scale(${scale})`,
                                  transformOrigin: 'center bottom',
                                  transition: isExporting ? 'none' : 'transform 0.05s linear, color 0.05s'
                                }}>
                                  {word}
                                </span>
                              );
                            })}
                          </span>
                          {wordIndex < words.length - 1 && <span> </span>}
                        </React.Fragment>
                      );
                    }
                  }

                  return (
                    <React.Fragment key={wordIndex}>
                      <span style={{ 
                        position: 'relative', 
                        display: 'inline-block',
                        transform: `scale(${scale})`,
                        transformOrigin: 'center bottom',
                        transition: isExporting ? 'none' : 'transform 0.05s ease-out'
                      }}>
                        <span style={{ color: fontColor }}>{word}</span>
                        <span style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          bottom: 0,
                          width: `${progressPercentage}%`,
                          overflow: 'hidden',
                          color: highlightColor,
                          whiteSpace: 'nowrap'
                        }}>
                          {word}
                        </span>
                      </span>
                      {wordIndex < words.length - 1 && <span> </span>}
                    </React.Fragment>
                  );
                });
              })()}
            </div>
          )}
        </div>
      </div>

      <div className="sidebar">
        <h2>Styling & Placement</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px', padding: '15px', backgroundColor: '#2a2a2a', borderRadius: '6px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <label style={{ width: '80px', fontSize: '14px' }}>Font:</label>
            <select style={{ flex: 1, padding: '5px' }} value={fontFamily} onChange={e => setFontFamily(e.target.value)}>
              <option value="Tamil MN">Tamil MN (Mac)</option>
              <option value="Tamil Sangam MN">Tamil Sangam MN (Mac)</option>
              <option value="InaiMathi">InaiMathi (Mac)</option>
              <option value="Arial Unicode MS">Arial Unicode MS</option>
              <option value="Arial">Arial</option>
              <option value="Helvetica">Helvetica</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <label style={{ width: '80px', fontSize: '14px' }}>Size:</label>
            <input type="range" min="20" max="120" value={fontSize} onChange={e => setFontSize(e.target.value)} style={{ flex: 1 }} />
            <span style={{ fontSize: '14px', minWidth: '30px' }}>{fontSize}px</span>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <label style={{ width: '80px', fontSize: '14px' }}>Color:</label>
            <input type="color" value={fontColor} onChange={e => setFontColor(e.target.value)} style={{ width: '40px', height: '30px', padding: '0', border: 'none' }} title="Base Color" />
            <input type="color" value={highlightColor} onChange={e => setHighlightColor(e.target.value)} style={{ width: '40px', height: '30px', padding: '0', border: 'none', opacity: animationStyle === 'None' ? 0.5 : 1 }} title="Highlight Color" disabled={animationStyle === 'None'} />
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <label style={{ width: '80px', fontSize: '14px' }}>Placement:</label>
            <select style={{ flex: 1, padding: '5px' }} value={placement} onChange={e => setPlacement(e.target.value)}>
              <option value="pos-top">Top</option>
              <option value="pos-middle">Middle</option>
              <option value="pos-bottom">Bottom</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <label style={{ width: '80px', fontSize: '14px' }}>Animation:</label>
            <select style={{ flex: 1, padding: '5px' }} value={animationStyle} onChange={e => setAnimationStyle(e.target.value)}>
              <option value="None">None</option>
              <option value="Karaoke">Karaoke (Highlight)</option>
              <option value="Karaoke Pop">Karaoke Pop (Beat Reactive)</option>
              <option value="Karaoke Wave">Karaoke Wave (Jumping Float)</option>
            </select>
          </div>

          {animationStyle === 'Karaoke Wave' && (() => {
            const WAVE_PRESETS = [
              { name: '1. Heavenly Float (Smoothest)', target: 'Word', amp: 10, smooth: 1.0 },
              { name: '2. Gentle Breathe', target: 'Word', amp: 15, smooth: 0.8 },
              { name: '3. Soft Ripple', target: 'Word', amp: 20, smooth: 0.6 },
              { name: '4. Rhythmic Bounce', target: 'Word', amp: 25, smooth: 0.4 },
              { name: '5. Standard Pop', target: 'Word', amp: 30, smooth: 0.3 },
              { name: '6. Snappy Jump', target: 'Word', amp: 35, smooth: 0.2 },
              { name: '7. Aggressive Kick', target: 'Word', amp: 40, smooth: 0.15 },
              { name: '8. Hardcore Stomp (Hardest)', target: 'Word', amp: 50, smooth: 0.1 },
              { name: '9. Letter Ripple (Tears Text)', target: 'Letter', amp: 15, smooth: 0.3 },
              { name: '10. Chaotic Tremor (Tears Text)', target: 'Letter', amp: 30, smooth: 0.1 }
            ];
            
            const currentPresetName = WAVE_PRESETS.find(p => p.target === waveTarget && p.amp === waveAmplitude && p.smooth === waveSmoothness)?.name || 'Custom';

            return (
              <div style={{ padding: '10px', backgroundColor: '#333', borderRadius: '5px', marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <strong style={{ fontSize: '14px' }}>🌊 Animation Studio</strong>
                
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <label style={{ width: '80px', fontSize: '12px', color: '#00e5ff' }}>Preset:</label>
                  <select style={{ flex: 1, padding: '3px', fontSize: '12px' }} value={currentPresetName} onChange={e => {
                    const p = WAVE_PRESETS.find(pr => pr.name === e.target.value);
                    if (p) {
                      setWaveTarget(p.target);
                      setWaveAmplitude(p.amp);
                      setWaveSmoothness(p.smooth);
                    }
                  }}>
                    <option value="Custom">-- Custom --</option>
                    {WAVE_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <label style={{ width: '80px', fontSize: '12px' }}>Target:</label>
                  <select style={{ flex: 1, padding: '3px', fontSize: '12px' }} value={waveTarget} onChange={e => setWaveTarget(e.target.value)}>
                    <option value="Word">Whole Word (Smooth & No Tearing)</option>
                    <option value="Letter">By Letter (May tear complex ligatures)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <label style={{ width: '80px', fontSize: '12px' }}>Amplitude:</label>
                  <input type="range" min="0" max="50" value={waveAmplitude} onChange={e => setWaveAmplitude(Number(e.target.value))} style={{ flex: 1 }} />
                  <span style={{ fontSize: '12px', width: '30px' }}>{waveAmplitude}px</span>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <label style={{ width: '80px', fontSize: '12px' }}>Smoothness:</label>
                  <input type="range" min="0.1" max="1.0" step="0.1" value={waveSmoothness} onChange={e => setWaveSmoothness(Number(e.target.value))} style={{ flex: 1 }} />
                  <span style={{ fontSize: '12px', width: '30px' }}>{waveSmoothness}s</span>
                </div>
              </div>
            );
          })()}

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' }}>
            <label style={{ width: '80px', fontSize: '14px', color: '#ff9800' }}>Export FPS:</label>
            <select style={{ flex: 1, padding: '5px' }} value={exportFps} onChange={e => setExportFps(parseInt(e.target.value))}>
              <option value="30">30 Hz</option>
              <option value="60">60 Hz</option>
              <option value="75">75 Hz</option>
              <option value="120">120 Hz</option>
            </select>
          </div>
        </div>

        <h2>Lyrics Setup</h2>
        
        <div className="search-bar">
          <input 
            type="text" 
            placeholder="Search Tamil Song..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearchLyrics()}
          />
          <button onClick={handleSearchLyrics}>Search</button>
        </div>

        {searchResults.length > 0 && (
          <div className="search-results">
            <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-muted)' }}>Suggestions:</h4>
            {searchResults.map((result) => (
              <div 
                key={result.id} 
                className="search-result-item"
                onClick={() => handleSelectSearchResult(result)}
              >
                <strong>{result.trackName}</strong>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}> by {result.artistName}</span>
                {result.syncedLyrics && <span style={{ fontSize: '10px', marginLeft: '5px', color: '#4CAF50' }}>(Synced)</span>}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: '10px', marginTop: searchResults.length > 0 ? '15px' : '0' }}>
          <p style={{ margin: '0 0 5px 0', fontSize: '12px', color: 'var(--text-muted)' }}>Or paste lyrics manually:</p>
          <textarea 
            rows="3" 
            placeholder="Paste lyrics here..."
            onBlur={handleManualPaste}
          />
        </div>

        <div className="lyrics-list">
          {lyrics.map((lyric, idx) => (
            <div key={idx} className={`lyric-item ${activeLyricIndex === idx ? 'active' : ''}`}>
              <input 
                type="text" 
                value={lyric.text} 
                onChange={(e) => {
                  const newLyrics = [...lyrics];
                  newLyrics[idx].text = e.target.value;
                  setLyrics(newLyrics);
                }}
              />
              <div style={{ display: 'flex', gap: '5px' }}>
                <button 
                  title="Set exact start time to current video time"
                  style={{ padding: '4px 8px', fontSize: '12px' }} 
                  onClick={() => updateLyricTime(idx, 'startTime')}
                >
                  {lyric.startTime !== null ? lyric.startTime.toFixed(1) : 'Start'}
                </button>
                <button 
                  title="Set exact end time to current video time"
                  style={{ padding: '4px 8px', fontSize: '12px', backgroundColor: '#9C27B0' }} 
                  onClick={() => updateLyricTime(idx, 'endTime')}
                >
                  {lyric.endTime !== null ? lyric.endTime.toFixed(1) : 'End'}
                </button>
                <button 
                  title="Shift all lyrics so this line starts at current video time"
                  style={{ padding: '4px 8px', fontSize: '12px', backgroundColor: '#2196F3' }} 
                  onClick={() => shiftLyricsOffset(idx)}
                >
                  Shift
                </button>
                <button 
                  title="Delete line"
                  style={{ padding: '4px 8px', fontSize: '12px', backgroundColor: 'var(--danger)' }} 
                  onClick={() => deleteLyric(idx)}
                >
                  X
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
          {!renderedVideoSrc ? (
            <button 
              className="export-btn" 
              onClick={handleRenderPreview}
              disabled={isExporting || !videoPath || lyrics.length === 0}
              style={{ backgroundColor: '#4CAF50' }}
            >
              {isExporting ? renderProgress : 'Render Preview'}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                className="export-btn" 
                onClick={runAnalyzer}
                disabled={isAnalyzing}
                style={{ flex: 1, backgroundColor: '#9C27B0' }}
              >
                {isAnalyzing ? 'Analyzing...' : 'Analyze Accuracy'}
              </button>
              <button 
                className="export-btn" 
                onClick={handleSaveExport}
                style={{ flex: 1, backgroundColor: '#2196F3' }}
              >
                Save Exported Video
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
