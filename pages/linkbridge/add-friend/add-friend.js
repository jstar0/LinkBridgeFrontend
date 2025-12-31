const api = require('../../../utils/linkbridge/api');

function parseScene(scene) {
  if (!scene) return {};
  const out = {};
  String(scene)
    .split('&')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((kv) => {
      const idx = kv.indexOf('=');
      if (idx < 0) return;
      const k = decodeURIComponent(kv.slice(0, idx));
      const v = decodeURIComponent(kv.slice(idx + 1));
      out[k] = v;
    });
  return out;
}

Page({
  data: {
    loading: true,
    title: '处理中',
    desc: '',
    showLogin: false,
  },

  onLoad(options) {
    const scene = options?.scene || '';
    const code = options?.c || parseScene(scene).c || '';

    if (!code) {
      this.setData({
        loading: false,
        title: '无效二维码',
        desc: '未识别到邀请码，请重新扫码。',
        showLogin: false,
      });
      return;
    }

    if (!api.isLoggedIn()) {
      try {
        wx.setStorageSync('lb_pending_invite_code', code);
      } catch (e) {
        // ignore
      }
      this.setData({
        loading: false,
        title: '需要登录',
        desc: '登录后将自动发送会话请求。',
        showLogin: true,
      });
      return;
    }

    api
      .consumeSessionInvite(code)
      .then(() => {
        this.setData({
          loading: false,
          title: '已发送会话请求',
          desc: '等待对方接受后即可开始聊天。',
          showLogin: false,
        });
      })
      .catch((err) => {
        this.setData({
          loading: false,
          title: '处理失败',
          desc: err?.message || '请稍后重试。',
          showLogin: false,
        });
      });
  },

  onGoLogin() {
    wx.reLaunch({ url: '/pages/login/login' });
  },

  onGoMessage() {
    wx.switchTab({ url: '/pages/message/index' });
  },
});

