import createBus from './utils/eventBus';

const api = require('./utils/linkbridge/api');

function getCurrentRoute() {
  try {
    const pages = getCurrentPages();
    const cur = pages[pages.length - 1];
    return cur?.route || '';
  } catch (e) {
    return '';
  }
}

function getCurrentChatSessionId() {
  try {
    const pages = getCurrentPages();
    const cur = pages[pages.length - 1];
    if (cur?.route !== 'pages/chat/index') return '';
    return cur?.data?.sessionId || cur?.options?.sessionId || '';
  } catch (e) {
    return '';
  }
}

let wsRegistered = false;
const WECHAT_BIND_TS_KEY = 'lb_wechat_bound_at_ms_v1';

App({
  globalData: {
    unreadNum: 0,
    unreadBySession: {},
  },

  /** 全局事件总线（custom-tab-bar 依赖） */
  eventBus: createBus(),

  onLaunch() {
    const updateManager = wx.getUpdateManager();
    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: '更新提示',
        content: '新版本已经准备好，是否重启应用？',
        success(res) {
          if (res.confirm) updateManager.applyUpdate();
        },
      });
    });
  },

  onShow() {
    if (!api.isLoggedIn()) return;

    api.connectWebSocket();
    if (wsRegistered) return;
    wsRegistered = true;

    // Best effort: keep WeChat session bound for VoIP signature.
    try {
      const lastBindAt = Number(wx.getStorageSync(WECHAT_BIND_TS_KEY) || 0);
      const now = Date.now();
      if (!Number.isFinite(lastBindAt) || now - lastBindAt > 12 * 60 * 60 * 1000) {
        api
          .bindWeChatSession()
          .catch(() => null)
          .then(() => wx.setStorageSync(WECHAT_BIND_TS_KEY, Date.now()));
      }
    } catch (e) {
      // ignore
    }

    api.addWebSocketHandler((env) => {
      if (env?.type !== 'message.created') return;

      const msg = env?.payload?.message;
      const sid = msg?.sessionId || '';

      // Best-effort unread badge: if user is currently in the same chat session, don't increment.
      const route = getCurrentRoute();
      if (route === 'pages/chat/index') {
        const openSid = getCurrentChatSessionId();
        if (openSid && sid && openSid === sid) return;
      }

      this.incrementSessionUnread(sid, 1);
    });

    api.addWebSocketHandler((env) => {
      if (env?.type !== 'call.invite') return;

      const call = env?.payload?.call;
      const callId = call?.id || '';
      if (!callId) return;

      const callerName = env?.payload?.caller?.displayName || '对方';

      wx.showModal({
        title: '语音通话',
        content: `${callerName} 邀请你语音通话`,
        confirmText: '接听',
        cancelText: '拒绝',
        success: (res) => {
          if (res.confirm) {
            const url =
              `/pages/call/index?callId=${encodeURIComponent(callId)}` +
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

  /** 设置未读消息数量（用于 TabBar badge） */
  setUnreadNum(unreadNum) {
    this.globalData.unreadNum = unreadNum;
    this.eventBus.emit('unread-num-change', unreadNum);
  },

  recalcUnreadNum() {
    const map = this.globalData.unreadBySession || {};
    let total = 0;
    Object.keys(map).forEach((k) => {
      const n = Number(map[k] || 0) || 0;
      if (n > 0) total += n;
    });
    this.setUnreadNum(total);
  },

  setSessionUnread(sessionId, count) {
    const sid = String(sessionId || '').trim();
    if (!sid) return;

    const map = this.globalData.unreadBySession || {};
    const next = Number(count || 0) || 0;
    if (next > 0) map[sid] = next;
    else delete map[sid];
    this.globalData.unreadBySession = map;
    this.recalcUnreadNum();
  },

  incrementSessionUnread(sessionId, delta = 1) {
    const sid = String(sessionId || '').trim();
    if (!sid) return;
    const map = this.globalData.unreadBySession || {};
    const cur = Number(map[sid] || 0) || 0;
    const next = Math.max(0, cur + (Number(delta || 0) || 0));
    if (next > 0) map[sid] = next;
    else delete map[sid];
    this.globalData.unreadBySession = map;
    this.recalcUnreadNum();
  },
});
