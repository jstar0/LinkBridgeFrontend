import gulpError from './utils/gulpError';

const api = require('./utils/linkbridge/api');

let callHandlerRegistered = false;
let lastInviteCallId = '';

const SUBSCRIBE_PROMPTED_KEY = 'lb_call_subscribe_prompted_v1';
const WECHAT_BIND_TS_KEY = 'lb_wechat_bound_at_ms_v1';

function safeGetStorageSync(key) {
  try {
    return wx.getStorageSync(key);
  } catch (e) {
    return null;
  }
}

function safeSetStorageSync(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

App({
  onShow() {
    if (gulpError !== 'gulpErrorPlaceHolder') {
      wx.redirectTo({
        url: `/pages/gulp-error/index?gulpError=${gulpError}`,
      });
      return;
    }

    if (!api.isLoggedIn()) return;
    api.connectWebSocket();

    // Best effort: keep WeChat session bound for VoIP signature / offline subscribe messages.
    const lastBindAt = Number(safeGetStorageSync(WECHAT_BIND_TS_KEY) || 0);
    const now = Date.now();
    if (!Number.isFinite(lastBindAt) || now-lastBindAt > 12 * 60 * 60 * 1000) {
      api
        .bindWeChatSession()
        .catch(() => null)
        .then(() => safeSetStorageSync(WECHAT_BIND_TS_KEY, Date.now()));
    }

    // Best effort: ask each user once to enable call notifications (subscribe message).
    const prompted = !!safeGetStorageSync(SUBSCRIBE_PROMPTED_KEY);
    if (!prompted) {
      api
        .requestCallSubscribePermission()
        .catch(() => null)
        .then(() => safeSetStorageSync(SUBSCRIBE_PROMPTED_KEY, true));
    }

    if (callHandlerRegistered) return;
    callHandlerRegistered = true;

    api.addWebSocketHandler((data) => {
      if (data?.type !== 'call.invite') return;

      const call = data?.payload?.call;
      const callId = call?.id || '';
      if (!callId) return;
      if (callId === lastInviteCallId) return;
      lastInviteCallId = callId;

      const callerName = data?.payload?.caller?.displayName || '对方';

      wx.showModal({
        title: '语音通话',
        content: `${callerName} 邀请你语音通话`,
        confirmText: '接听',
        cancelText: '拒绝',
        success: (res) => {
          if (res.confirm) {
            const url =
              `/pages/linkbridge/call/call?callId=${encodeURIComponent(callId)}` +
              `&incoming=1&autoAccept=1` +
              (callerName ? `&peerName=${encodeURIComponent(callerName)}` : '');
            wx.navigateTo({ url });
          } else if (res.cancel) {
            api.rejectCall(callId).catch(() => null);
          }
        },
      });
    });
  },
});
