import themeChangeBehavior from 'tdesign-miniprogram/mixins/theme-change';

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
    archivedSessions: [],
    loading: false,
  },

  onLoad() {
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/linkbridge/login/login' });
      return;
    }
    this.refreshSessions();
  },

  onGoBack() {
    wx.navigateBack();
  },

  refreshSessions() {
    this.setData({ loading: true });
    api
      .listSessions('archived')
      .then((sessions) => {
        const viewModels = sessions.map((s) => ({
          id: s.id,
          peer: s.peer,
          lastMessagePreview: s.lastMessageText || '',
          lastMessageAtMs: s.lastMessageAtMs,
          timeText: formatTimeText(s.lastMessageAtMs || s.updatedAtMs),
          status: s.status,
        }));
        this.setData({ archivedSessions: viewModels, loading: false });
      })
      .catch((err) => {
        console.error('Failed to load archived sessions:', err);
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
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
});
