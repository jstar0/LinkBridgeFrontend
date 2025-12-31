const api = require('../../utils/linkbridge/api');

Page({
  data: {
    isLoggedIn: false,
    me: { id: '', username: '', displayName: '' },
    serverUrl: '',
    serverPopupVisible: false,
    serverUrlInput: '',
  },

  onShow() {
    const loggedIn = api.isLoggedIn();

    const currentServer = api.getBaseUrl();

    this.setData({ isLoggedIn: loggedIn, serverUrl: currentServer });
    if (!loggedIn) return;

    api
      .getMe()
      .then((me) => {
        api.setUser(me);
        this.setData({ me: me || { id: '', username: '', displayName: '' } });
      })
      .catch(() => null);
  },

  onTapLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onTapLogout() {
    wx.showLoading({ title: '退出中...' });
    api
      .logout()
      .catch(() => null)
      .then(() => {
        wx.hideLoading();
        wx.reLaunch({ url: '/pages/login/login' });
      });
  },

  onTapServer() {
    const current = api.getBaseUrl();
    this.setData({ serverPopupVisible: true, serverUrlInput: current });
  },

  onCloseServerPopup() {
    this.setData({ serverPopupVisible: false });
  },

  onServerPopupVisibleChange(e) {
    this.setData({ serverPopupVisible: !!e?.detail?.visible });
  },

  onServerUrlChange(e) {
    const value = e?.detail?.value || '';
    this.setData({ serverUrlInput: value });
  },

  onSaveServerUrl() {
    const next = (this.data.serverUrlInput || '').trim().replace(/\/+$/, '');
    if (!next) {
      wx.showToast({ title: '请输入地址', icon: 'none' });
      return;
    }
    if (!/^https?:\/\//i.test(next)) {
      wx.showToast({ title: '需以 http(s):// 开头', icon: 'none' });
      return;
    }

    try {
      wx.setStorageSync('lb_base_url', next);
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
      return;
    }

    // Apply immediately for subsequent requests; also close WS so next connect uses the new URL.
    api.closeWebSocket();
    this.setData({ serverUrl: next, serverPopupVisible: false });
    wx.showToast({ title: '已保存', icon: 'none' });
  },
});
