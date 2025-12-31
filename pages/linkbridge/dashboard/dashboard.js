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
    myFriendQrUrl: '',
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
    const peerUserId = peer?.id || '';
    const url =
      `/pages/linkbridge/chat/chat?sessionId=${encodeURIComponent(sessionId)}` +
      (peerName ? `&peerName=${encodeURIComponent(peerName)}` : '') +
      (peerUserId ? `&peerUserId=${encodeURIComponent(peerUserId)}` : '');
    wx.navigateTo({ url });
  },

  onTapMyQr() {
    this.setData({ isConnectionModalVisible: true, myFriendQrUrl: api.getMyFriendQrImageUrl(Date.now()) });
  },

  onCloseConnectionModal() {
    this.setData({ isConnectionModalVisible: false, myFriendQrUrl: '' });
  },

  onConnectionModalVisibleChange(e) {
    const visible = e?.detail?.visible;
    const patch = { isConnectionModalVisible: visible };
    if (visible) {
      patch.myFriendQrUrl = api.getMyFriendQrImageUrl(Date.now());
    } else {
      patch.myFriendQrUrl = '';
    }
    this.setData(patch);
  },

  onTapScanFriend() {
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

        // Fallback: try to treat res.result as an invite code or "c=xxxx".
        const result = (res?.result || '').trim();
        if (!result) {
          wx.showToast({ title: '扫码失败', icon: 'none' });
          return;
        }

        const cleaned = result.startsWith('c=') ? result.slice(2) : result;
        wx.navigateTo({ url: `/pages/linkbridge/add-friend/add-friend?c=${encodeURIComponent(cleaned)}` });
      },
      fail: () => {
        wx.showToast({ title: '已取消', icon: 'none' });
      },
    });
  },

  onTapSearch() {
    wx.navigateTo({ url: '/pages/linkbridge/search/search' });
  },
});
