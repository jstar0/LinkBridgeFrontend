const api = require('../../../utils/linkbridge/api');

function getInputValue(e) {
  if (!e) return '';
  if (e.detail && typeof e.detail.value === 'string') return e.detail.value;
  if (typeof e.detail === 'string') return e.detail;
  return '';
}

function computeCanSubmit(username, password) {
  const u = (username || '').trim();
  const p = password || '';
  return u.length > 0 && p.length > 0;
}

Page({
  data: {
    username: '',
    password: '',
    showPassword: false,
    loading: false,
    canSubmit: false,
    errorMessage: '',
  },

  onLoad() {
    if (api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/linkbridge/dashboard/dashboard' });
    }
  },

  onUsernameChange(e) {
    const username = getInputValue(e);
    const password = this.data.password || '';
    this.setData({ username, errorMessage: '', canSubmit: computeCanSubmit(username, password) });
  },

  onPasswordChange(e) {
    const password = getInputValue(e);
    const username = this.data.username || '';
    this.setData({ password, errorMessage: '', canSubmit: computeCanSubmit(username, password) });
  },

  onTogglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  onTapLogin() {
    const { username, password, loading } = this.data;
    if (loading) return;

    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      this.setData({ errorMessage: '请输入用户名和密码' });
      return;
    }

    this.setData({ loading: true, errorMessage: '' });

    api
      .login(trimmedUsername, password)
      .then(() => {
        wx.reLaunch({ url: '/pages/linkbridge/dashboard/dashboard' });
      })
      .catch((err) => {
        let message = '登录失败';
        if (err.code === 'INVALID_CREDENTIALS') {
          message = '用户名或密码错误';
        } else if (err.code === 'network') {
          message = '网络错误，请检查网络连接';
        } else if (err.message) {
          message = err.message;
        }
        this.setData({ errorMessage: message, loading: false });
      });
  },

  onTapRegister() {
    wx.navigateTo({ url: '/pages/linkbridge/register/register' });
  },
});
