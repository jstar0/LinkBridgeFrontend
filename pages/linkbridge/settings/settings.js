import themeChangeBehavior from 'tdesign-miniprogram/mixins/theme-change';

const api = require('../../../utils/linkbridge/api');

Page({
  behaviors: [themeChangeBehavior],
  data: {
    currentUser: {},
    isEditDialogVisible: false,
    editDisplayName: '',
  },

  onLoad() {
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/linkbridge/login/login' });
      return;
    }
    this.loadCurrentUser();
  },

  onShow() {
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/linkbridge/login/login' });
      return;
    }
    this.loadCurrentUser();
  },

  loadCurrentUser() {
    const cachedUser = api.getUser();
    console.log('[settings] cachedUser:', cachedUser);
    if (cachedUser) {
      this.setData({ currentUser: cachedUser });
    }

    api
      .getMe()
      .then((user) => {
        console.log('[settings] getMe response:', user);
        api.setUser(user);
        this.setData({ currentUser: user });
      })
      .catch((err) => {
        console.error('[settings] Failed to load current user:', err);
      });
  },

  onTapEditDisplayName() {
    this.setData({
      isEditDialogVisible: true,
      editDisplayName: this.data.currentUser?.displayName || '',
    });
  },

  onEditDialogVisibleChange(e) {
    this.setData({ isEditDialogVisible: !!e?.detail?.visible });
  },

  onEditDisplayNameChange(e) {
    this.setData({ editDisplayName: e?.detail?.value ?? '' });
  },

  onConfirmEditDisplayName() {
    const newName = this.data.editDisplayName.trim();
    if (!newName) {
      wx.showToast({ title: '显示名称不能为空', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...' });
    api
      .updateDisplayName(newName)
      .then((user) => {
        wx.hideLoading();
        api.setUser(user);
        this.setData({
          currentUser: user,
          isEditDialogVisible: false,
        });
        wx.showToast({ title: '已保存', icon: 'success' });
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('Failed to update display name:', err);
        wx.showToast({ title: '保存失败', icon: 'none' });
      });
  },

  onTapLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          this.doLogout();
        }
      },
    });
  },

  doLogout() {
    wx.showLoading({ title: '退出中...' });
    api
      .logout()
      .then(() => {
        wx.hideLoading();
        api.clearAuth();
        wx.reLaunch({ url: '/pages/linkbridge/login/login' });
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('Failed to logout:', err);
        api.clearAuth();
        wx.reLaunch({ url: '/pages/linkbridge/login/login' });
      });
  },
});
