const api = require('../../utils/linkbridge/api');

Page({
  data: {
    isLoggedIn: false,
    me: { id: '', username: '', displayName: '' },
    qrUrl: '',
    serverPopupVisible: false,
    serverUrlInput: '',
  },

  onShow() {
    const loggedIn = api.isLoggedIn();
    this.setData({ isLoggedIn: loggedIn, qrUrl: loggedIn ? api.getMySessionQrImageUrl(Date.now()) : '' });
    if (!loggedIn) return;

    api
      .getMe()
      .then((me) => {
        api.setUser(me);
        this.setData({ me: me || { id: '', username: '', displayName: '' } });
      })
      .catch(() => null);

    // If user scanned someone else's code while not logged in, consume it after login.
    try {
      const pending = wx.getStorageSync('lb_pending_invite_code') || '';
      if (pending) {
        wx.removeStorageSync('lb_pending_invite_code');
        wx.navigateTo({ url: `/pages/invite/index?c=${encodeURIComponent(pending)}` });
      }
    } catch (e) {
      // ignore
    }
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
    let current = 'http://localhost:8080';
    try {
      current = wx.getStorageSync('lb_base_url') || current;
    } catch (e) {
      // ignore
    }
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

    // The api module reads BASE_URL at load time, so a relaunch is the simplest way to apply the new value everywhere.
    wx.showToast({ title: '已保存，将重启应用', icon: 'none' });
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/login/login' });
    }, 400);
  },

  onTapScan() {
    if (typeof wx?.scanCode !== 'function') {
      wx.showToast({ title: '当前环境不支持扫码', icon: 'none' });
      return;
    }

    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: (res) => {
        const path = res?.path || '';
        if (path) {
          const url = path.startsWith('/') ? path : `/${path}`;
          wx.navigateTo({ url });
          return;
        }
        wx.showToast({ title: '请扫描小程序码', icon: 'none' });
      },
      fail: () => {
        wx.showToast({ title: '已取消', icon: 'none' });
      },
    });
  },
});
