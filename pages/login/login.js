const api = require('../../utils/linkbridge/api');

function getInputValue(e) {
  if (!e) return '';
  if (e.detail && typeof e.detail.value === 'string') return e.detail.value;
  if (typeof e.detail === 'string') return e.detail;
  return '';
}

function computeCanSubmit(mode, username, displayName, password) {
  const u = (username || '').trim();
  const dn = (displayName || '').trim();
  const p = password || '';
  if (!u || !p) return false;
  if (mode === 'register' && !dn) return false;
  return true;
}

Page({
  data: {
    mode: 'login', // login | register
    username: '',
    displayName: '',
    password: '',
    loading: false,
    canSubmit: false,
    errorMessage: '',
  },

  onShow() {
    if (api.isLoggedIn()) {
      wx.switchTab({ url: '/pages/my/index' });
    }
  },

  toggleMode() {
    const next = this.data.mode === 'login' ? 'register' : 'login';
    const canSubmit = computeCanSubmit(next, this.data.username, this.data.displayName, this.data.password);
    this.setData({ mode: next, canSubmit, errorMessage: '' });
  },

  onUsernameChange(e) {
    const username = getInputValue(e);
    this.setData({
      username,
      errorMessage: '',
      canSubmit: computeCanSubmit(this.data.mode, username, this.data.displayName, this.data.password),
    });
  },

  onDisplayNameChange(e) {
    const displayName = getInputValue(e);
    this.setData({
      displayName,
      errorMessage: '',
      canSubmit: computeCanSubmit(this.data.mode, this.data.username, displayName, this.data.password),
    });
  },

  onPasswordChange(e) {
    const password = getInputValue(e);
    this.setData({
      password,
      errorMessage: '',
      canSubmit: computeCanSubmit(this.data.mode, this.data.username, this.data.displayName, password),
    });
  },

  onSubmit() {
    if (this.data.loading) return;

    const username = (this.data.username || '').trim();
    const password = this.data.password || '';
    const displayName = (this.data.displayName || '').trim();

    if (!computeCanSubmit(this.data.mode, username, displayName, password)) {
      this.setData({ errorMessage: '请填写完整信息' });
      return;
    }

    this.setData({ loading: true, errorMessage: '' });

    const action =
      this.data.mode === 'login' ? api.login(username, password) : api.register(username, password, displayName);

    action
      .then(() => {
        // If user scanned an invite before login, handle it immediately.
        try {
          const pending = wx.getStorageSync('lb_pending_invite_code') || '';
          if (pending) {
            wx.removeStorageSync('lb_pending_invite_code');
            wx.showLoading({ title: '处理中...' });
            api
              .consumeSessionInvite(pending)
              .then(() => {
                wx.hideLoading();
                wx.showToast({ title: '已发送会话请求', icon: 'none' });
                wx.switchTab({ url: '/pages/message/index' });
              })
              .catch((err) => {
                wx.hideLoading();
                const msg = err?.message || '处理失败';
                wx.showToast({ title: msg, icon: 'none' });
                wx.switchTab({ url: '/pages/my/index' });
              });
            return;
          }
        } catch (e) {
          // ignore
        }

        wx.switchTab({ url: '/pages/my/index' });
      })
      .catch((err) => {
        let message = this.data.mode === 'login' ? '登录失败' : '注册失败';
        if (err?.code === 'INVALID_CREDENTIALS') message = '用户名或密码错误';
        if (err?.code === 'USERNAME_EXISTS') message = '用户名已存在';
        if (err?.code === 'network') message = '网络错误，请检查网络连接';
        if (err?.message) message = err.message;
        this.setData({ errorMessage: message, loading: false });
      });
  },
});
