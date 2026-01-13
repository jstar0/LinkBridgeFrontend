const api = require('../../utils/linkbridge/api');

function ensurePermission(scope) {
  return new Promise((resolve, reject) => {
    if (typeof wx?.authorize !== 'function') {
      resolve({ skipped: true });
      return;
    }

    wx.authorize({
      scope,
      success() {
        resolve({ granted: true });
      },
      fail(err) {
        reject({ code: 'permission_denied', message: err?.errMsg || 'permission denied' });
      },
    });
  });
}

function openSettings() {
  return new Promise((resolve) => {
    if (typeof wx?.openSetting !== 'function') {
      resolve({ skipped: true });
      return;
    }
    wx.openSetting({
      complete() {
        resolve({ opened: true });
      },
    });
  });
}

function showModal(options) {
  return new Promise((resolve) => {
    if (typeof wx?.showModal !== 'function') {
      resolve({ confirm: false, cancel: true });
      return;
    }
    wx.showModal({
      ...options,
      success(res) {
        resolve(res);
      },
      fail() {
        resolve({ confirm: false, cancel: true });
      },
    });
  });
}

function setAudioRoute({ speakerOn }) {
  try {
    if (typeof wx?.setInnerAudioOption !== 'function') return false;
    wx.setInnerAudioOption({
      obeyMuteSwitch: false,
      // `speakerOn=false` prefers earpiece/headset; `true` plays via speaker.
      speakerOn: !!speakerOn,
    });
    return true;
  } catch (e) {
    return false;
  }
}

function makeWavHeader({ numChannels, sampleRate, bitsPerSample, dataSize }) {
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  return buffer;
}

function buildViewState({ status, incoming }) {
  const showAccept = incoming && status === 'incoming';
  const showReject = incoming && status === 'incoming';
  const showCancel = !incoming && (status === 'outgoing' || status === 'ringing');
  const showHangup = status === 'in_call';

  return { showAccept, showReject, showCancel, showHangup };
}

Page({
  data: {
    callId: '',
    peerUserId: '',
    peerDisplayName: '',
    incoming: false,
    mediaType: 'voice',
    navbarTitle: '语音通话',
    status: 'idle',
    statusText: '',
    currentUserId: '',
    autoAccept: false,
    showAccept: false,
    showReject: false,
    showCancel: false,
    showHangup: false,
    minimized: false,
    muted: false,
    speakerOn: false,
    controlsVisible: true,
  },

  wsHandler: null,
  recorder: null,
  audioPlayers: null,
  activePlayerIdx: 0,
  segmentQueue: [], // { path, durationMs }
  playIndex: 0,
  startedAudio: false,
  hasEverStartedPlayout: false,
  // Receive buffer: merge a few PCM frames into a longer WAV chunk to reduce boundary clicks.
  jitterBuffer: [], // base64 frames (PCM16LE)
  // Low-latency mode (phone-first): smaller chunks and minimal prebuffer.
  batchSize: 2, // 2 * ~160ms ~= ~320ms per chunk (lower stutter; still low latency)
  prebufferSegments: 1, // start as soon as we have the first chunk
  // Crossfade tends to drift in Mini Program runtimes (timer jitter) and can produce buzz/comb artifacts.
  // Keep it off by default for stability; we can re-enable later if needed.
  enableCrossfade: false,
  crossfadeMs: 120,
  overlapMs: 80,
  // Keep latency bounded: if we fall behind, drop old buffered chunks to stay near-real-time.
  maxQueueSegments: 3,
  _jitterFlushTimer: null,
  _crossfadeTimer: null,
  _crossfadeVolumeTimer: null,
  // Video call
  cameraContext: null,
  videoFrameTimer: null,
  remoteCanvas: null,
  remoteCanvasCtx: null,

  onLoad(query) {
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    const currentUser = api.getUser();
    const currentUserId = currentUser?.id || '';
    const callId = query?.callId || '';
    const peerUserId = query?.peerUserId || '';
    const incoming = query?.incoming === '1' || query?.incoming === 'true';
    const autoAccept = query?.autoAccept === '1' || query?.autoAccept === 'true';
    const mediaType = query?.mediaType || 'voice';
    const peerDisplayName = query?.peerName ? decodeURIComponent(query.peerName) : '';
    const navbarTitle = mediaType === 'video' ? '视频通话' : '语音通话';

    this.setData({
      callId,
      peerUserId,
      peerDisplayName,
      incoming,
      autoAccept,
      mediaType,
      navbarTitle,
      currentUserId,
      status: incoming ? 'incoming' : callId ? 'outgoing' : 'idle',
      statusText: incoming ? '有来电' : '准备呼叫…',
      ...buildViewState({ status: incoming ? 'incoming' : callId ? 'outgoing' : 'idle', incoming }),
    });

    api.connectWebSocket();

    if (callId) {
      this.bootstrapExistingCall(callId, incoming, autoAccept);
      return;
    }
    if (peerUserId) {
      this.startOutgoingCall(peerUserId, mediaType);
      return;
    }

    wx.showToast({ title: '缺少参数', icon: 'none' });
    wx.navigateBack();
  },

  onUnload() {
    if (this.wsHandler) {
      api.removeWebSocketHandler(this.wsHandler);
      this.wsHandler = null;
    }

    this.stopRealtimeAudio().catch(() => null);
  },

  onTapBack() {
    const status = this.data.status;
    const hasActiveCall = status && !['idle', 'ended', 'failed'].includes(status);

    if (!hasActiveCall) {
      wx.navigateBack();
      return;
    }

    // Save call state globally and navigate back
    api.setActiveCall({
      callId: this.data.callId,
      peerUserId: this.data.peerUserId,
      peerDisplayName: this.data.peerDisplayName,
      mediaType: this.data.mediaType,
      status: this.data.status,
      statusText: this.data.statusText,
    });

    wx.navigateBack();
  },

  onRestoreFromFloating() {
    this.setData({ minimized: false });
  },

  onToggleMute() {
    const next = !this.data.muted;
    this.setData({ muted: next });
    wx.showToast({ title: next ? '已静音' : '已取消静音', icon: 'none' });
  },

  onToggleSpeaker() {
    const next = !this.data.speakerOn;

    // Turning on speaker greatly increases the risk of echo/feedback (buzz) because mic may re-capture playback.
    if (next) {
      showModal({
        title: '开启外放？',
        content: '外放可能导致滋滋声/回声，建议使用听筒或戴耳机。仍要开启外放吗？',
        confirmText: '开启外放',
        cancelText: '取消',
      }).then((res) => {
        if (!res?.confirm) return;
        this.setData({ speakerOn: true }, () => {
          const ok = setAudioRoute({ speakerOn: true });
          if (!ok) wx.showToast({ title: '当前环境不支持切换外放', icon: 'none' });
        });
      });
      return;
    }

    this.setData({ speakerOn: false }, () => {
      setAudioRoute({ speakerOn: false });
    });
  },

  onSwitchCamera() {
    // TODO: Implement camera switch logic
    wx.showToast({ title: '切换摄像头', icon: 'none' });
  },

  onShowMenu() {
    // TODO: Implement menu logic
    wx.showToast({ title: '菜单', icon: 'none' });
  },

  onTapScreen() {
    if (this.data.mediaType !== 'video') return;

    // Toggle controls visibility
    const newVisible = !this.data.controlsVisible;
    this.setData({ controlsVisible: newVisible });

    // If showing controls, start timer to hide them
    if (newVisible) {
      this.startHideControlsTimer();
    } else {
      // If hiding, clear the timer
      if (this.hideControlsTimer) {
        clearTimeout(this.hideControlsTimer);
        this.hideControlsTimer = null;
      }
    }
  },

  startHideControlsTimer() {
    // Clear existing timer
    if (this.hideControlsTimer) {
      clearTimeout(this.hideControlsTimer);
    }

    // Set new timer to hide controls after 3 seconds
    this.hideControlsTimer = setTimeout(() => {
      if (this.data.mediaType === 'video') {
        this.setData({ controlsVisible: false });
      }
      this.hideControlsTimer = null;
    }, 3000);
  },

  setupWebSocket(callId) {
    if (!callId) return;

    this.wsHandler = (data) => {
      if (data?.type === 'audio.frame') {
        const payload = data?.payload || {};
        if (payload?.callId !== callId) return;
        const b64 = payload?.data || '';
        if (b64) this.enqueueIncomingAudioFrame(b64);
        return;
      }

      if (data?.type === 'video.frame') {
        const payload = data?.payload || {};
        if (payload?.callId !== callId) return;
        const b64 = payload?.data || '';
        if (b64) this.renderRemoteVideoFrame(b64);
        return;
      }

      const envCall = data?.payload?.call;
      if (!envCall || envCall.id !== callId) return;

      if (data.type === 'call.accepted') {
        if (!this.data.incoming) {
          this.setStatus('accepted', '对方已接听，正在接入…');
          this.startRealtimeAudio();
        }
      }
      if (data.type === 'call.rejected') {
        this.setStatus('ended', '对方已拒绝');
        wx.showToast({ title: '对方已拒绝', icon: 'none' });
        wx.navigateBack();
      }
      if (data.type === 'call.canceled') {
        this.setStatus('ended', '通话已取消');
        wx.navigateBack();
      }
      if (data.type === 'call.ended') {
        this.setStatus('ended', '通话已结束');
        wx.navigateBack();
      }
    };

    api.addWebSocketHandler(this.wsHandler);
  },

  setStatus(status, statusText) {
    const patch = {
      status,
      statusText: statusText || '',
      ...buildViewState({ status, incoming: this.data.incoming }),
    };
    this.setData(patch);
  },

  bootstrapExistingCall(callId, incoming, autoAccept) {
    this.setupWebSocket(callId);

    api
      .getCall(callId)
      .then((res) => {
        const call = res?.call;
        const caller = res?.caller;
        const peerDisplayName =
          incoming && caller?.displayName ? caller.displayName : this.data.peerDisplayName;
        this.setData({ peerDisplayName });

        if (incoming && autoAccept && call?.status === 'inviting') {
          this.onTapAccept();
        }
      })
      .catch(() => null);
  },

  startOutgoingCall(peerUserId, mediaType) {
    this.setStatus('outgoing', '正在呼叫…');

    api
      .createCall(peerUserId, mediaType)
      .then((call) => {
        const callId = call?.id || '';
        if (!callId) throw new Error('missing call id');
        this.setData({ callId });
        this.setupWebSocket(callId);
        this.setStatus('ringing', '等待对方接听…');
      })
      .catch((err) => {
        console.error('Failed to create call:', err);
        wx.showToast({ title: '呼叫失败', icon: 'none' });
        wx.navigateBack();
      });
  },

  joinAfterAccepted() {
    // Backward-compat shim: keep old method name used in a few places.
    this.startRealtimeAudio();
  },

  startRealtimeAudio() {
    const callId = this.data.callId;
    if (!callId) return;
    if (this.startedAudio) {
      this.setStatus('in_call', '通话中');
      return;
    }

    this.startedAudio = true;

    // Default to earpiece/headset to reduce acoustic feedback (buzz).
    // Users can manually enable speaker from UI if needed.
    try {
      if (this.data.speakerOn) this.setData({ speakerOn: false });
    } catch (e) {
      // ignore
    }
    setAudioRoute({ speakerOn: false });

    Promise.resolve()
      .then(() =>
        ensurePermission('scope.record').catch(() =>
          showModal({
            title: '需要麦克风权限',
            content: '请在设置中允许使用麦克风后重试',
            confirmText: '去设置',
            cancelText: '取消',
          }).then((res) => (res.confirm ? openSettings() : Promise.reject(new Error('permission denied'))))
        )
      )
      .then(() => {
        if (typeof wx?.getRecorderManager !== 'function') {
          throw new Error('recorder not supported');
        }

        const recorder = wx.getRecorderManager();
        this.recorder = recorder;

        recorder.onFrameRecorded((e) => {
          const buf = e?.frameBuffer;
          if (!buf) return;

          // Keep frame cadence stable, but when muted, send silence (all-zero PCM) instead of real mic data.
          const muted = !!this.data.muted;
          const payloadBuf = muted ? new ArrayBuffer(buf.byteLength) : buf;
          const b64 = wx.arrayBufferToBase64(payloadBuf);
          api.sendAudioFrame(callId, b64);
        });

        recorder.onError((e) => {
          console.error('recorder error', e);
        });

        // Real-time PCM frames (16kHz mono) for low-cost relay via backend WS.
        recorder.start({
          duration: 10 * 60 * 1000,
          sampleRate: 16000,
          numberOfChannels: 1,
          format: 'PCM',
          frameSize: 5,
        });

        this.setStatus('in_call', '通话中');

        // Start video capture if video call
        if (this.data.mediaType === 'video') {
          this.startVideoCapture();
          // Start auto-hide timer for video call controls
          this.startHideControlsTimer();
        }
      })
      .catch((err) => {
        console.error('Failed to start realtime audio:', err);
        this.startedAudio = false;
        wx.showToast({ title: '进入通话失败', icon: 'none' });
        this.setStatus('failed', '进入通话失败');
      });
  },

  stopRealtimeAudio() {
    this.startedAudio = false;
    this.jitterBuffer = [];
    this.hasEverStartedPlayout = false;

    // Stop video capture
    this.stopVideoCapture();

    if (this.recorder) {
      try {
        this.recorder.stop();
      } catch (e) {
        // ignore
      }
      this.recorder = null;
    }

    this.stopPlayout();
    return Promise.resolve();
  },

  enqueueIncomingAudioFrame(base64Data) {
    this.jitterBuffer.push(base64Data);

    // Merge whenever we have enough frames.
    while (this.jitterBuffer.length >= this.batchSize) {
      const framesToMerge = this.jitterBuffer.splice(0, this.batchSize);
      this.writeMergedAudioFrames(framesToMerge);
    }

    // Flush partial frames soon to reduce initial silence and reduce underflow gaps.
    this.scheduleJitterFlush();
  },

  scheduleJitterFlush() {
    if (!this.startedAudio) return;
    if (this._jitterFlushTimer) return;

    // Wait a short while: if more frames arrive, we'll merge them as a larger chunk.
    this._jitterFlushTimer = setTimeout(() => {
      this._jitterFlushTimer = null;

      // For first audible output, allow 1 frame to reduce start latency.
      // After playout starts, prefer at least 2 frames per chunk to reduce boundary artifacts.
      const minFrames = this.hasEverStartedPlayout ? 2 : 1;
      const available = this.jitterBuffer.length;
      if (available < minFrames) {
        if (available > 0) this.scheduleJitterFlush();
        return;
      }

      const n = Math.min(this.batchSize, available);
      const frames = this.jitterBuffer.splice(0, n);
      this.writeMergedAudioFrames(frames);

      if (this.jitterBuffer.length > 0) this.scheduleJitterFlush();
    }, 80);
  },

  stopPlayout() {
    // Stop jitter flush timer
    if (this._jitterFlushTimer) {
      clearTimeout(this._jitterFlushTimer);
      this._jitterFlushTimer = null;
    }

    // Stop crossfade timers
    if (this._crossfadeTimer) {
      clearTimeout(this._crossfadeTimer);
      this._crossfadeTimer = null;
    }
    if (this._crossfadeVolumeTimer) {
      clearInterval(this._crossfadeVolumeTimer);
      this._crossfadeVolumeTimer = null;
    }

    // Stop players
    const players = Array.isArray(this.audioPlayers) ? this.audioPlayers : [];
    players.forEach((p) => {
      try {
        p.stop();
        p.destroy();
      } catch (e) {
        // ignore
      }
    });
    this.audioPlayers = null;

    // Cleanup queued files
    const fs = wx.getFileSystemManager();
    const queue = Array.isArray(this.segmentQueue) ? this.segmentQueue : [];
    queue.forEach((seg) => {
      const path = seg?.path || '';
      if (!path) return;
      try {
        fs.unlink({ filePath: path, fail: () => null });
      } catch (e) {
        // ignore
      }
    });
    this.segmentQueue = [];

    // Cleanup current segment file (if any)
    const curPath = String(this._currentSeg?.path || '').trim();
    if (curPath) {
      try {
        fs.unlink({ filePath: curPath, fail: () => null });
      } catch (e) {
        // ignore
      }
    }
    this._currentSeg = null;
  },

  trimSegmentQueue() {
    const max = Math.max(0, Number(this.maxQueueSegments || 0) || 0);
    if (!max) return;
    const q = Array.isArray(this.segmentQueue) ? this.segmentQueue : [];
    if (q.length <= max) return;

    const fs = wx.getFileSystemManager();
    while (q.length > max) {
      const drop = q.shift();
      const path = String(drop?.path || '').trim();
      if (!path) continue;
      try {
        fs.unlink({ filePath: path, fail: () => null });
      } catch (e) {
        // ignore
      }
    }

    this.segmentQueue = q;
  },

  ensurePlayers() {
    const need = this.enableCrossfade ? 2 : 1;
    if (Array.isArray(this.audioPlayers) && this.audioPlayers.length === need) return;

    // If player count changes, clean up old instances first to avoid leaking audio resources.
    if (Array.isArray(this.audioPlayers) && this.audioPlayers.length) {
      this.audioPlayers.forEach((p) => {
        try {
          p.stop();
          p.destroy();
        } catch (e) {
          // ignore
        }
      });
      this.audioPlayers = null;
    }

    // Use WebAudio backend if available (better for frequent playback).
    const mk = () => {
      try {
        return wx.createInnerAudioContext({ useWebAudioImplement: true });
      } catch (e) {
        return wx.createInnerAudioContext();
      }
    };

    this.audioPlayers = this.enableCrossfade ? [mk(), mk()] : [mk()];
    this.activePlayerIdx = 0;

    try {
      // Keep in sync with UI speaker state (defaults to earpiece/headset).
      setAudioRoute({ speakerOn: !!this.data.speakerOn });
    } catch (e) {
      // ignore
    }

    // Defensive defaults + end handlers (in case timing-based crossfade misses).
    this.audioPlayers.forEach((player, idx) => {
      if (!player) return;
      player.autoplay = false;
      player.loop = false;

      player.onEnded(() => {
        // If a segment ended unexpectedly (e.g., crossfade scheduled too late), advance immediately.
        if (!this.startedAudio) return;
        const cur = this._currentSeg;
        if (!cur || cur.playerIdx !== idx) return;

        // Cancel any scheduled crossfade (if enabled).
        if (this._crossfadeTimer) {
          clearTimeout(this._crossfadeTimer);
          this._crossfadeTimer = null;
        }
        if (this._crossfadeVolumeTimer) {
          clearInterval(this._crossfadeVolumeTimer);
          this._crossfadeVolumeTimer = null;
        }

        try {
          wx.getFileSystemManager().unlink({ filePath: cur.path, fail: () => null });
        } catch (e) {
          // ignore
        }

        this._currentSeg = null;
        this.kickPlayout();
      });

      player.onError(() => null);
    });
  },

  applyEdgeFadePcm16le(pcmBytes, sampleRate, fadeMs) {
    const buf = pcmBytes instanceof Uint8Array ? pcmBytes : new Uint8Array(0);
    const sr = Number(sampleRate || 0) || 16000;
    const ms = Number(fadeMs || 0) || 0;
    if (buf.byteLength < 4) return buf;
    if (ms <= 0) return buf;

    const totalSamples = Math.floor(buf.byteLength / 2);
    const fadeSamples = Math.min(totalSamples, Math.max(1, Math.floor((sr * ms) / 1000)));
    if (fadeSamples <= 1) return buf;

    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    const scaleSample = (idx, gain) => {
      const off = idx * 2;
      if (off + 2 > view.byteLength) return;
      const s = view.getInt16(off, true);
      const v = Math.max(-32768, Math.min(32767, Math.round(s * gain)));
      view.setInt16(off, v, true);
    };

    // Fade-in
    for (let i = 0; i < fadeSamples; i++) {
      scaleSample(i, i / fadeSamples);
    }

    // Fade-out
    for (let i = 0; i < fadeSamples; i++) {
      const idx = totalSamples - fadeSamples + i;
      if (idx < 0) continue;
      scaleSample(idx, (fadeSamples - i) / fadeSamples);
    }

    return buf;
  },

  writeMergedAudioFrames(base64Frames) {
    // Convert all frames to PCM and merge
    const pcmArrays = base64Frames.map((b64) => new Uint8Array(wx.base64ToArrayBuffer(b64)));
    const totalSize = pcmArrays.reduce((sum, arr) => sum + arr.byteLength, 0);

    // Merge all PCM data
    const mergedPcm = new Uint8Array(totalSize);
    let offset = 0;
    for (const arr of pcmArrays) {
      mergedPcm.set(arr, offset);
      offset += arr.byteLength;
    }

    // Apply a short fade at chunk edges to avoid click/pop when starting/ending playback.
    this.applyEdgeFadePcm16le(mergedPcm, 16000, 8);

    // Create WAV header for merged data
    const header = makeWavHeader({
      numChannels: 1,
      sampleRate: 16000,
      bitsPerSample: 16,
      dataSize: totalSize,
    });

    const wav = new Uint8Array(header.byteLength + totalSize);
    wav.set(new Uint8Array(header), 0);
    wav.set(mergedPcm, header.byteLength);

    const filePath = `${wx.env.USER_DATA_PATH}/lb_call_${Date.now()}_${this.playIndex++}.wav`;
    try {
      const fs = wx.getFileSystemManager();
      fs.writeFile({
        filePath,
        data: wav.buffer,
        success: () => {
          const durationMs = Math.max(1, Math.round((totalSize / (16000 * 2)) * 1000));
          this.segmentQueue.push({ path: filePath, durationMs });
          this.trimSegmentQueue();
          this.kickPlayout();
        },
        fail: () => null,
      });
    } catch (e) {
      // ignore
    }
  },

  kickPlayout() {
    if (!this.startedAudio) return;
    this.ensurePlayers();

    // If nothing is playing yet, wait for enough buffered chunks.
    if (!this._currentSeg && !this.hasEverStartedPlayout) {
      if ((this.segmentQueue?.length || 0) < this.prebufferSegments) return;
    }

    if (!this._currentSeg) {
      const next = this.segmentQueue.shift();
      if (!next?.path) return;
      this.startSegmentAsCurrent(next);
      return;
    }

    // Current is playing; optionally schedule crossfade (disabled by default for stability).
    if (this.enableCrossfade && !this._crossfadeTimer && (this.segmentQueue?.length || 0) > 0) {
      const cur = this._currentSeg;
      const delay = Math.max(0, Number(cur.durationMs || 0) - this.overlapMs);
      this._crossfadeTimer = setTimeout(() => {
        this._crossfadeTimer = null;
        this.crossfadeToNext();
      }, delay);
    }
  },

  startSegmentAsCurrent(seg) {
    const s = seg || {};
    const path = String(s.path || '').trim();
    const durationMs = Number(s.durationMs || 0) || 0;
    if (!path || durationMs <= 0) return;

    const idx = this.enableCrossfade ? Number(this.activePlayerIdx || 0) || 0 : 0;
    const player = this.audioPlayers[idx];
    if (!player) return;

    this._currentSeg = { path, durationMs, playerIdx: idx };
    this.hasEverStartedPlayout = true;

    try {
      player.stop();
    } catch (e) {
      // ignore
    }

    try {
      player.volume = 1;
      player.src = path;
      player.play();
    } catch (e) {
      // ignore
    }

    // Ensure scheduling for the next segment.
    this.kickPlayout();
  },

  crossfadeToNext() {
    if (!this.startedAudio) return;
    if (!this._currentSeg) return;
    if (!this.segmentQueue || this.segmentQueue.length === 0) return;

    const curSeg = this._currentSeg;
    const curIdx = Number(curSeg.playerIdx || 0) || 0;
    const nextIdx = curIdx === 0 ? 1 : 0;
    const curPlayer = this.audioPlayers?.[curIdx];
    const nextPlayer = this.audioPlayers?.[nextIdx];
    if (!curPlayer || !nextPlayer) return;

    const nextSeg = this.segmentQueue.shift();
    const nextPath = String(nextSeg?.path || '').trim();
    const nextDurationMs = Number(nextSeg?.durationMs || 0) || 0;
    if (!nextPath || nextDurationMs <= 0) return;

    // Start next segment quietly, then fade in/out.
    try {
      nextPlayer.stop();
    } catch (e) {
      // ignore
    }

    try {
      nextPlayer.volume = 0;
      nextPlayer.src = nextPath;
      nextPlayer.play();
    } catch (e) {
      // ignore
    }

    const fadeMs = Number(this.crossfadeMs || 0) || 120;
    const steps = 6;
    const stepMs = Math.max(12, Math.floor(fadeMs / steps));
    let step = 0;

    if (this._crossfadeVolumeTimer) {
      clearInterval(this._crossfadeVolumeTimer);
      this._crossfadeVolumeTimer = null;
    }

    this._crossfadeVolumeTimer = setInterval(() => {
      step++;
      const t = Math.min(1, step / steps);
      try {
        curPlayer.volume = Math.max(0, 1 - t);
        nextPlayer.volume = Math.min(1, t);
      } catch (e) {
        // ignore
      }

      if (t >= 1) {
        clearInterval(this._crossfadeVolumeTimer);
        this._crossfadeVolumeTimer = null;

        // Stop and cleanup current segment file.
        try {
          curPlayer.stop();
        } catch (e) {
          // ignore
        }
        try {
          wx.getFileSystemManager().unlink({ filePath: curSeg.path });
        } catch (e) {
          // ignore
        }

        this.activePlayerIdx = nextIdx;
        this._currentSeg = { path: nextPath, durationMs: nextDurationMs, playerIdx: nextIdx };

        // Continue scheduling.
        this.kickPlayout();
      }
    }, stepMs);
  },

  // Video call methods
  startVideoCapture() {
    if (this.data.mediaType !== 'video') return;
    if (this.videoFrameTimer) return;

    const callId = this.data.callId;
    if (!callId) return;

    // Initialize camera context
    this.cameraContext = wx.createCameraContext();

    // Capture and send video frames at ~10 FPS
    this.videoFrameTimer = setInterval(() => {
      if (!this.startedAudio) return;

      this.cameraContext.takePhoto({
        quality: 'low',
        success: (res) => {
          // Read the image file and convert to base64
          const fs = wx.getFileSystemManager();
          fs.readFile({
            filePath: res.tempImagePath,
            encoding: 'base64',
            success: (fileRes) => {
              api.sendVideoFrame(callId, fileRes.data);
              // Clean up temp file
              fs.unlink({ filePath: res.tempImagePath });
            },
            fail: () => null,
          });
        },
        fail: () => null,
      });
    }, 100); // 10 FPS
  },

  stopVideoCapture() {
    if (this.videoFrameTimer) {
      clearInterval(this.videoFrameTimer);
      this.videoFrameTimer = null;
    }
    this.cameraContext = null;
    this.remoteCanvas = null;
    this.remoteCanvasCtx = null;
  },

  initRemoteCanvas() {
    if (this.remoteCanvasCtx) return;

    const query = wx.createSelectorQuery();
    query
      .select('#remoteVideo')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res?.[0]?.node) return;

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');

        // Set canvas size to match display
        const dpr = wx.getWindowInfo().pixelRatio;
        canvas.width = res[0].width * dpr;
        canvas.height = res[0].height * dpr;
        ctx.scale(dpr, dpr);

        this.remoteCanvas = canvas;
        this.remoteCanvasCtx = ctx;
      });
  },

  renderRemoteVideoFrame(base64Data) {
    if (!this.remoteCanvasCtx) {
      this.initRemoteCanvas();
      return;
    }

    const canvas = this.remoteCanvas;
    const ctx = this.remoteCanvasCtx;

    // Create image from base64
    const img = canvas.createImage();
    img.onload = () => {
      // Clear and draw the new frame
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = 'data:image/jpeg;base64,' + base64Data;
  },

  onCameraError(e) {
    console.error('Camera error:', e);
    wx.showToast({ title: '摄像头错误', icon: 'none' });
  },

  onTapAccept() {
    const callId = this.data.callId;
    if (!callId) return;

    this.setStatus('accepted', '接听中…');
    api
      .acceptCall(callId)
      .then(() => this.startRealtimeAudio())
      .catch((err) => {
        console.error('Accept call failed:', err);
        wx.showToast({ title: '接听失败', icon: 'none' });
        this.setStatus('failed', '接听失败');
      });
  },

  onTapReject() {
    const callId = this.data.callId;
    if (!callId) return;

    this.setStatus('ended', '已拒绝');
    api.clearActiveCall();
    api
      .rejectCall(callId)
      .catch(() => null)
      .then(() => wx.navigateBack());
  },

  onTapCancel() {
    const callId = this.data.callId;
    if (!callId) return;

    this.setStatus('ended', '已取消');
    api.clearActiveCall();
    api
      .cancelCall(callId)
      .catch(() => null)
      .then(() => wx.navigateBack());
  },

  onTapHangup() {
    const callId = this.data.callId;
    if (!callId) return;

    this.setStatus('ended', '挂断中…');
    api.clearActiveCall();

    Promise.resolve()
      .then(() => this.stopRealtimeAudio())
      .then(() => api.endCall(callId))
      .catch(() => null)
      .then(() => wx.navigateBack());
  },
});

