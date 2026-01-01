import useToastBehavior from '~/behaviors/useToast';

const api = require('../../utils/linkbridge/api');
const { applyTabTransition } = require('../../utils/linkbridge/tab-transition');

const DEFAULT_SERVICE = [
  { image: '/static/icon_wx.png', name: '微信', type: 'weixin', url: '' },
  { image: '/static/icon_qq.png', name: 'QQ', type: 'QQ', url: '' },
  { image: '/static/icon_doc.png', name: '腾讯文档', type: 'document', url: '' },
  { image: '/static/icon_map.png', name: '腾讯地图', type: 'map', url: '' },
  { image: '/static/icon_td.png', name: '数据中心', type: 'data', url: '' },
  { image: '/static/icon_td.png', name: '数据中心', type: 'data', url: '' },
  { image: '/static/icon_td.png', name: '数据中心', type: 'data', url: '' },
  { image: '/static/icon_td.png', name: '数据中心', type: 'data', url: '' },
];

Page({
  behaviors: [useToastBehavior],

  data: {
    isLoad: false,
    service: DEFAULT_SERVICE,
    personalInfo: {},
    pageAnim: null,
    gridList: [
      { name: '全部发布', icon: 'root-list', type: 'all', url: '' },
      { name: '审核中', icon: 'search', type: 'progress', url: '' },
      { name: '已发布', icon: 'upload', type: 'published', url: '' },
      { name: '草稿箱', icon: 'file-copy', type: 'draft', url: '' },
    ],
    settingList: [
      { name: '联系客服', icon: 'service', type: 'service' },
      { name: '设置', icon: 'setting', type: 'setting', url: '' },
      { name: '退出登录', icon: 'logout', type: 'logout', url: '' },
    ],
  },

  onLoad() {},

  onShow() {
    applyTabTransition(this, 'my');
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
