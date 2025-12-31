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

function joinVoip(params) {
  return new Promise((resolve, reject) => {
    if (typeof wx?.joinVoIPChat !== 'function') {
      reject({ code: 'unsupported', message: 'wx.joinVoIPChat not available' });
      return;
    }

    wx.joinVoIPChat({
      roomType: params.roomType || 'voice',
      signature: params.signature,
      nonceStr: params.nonceStr,
      timeStamp: params.timeStamp,
      groupId: params.groupId,
      success(res) {
        resolve(res);
      },
      fail(err) {
        reject({ code: 'join_failed', message: err?.errMsg || 'join failed', detail: err });
      },
    });
  });
}

function exitVoip() {
  return new Promise((resolve) => {
    if (typeof wx?.exitVoIPChat !== 'function') {
      resolve({ skipped: true });
      return;
    }
    wx.exitVoIPChat({
      complete() {
        resolve({ exited: true });
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
  },

  wsHandler: null,

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
  },

  onTapBack() {
    wx.navigateBack();
  },

  setupWebSocket(callId) {
    if (!callId) return;

    this.wsHandler = (data) => {
      const envCall = data?.payload?.call;
      if (!envCall || envCall.id !== callId) return;

      if (data.type === 'call.accepted') {
        if (!this.data.incoming) {
          this.setStatus('accepted', '对方已接听，正在接入…');
          this.joinAfterAccepted();
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
    const callId = this.data.callId;
    if (!callId) return;

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
      .then(() =>
        api.getVoipSign(callId).catch((err) => {
          if (err?.code === 'WECHAT_NOT_BOUND') {
            return api.bindWeChatSession().then(() => api.getVoipSign(callId));
          }
          throw err;
        })
      )
      .then((res) => {
        const attemptJoin = (payload, retried) =>
          joinVoip({
            roomType: payload.roomType,
            groupId: payload.groupId,
            nonceStr: payload.nonceStr,
            timeStamp: payload.timeStamp,
            signature: payload.signature,
          }).catch((err) => {
            if (retried) throw err;
            return api
              .bindWeChatSession()
              .then(() => api.getVoipSign(callId))
              .then((next) => attemptJoin(next, true));
          });

        return attemptJoin(res, false);
      })
      .then(() => {
        this.setStatus('in_call', '通话中');
      })
      .catch((err) => {
        console.error('Failed to join VoIP:', err);
        wx.showToast({ title: '进入通话失败', icon: 'none' });
        this.setStatus('failed', '进入通话失败');
      });
  },

  onTapAccept() {
    const callId = this.data.callId;
    if (!callId) return;

    this.setStatus('accepted', '接听中…');
    api
      .acceptCall(callId)
      .then(() => this.joinAfterAccepted())
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

    Promise.resolve()
      .then(() => exitVoip())
      .then(() => api.endCall(callId))
      .catch(() => null)
      .then(() => wx.navigateBack());
  },
});

