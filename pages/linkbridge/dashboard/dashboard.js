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
    myQrFabButtonProps: {
      theme: 'default',
      variant: 'outline',
    },
  },

  onLoad() {
    this.refreshSessions();
  },

  onShow() {
    this.refreshSessions();
  },

  refreshSessions() {
    this.setData({ loading: true });
    api
      .listSessions('active')
      .then((sessions) => {
        const viewModels = sessions.map((s) => ({
          id: s.id,
          peerName: s.peerName,
          peerIdentity: s.peerIdentity,
          displayName: `[${s.peerIdentity}] ${s.peerName}`,
          lastMessagePreview: s.lastMessageText || '',
          lastMessageAt: s.updatedAtMs,
          timeText: formatTimeText(s.updatedAtMs),
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

  onTapSession(e) {
    const sessionId = e?.currentTarget?.dataset?.sessionId;
    if (!sessionId) return;

    const peerName = e?.currentTarget?.dataset?.peerName;
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

  onTapScan() {
    const peerName = `Student_${Math.floor(1000 + Math.random() * 9000)}`;
    api
      .createSession(peerName, 'student')
      .then((session) => {
        this.refreshSessions();
        wx.navigateTo({
          url:
            `/pages/linkbridge/chat/chat?sessionId=${encodeURIComponent(session.id)}` +
            `&peerName=${encodeURIComponent(session.peerName)}`,
        });
      })
      .catch((err) => {
        console.error('Failed to create session:', err);
        wx.showToast({ title: '创建会话失败', icon: 'none' });
      });
  },
});
