const themeChangeBehavior = require('tdesign-miniprogram/mixins/theme-change');
const linkbridgeStore = require('../../../utils/linkbridge/store');

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
    myQrFabButtonProps: {
      theme: 'default',
      variant: 'outline',
    },
  },

  onLoad() {
    linkbridgeStore.bootstrapState();
    this.refreshSessions();
  },

  onShow() {
    this.refreshSessions();
  },

  refreshSessions() {
    const sessions = linkbridgeStore.listActiveSessions();
    const viewModels = sessions.map((session) => ({
      ...session,
      timeText: formatTimeText(session.lastMessageAt),
    }));

    this.setData({ activeSessions: viewModels });
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
    const newSession = linkbridgeStore.createSessionFromScan();
    this.refreshSessions();

    wx.navigateTo({
      url:
        `/pages/linkbridge/chat/chat?sessionId=${encodeURIComponent(newSession.id)}` +
        `&peerName=${encodeURIComponent(newSession.peerName)}`,
    });
  },
});
