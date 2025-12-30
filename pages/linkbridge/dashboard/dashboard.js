const themeChangeBehavior = require('tdesign-miniprogram/mixins/theme-change');
const api = require('../../../utils/linkbridge/api');

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function formatTimeText(timestampMs) {
  if (!timestampMs) return '';
  const date = new Date(timestampMs);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

Page({
  behaviors: [themeChangeBehavior],
  data: {
    searchValue: '',
    activeSessions: [],
    isConnectionModalVisible: false,
    loading: false,
    currentUser: null,
    myQrFabButtonProps: {
      theme: 'default',
      variant: 'outline',
    },
  },

  onLoad() {
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/linkbridge/login/login' });
      return;
    }
    this.loadCurrentUser();
    this.refreshSessions();
  },

  onShow() {
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/linkbridge/login/login' });
      return;
    }
    this.refreshSessions();
  },

  loadCurrentUser() {
    const cachedUser = api.getUser();
    if (cachedUser) {
      this.setData({ currentUser: cachedUser });
    }

    api
      .getMe()
      .then((user) => {
        api.setUser(user);
        this.setData({ currentUser: user });
      })
      .catch((err) => {
        console.error('Failed to load current user:', err);
      });
  },

  refreshSessions() {
    this.setData({ loading: true });
    api
      .listSessions('active')
      .then((sessions) => {
        const viewModels = sessions.map((s) => ({
          id: s.id,
          peer: s.peer,
          lastMessagePreview: s.lastMessageText || '',
          lastMessageAtMs: s.lastMessageAtMs,
          timeText: formatTimeText(s.lastMessageAtMs || s.updatedAtMs),
          status: s.status,
        }));
        this.setData({ activeSessions: viewModels, loading: false });
      })
      .catch((err) => {
        console.error('Failed to load sessions:', err);
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  onTapArchive() {
    wx.navigateTo({ url: '/pages/linkbridge/archive/archive' });
  },

  onSearchChange(e) {
    const nextValue = e?.detail?.value ?? '';
    this.setData({ searchValue: nextValue });
  },

  onSearchSubmit() {
    const query = this.data.searchValue.trim();
    if (query) {
      wx.navigateTo({ url: `/pages/linkbridge/search/search?q=${encodeURIComponent(query)}` });
    }
  },

  onTapSession(e) {
    const sessionId = e?.currentTarget?.dataset?.sessionId;
    if (!sessionId) return;

    const peer = e?.currentTarget?.dataset?.peer;
    const peerName = peer?.displayName || '';
    const url =
      `/pages/linkbridge/chat/chat?sessionId=${encodeURIComponent(sessionId)}` +
      (peerName ? `&peerName=${encodeURIComponent(peerName)}` : '');
    wx.navigateTo({ url });
  },

  onTapMyQr() {
    this.setData({ isConnectionModalVisible: true });
  },

  onCloseConnectionModal() {
    this.setData({ isConnectionModalVisible: false });
  },

  onConnectionModalVisibleChange(e) {
    this.setData({
      isConnectionModalVisible: e.detail.visible,
    });
  },

  onCopyUserId() {
    const userId = this.data.currentUser?.id;
    if (!userId) return;

    wx.setClipboardData({
      data: userId,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' });
      },
    });
  },

  onTapSearch() {
    wx.navigateTo({ url: '/pages/linkbridge/search/search' });
  },
});
