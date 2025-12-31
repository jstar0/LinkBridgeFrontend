const api = require('../../utils/linkbridge/api');

Page({
  data: {
    isLoggedIn: false,
    me: { id: '', username: '', displayName: '' },
    qrUrl: '',
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
