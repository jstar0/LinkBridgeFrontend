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
  playingAudio: null,
  playQueue: [],
  playIndex: 0,
  currentPlayPath: '',
  startedAudio: false,
  // Jitter buffer: accumulate frames before playing
  jitterBuffer: [],
  jitterBufferSize: 3, // Wait for 3 frames before starting playback
  jitterBufferStarted: false,
  // Batch merge: combine multiple frames into one file
  batchSize: 4, // Merge 4 frames into one WAV file
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
    this.setData({ muted: !this.data.muted });
    // TODO: Implement actual mute logic
  },

  onToggleSpeaker() {
    this.setData({ speakerOn: !this.data.speakerOn });
    // TODO: Implement actual speaker toggle logic
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
          const b64 = wx.arrayBufferToBase64(buf);
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
    this.jitterBufferStarted = false;

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

    if (this.playingAudio) {
      try {
        this.playingAudio.stop();
        this.playingAudio.destroy();
      } catch (e) {
        // ignore
      }
      this.playingAudio = null;
    }

    // best-effort cleanup current file
    const cur = this.currentPlayPath;
    this.currentPlayPath = '';
    if (cur) {
      try {
        wx.getFileSystemManager().unlink({ filePath: cur });
      } catch (e) {
        // ignore
      }
    }

    this.playQueue = [];
    return Promise.resolve();
  },

  enqueueIncomingAudioFrame(base64Data) {
    // Add to jitter buffer first
    this.jitterBuffer.push(base64Data);

    // Wait until we have enough frames to start (jitter buffer)
    if (!this.jitterBufferStarted) {
      if (this.jitterBuffer.length < this.jitterBufferSize) {
        return; // Keep buffering
      }
      this.jitterBufferStarted = true;
    }

    // Batch merge: wait for batchSize frames before writing
    if (this.jitterBuffer.length < this.batchSize) {
      return;
    }

    // Take batchSize frames and merge them
    const framesToMerge = this.jitterBuffer.splice(0, this.batchSize);
    this.writeMergedAudioFrames(framesToMerge);
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
        encoding: 'binary',
        success: () => {
          this.playQueue.push(filePath);
          this.kickPlayQueue();
        },
        fail: () => null,
      });
    } catch (e) {
      // ignore
    }
  },

  kickPlayQueue() {
    if (!this.startedAudio) return;

    if (!this.playingAudio) {
      this.playingAudio = wx.createInnerAudioContext();
      this.playingAudio.autoplay = false;
      this.playingAudio.onEnded(() => {
        const done = this.currentPlayPath;
        this.currentPlayPath = '';
        if (done) {
          try {
            wx.getFileSystemManager().unlink({ filePath: done });
          } catch (e) {
            // ignore
          }
        }
        this.kickPlayQueue();
      });
      this.playingAudio.onError(() => {
        // drop current and continue
        this.kickPlayQueue();
      });
    }

    if (this.currentPlayPath) return;
    const next = this.playQueue.shift();
    if (!next) return;

    this.currentPlayPath = next;
    try {
      this.playingAudio.src = next;
      this.playingAudio.play();
    } catch (e) {
      this.currentPlayPath = '';
    }
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

