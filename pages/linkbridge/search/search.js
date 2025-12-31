import themeChangeBehavior from 'tdesign-miniprogram/mixins/theme-change';

const api = require('../../../utils/linkbridge/api');

Page({
  behaviors: [themeChangeBehavior],
  data: {
    searchValue: '',
    users: [],
    loading: false,
    searched: false,
    hint: '',
    autoFocus: true,
  },

  onLoad(query) {
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/linkbridge/login/login' });
      return;
    }

    const q = query?.q || '';
    if (q) {
      this.setData({ searchValue: q, autoFocus: false });
      this.doSearch(q);
    }
  },

  onGoBack() {
    wx.navigateBack();
  },

  onSearchChange(e) {
    const nextValue = e?.detail?.value ?? '';
    this.setData({ searchValue: nextValue });
  },

  onSearchSubmit() {
    const query = this.data.searchValue.trim();
    if (query) {
      this.doSearch(query);
    }
  },

  doSearch(query) {
    this.setData({ loading: true, searched: false, users: [], hint: '' });

    api
      .searchUsers(query)
      .then((users) => {
        this.setData({
          users: users || [],
          loading: false,
          searched: true,
          hint: users.length === 0 ? '未找到匹配的用户' : '',
        });
      })
      .catch((err) => {
        console.error('Failed to search users:', err);
        this.setData({
          loading: false,
          searched: true,
          hint: '搜索失败，请重试',
        });
      });
  },

  onTapMessageUser(e) {
    const user = e?.currentTarget?.dataset?.user;
    if (!user?.id) return;

    wx.showLoading({ title: '创建会话...' });

    api
      .createSession(user.id)
      .then((result) => {
        wx.hideLoading();
        const session = result.session;
        wx.navigateTo({
          url:
            `/pages/linkbridge/chat/chat?sessionId=${encodeURIComponent(session.id)}` +
            `&peerName=${encodeURIComponent(session.peer.displayName)}` +
            `&peerUserId=${encodeURIComponent(user.id)}`,
        });
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('Failed to create session:', err);
        let message = '创建会话失败';
        if (err.code === 'CANNOT_CHAT_SELF') {
          message = '不能与自己建立会话';
        } else if (err.message) {
          message = err.message;
        }
        wx.showToast({ title: message, icon: 'none' });
      });
  },

  onTapAddFriend(e) {
    const user = e?.currentTarget?.dataset?.user;
    if (!user?.id) return;

    wx.showLoading({ title: '发送申请...' });
    api
      .requestFriend(user.id)
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已发送', icon: 'success' });
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('Failed to request friend:', err);
        let message = '发送失败';
        if (err.code === 'ALREADY_FRIENDS') message = '已是好友';
        if (err.code === 'FRIEND_REQUEST_EXISTS') message = '已发送/对方已申请';
        if (err.message) message = err.message;
        wx.showToast({ title: message, icon: 'none' });
      });
  },
});
