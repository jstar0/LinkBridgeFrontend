const api = require('../../../utils/linkbridge/api');

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
    const username = e.detail.value || '';
    this.setData({ username, errorMessage: '' });
    this.updateCanSubmit();
  },

  onPasswordChange(e) {
    const password = e.detail.value || '';
    this.setData({ password, errorMessage: '' });
    this.updateCanSubmit();
  },

  onTogglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  updateCanSubmit() {
    const { username, password } = this.data;
    const canSubmit = username.trim().length > 0 && password.length > 0;
    this.setData({ canSubmit });
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
