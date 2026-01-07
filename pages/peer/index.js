const api = require('../../utils/linkbridge/api');

Page({
  data: {
    userId: '',
    loading: true,
    user: {
      id: '',
      username: '',
      displayName: '',
      avatarUrl: '',
    },
  },

  onLoad(options) {
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    const userId = String(options?.userId || '').trim();
    if (!userId) {
      wx.showToast({ title: '缺少用户信息', icon: 'none' });
      wx.navigateBack();
      return;
    }

    this.setData({ userId, loading: true });

    api
      .getUserById(userId)
      .then((u) => {
        this.setData({
          user: {
            id: u?.id || userId,
            username: u?.username || '',
            displayName: u?.displayName || '对方',
            avatarUrl: u?.avatarUrl || '',
          },
          loading: false,
        });
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },
});
