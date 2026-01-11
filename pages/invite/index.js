const api = require('../../utils/linkbridge/api');

function parseCode(options) {
  const direct = (options?.c || options?.code || '').trim();
  if (direct) return direct;

  const sceneRaw = options?.scene || '';
  const scene = decodeURIComponent(sceneRaw);
  if (!scene) return '';

  const parts = scene.split('&').map((p) => p.trim()).filter(Boolean);
  const found = parts.find((p) => p.startsWith('c='));
  if (found) return found.slice(2).trim();
  return scene.trim();
}

Page({
  data: {
    loading: false,
    errorMessage: '',
  },

  onLoad(options) {
    const code = parseCode(options);
    if (!code) {
      this.setData({ errorMessage: '无效微信码' });
      return;
    }

    if (!api.isLoggedIn()) {
      try {
        wx.setStorageSync('lb_pending_invite_code', code);
      } catch (e) {
        // ignore
      }
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    this.consume(code);
  },

  consume(code) {
    this.setData({ loading: true, errorMessage: '' });

    api
      .consumeSessionInvite(code)
      .then((res) => {
        const session = res?.session;
        const needsReactivation = res?.needsReactivation;

        if (!session?.id) {
          this.setData({ loading: false, errorMessage: '建立会话失败' });
          return;
        }

        // If session is archived, reactivate it
        if (needsReactivation) {
          return api.reactivateSession(session.id).then((reactivatedSession) => {
            return reactivatedSession || session;
          });
        }

        return session;
      })
      .then((session) => {
        if (!session?.id) return;

        const peerName = session?.peer?.displayName || '';
        const peerUserId = session?.peer?.id || '';
        const url =
          `/pages/chat/index?sessionId=${encodeURIComponent(session.id)}` +
          (peerName ? `&peerName=${encodeURIComponent(peerName)}` : '') +
          (peerUserId ? `&peerUserId=${encodeURIComponent(peerUserId)}` : '');
        wx.redirectTo({ url });
      })
      .catch((err) => {
        const code = err?.code || '';
        let msg = err?.message || '建立会话失败';
        if (code === 'SESSION_INVITE_INVALID') msg = '微信码已失效，请让对方重新生成微信码';
        if (code === 'TOKEN_INVALID' || code === 'TOKEN_EXPIRED') msg = '请先登录';
        this.setData({ loading: false, errorMessage: msg });
      });
  },
});

