import useToastBehavior from '~/behaviors/useToast';

const api = require('../../utils/linkbridge/api');

Page({
  behaviors: [useToastBehavior],

  data: {
    isLoad: false,
    personalInfo: {},
    settingList: [
      { name: '个人主页', icon: 'user-circle', type: 'profile', url: '/pages/my/profile-publish/index' },
      { name: '联系客服', icon: 'service', type: 'service' },
      { name: '设置', icon: 'setting', type: 'setting', url: '' },
      { name: '退出登录', icon: 'logout', type: 'logout', url: '' },
    ],
  },

  onLoad() {},

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && typeof tabBar.setActive === 'function') tabBar.setActive('my');

    if (!api.isLoggedIn()) {
      this.setData({ isLoad: false, personalInfo: {} });
      return;
    }

    api
      .getMe()
      .then((me) => {
        const username = me?.username || '';
        const displayName = me?.displayName || '用户';
        const avatarUrl = me?.avatarUrl || '/static/avatar1.png';

        this.setData({
          isLoad: true,
          personalInfo: {
            image: avatarUrl,
            name: displayName,
            star: username ? `@${username}` : ' ',
            city: 'LinkBridge',
          },
        });
      })
      .catch(() => {
        this.setData({ isLoad: false, personalInfo: {} });
      });
  },

  onLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onNavigateTo() {
    if (!api.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    wx.navigateTo({ url: '/pages/my/info-edit/index' });
  },

  onEleClick(e) {
    const { name, url, type } = e?.currentTarget?.dataset?.data || {};
    if (type === 'logout') {
      wx.showLoading({ title: '退出中...' });
      api
        .logout()
        .catch(() => null)
        .then(() => {
          wx.hideLoading();
          wx.reLaunch({ url: '/pages/login/login' });
        });
      return;
    }

    if (url) {
      wx.navigateTo({ url });
      return;
    }
    this.onShowToast('#t-toast', name || '暂未开放');
  },
});
