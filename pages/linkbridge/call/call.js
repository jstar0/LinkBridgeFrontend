const api = require('../../../utils/linkbridge/api');

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

function buildViewState({ status, incoming }) {
  const showAccept = incoming && status === 'incoming';
  const showReject = incoming && status === 'incoming';
  const showCancel = !incoming && (status === 'outgoing' || status === 'ringing');
  const showHangup = status === 'in_call';

  return { showAccept, showReject, showCancel, showHangup };
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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
    callDuration: '00:00',
  },

  wsHandler: null,
  recorder: null,
  audioQueue: [],
  currentAudio: null,
  isPlaying: false,
  durationTimer: null,
  durationSeconds: 0,

  onLoad(query) {
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/linkbridge/login/login' });
      return;
    }

    const currentUser = api.getUser();
    const currentUserId = currentUser?.id || '';
    const callId = query?.callId || '';
    const peerUserId = query?.peerUserId || '';
    const incoming = query?.incoming === '1' || query?.incoming === 'true';
    const autoAccept = query?.autoAccept === '1' || query?.autoAccept === 'true';
    const mediaType = query?.mediaType || 'voice';
    const peerDisplayName = query?.peerName || '';
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
    this.stopRecording();
    this.stopPlayback();
    this.stopDurationTimer();
    if (this.wsHandler) {
      api.removeWebSocketHandler(this.wsHandler);
      this.wsHandler = null;
    }
  },

  onTapBack() {
    wx.navigateBack();
  },

  setupWebSocket(callId) {
    if (!callId) return;

    this.wsHandler = (data) => {
      if (data.type === 'audio.frame') {
        const payload = data?.payload;
        if (payload?.callId === callId && payload?.data) {
          this.handleAudioFrame(payload.data);
        }
        return;
      }

      const envCall = data?.payload?.call;
      if (!envCall || envCall.id !== callId) return;

      if (data.type === 'call.accepted') {
        if (!this.data.incoming) {
          this.setStatus('accepted', '对方已接听，正在接入…');
          this.startCall();
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

        if (call?.status === 'accepted') {
          this.setStatus('accepted', '正在接入…');
          this.startCall();
          return;
        }

        if (['ended', 'canceled', 'rejected'].includes(call?.status)) {
          wx.showToast({ title: '通话已结束', icon: 'none' });
          wx.navigateBack();
          return;
        }

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

  startCall() {
    const callId = this.data.callId;
    if (!callId) return;

    ensurePermission('scope.record')
      .catch(() =>
        showModal({
          title: '需要麦克风权限',
          content: '请在设置中允许使用麦克风后重试',
          confirmText: '去设置',
          cancelText: '取消',
        }).then((res) => (res.confirm ? openSettings() : Promise.reject(new Error('permission denied'))))
      )
      .then(() => {
        this.setStatus('in_call', '通话中');
        this.startDurationTimer();
        this.startRecording();
      })
      .catch((err) => {
        console.error('Failed to start call:', err);
        wx.showToast({ title: '启动通话失败', icon: 'none' });
        this.setStatus('failed', '启动失败');
      });
  },

  startRecording() {
    if (typeof wx?.getRecorderManager !== 'function') {
      console.error('RecorderManager not available');
      return;
    }

    this.recorder = wx.getRecorderManager();
    const callId = this.data.callId;

    this.recorder.onFrameRecorded((res) => {
      if (!res?.frameBuffer || this.data.status !== 'in_call') return;
      const base64 = wx.arrayBufferToBase64(res.frameBuffer);
      api.sendWebSocketMessage({
        type: 'audio.frame',
        callId: callId,
        data: base64,
      });
    });

    this.recorder.onError((err) => {
      console.error('Recorder error:', err);
    });

    this.recorder.start({
      format: 'mp3',
      sampleRate: 16000,
      encodeBitRate: 48000,
      frameSize: 1,
    });
  },

  stopRecording() {
    if (this.recorder) {
      this.recorder.stop();
      this.recorder = null;
    }
  },

  handleAudioFrame(base64Data) {
    this.audioQueue.push(base64Data);
    if (this.audioQueue.length >= 3 && !this.isPlaying) {
      this.playNextAudio();
    }
  },

  playNextAudio() {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const base64Data = this.audioQueue.shift();

    const fs = wx.getFileSystemManager();
    const tempPath = `${wx.env.USER_DATA_PATH}/audio_${Date.now()}.mp3`;

    try {
      fs.writeFileSync(tempPath, base64Data, 'base64');
    } catch (e) {
      console.error('Write audio file failed:', e);
      this.playNextAudio();
      return;
    }

    if (this.currentAudio) {
      this.currentAudio.destroy();
    }

    this.currentAudio = wx.createInnerAudioContext();
    this.currentAudio.src = tempPath;

    this.currentAudio.onEnded(() => {
      try {
        fs.unlinkSync(tempPath);
      } catch (e) {}
      this.playNextAudio();
    });

    this.currentAudio.onError((err) => {
      console.error('Audio play error:', err);
      try {
        fs.unlinkSync(tempPath);
      } catch (e) {}
      this.playNextAudio();
    });

    this.currentAudio.play();
  },

  stopPlayback() {
    this.audioQueue = [];
    this.isPlaying = false;
    if (this.currentAudio) {
      this.currentAudio.stop();
      this.currentAudio.destroy();
      this.currentAudio = null;
    }
  },

  startDurationTimer() {
    this.durationSeconds = 0;
    this.durationTimer = setInterval(() => {
      this.durationSeconds++;
      this.setData({ callDuration: formatDuration(this.durationSeconds) });
    }, 1000);
  },

  stopDurationTimer() {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
  },

  onTapAccept() {
    const callId = this.data.callId;
    if (!callId) return;

    this.setStatus('accepted', '接听中…');
    api
      .acceptCall(callId)
      .then(() => this.startCall())
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
    api
      .rejectCall(callId)
      .catch(() => null)
      .then(() => wx.navigateBack());
  },

  onTapCancel() {
    const callId = this.data.callId;
    if (!callId) return;

    this.setStatus('ended', '已取消');
    api
      .cancelCall(callId)
      .catch(() => null)
      .then(() => wx.navigateBack());
  },

  onTapHangup() {
    const callId = this.data.callId;
    if (!callId) return;

    this.setStatus('ended', '挂断中…');
    this.stopRecording();
    this.stopPlayback();
    this.stopDurationTimer();

    api
      .endCall(callId)
      .catch(() => null)
      .then(() => wx.navigateBack());
  },
});
