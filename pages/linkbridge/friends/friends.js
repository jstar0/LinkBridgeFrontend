import themeChangeBehavior from 'tdesign-miniprogram/mixins/theme-change';

const api = require('../../../utils/linkbridge/api');

function decorateIncomingRequests(requests, currentUserId, usersById) {
  if (!Array.isArray(requests)) return [];
  return requests
    .map((r) => {
      const peerId = r.requesterId === currentUserId ? r.addresseeId : r.requesterId;
      const peer = usersById[peerId] || { id: peerId, username: peerId, displayName: peerId };
      return { ...r, peer };
    })
    .filter((r) => r.status === 'pending');
}

Page({
  behaviors: [themeChangeBehavior],
  data: {
    loading: false,
    friends: [],
    incomingRequests: [],
    currentUserId: '',
  },

  onLoad() {
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/linkbridge/login/login' });
      return;
    }
    const me = api.getUser();
    this.setData({ currentUserId: me?.id || '' });
    this.refreshAll();
  },

  onShow() {
    if (!api.isLoggedIn()) return;
    this.refreshAll();
  },

  onGoBack() {
    wx.navigateBack();
  },

  refreshAll() {
    this.setData({ loading: true });

    Promise.all([
      api.listFriends(),
      api.listFriendRequests('incoming', 'pending'),
      api.listFriendRequests('outgoing', 'pending'),
    ])
      .then(([friends, incoming, outgoing]) => {
        const users = [...(friends || [])];
        const userById = {};
        users.forEach((u) => {
          if (u?.id) userById[u.id] = u;
        });

        // For requests we only have userId; try to resolve peer by calling getUserById lazily when needed.
        const allReqs = [...(incoming || []), ...(outgoing || [])];
        const peerIds = Array.from(
          new Set(
            allReqs
              .map((r) => (r?.requesterId === this.data.currentUserId ? r?.addresseeId : r?.requesterId))
              .filter(Boolean)
          )
        );

        return Promise.all(peerIds.map((id) => api.getUserById(id).catch(() => null))).then((peers) => {
          peers
            .filter(Boolean)
            .forEach((u) => {
              if (u?.id) userById[u.id] = u;
            });

          this.setData({
            friends: friends || [],
            incomingRequests: decorateIncomingRequests(incoming || [], this.data.currentUserId, userById),
            loading: false,
          });
        });
      })
      .catch((err) => {
        console.error('Failed to load friends:', err);
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  onTapAccept(e) {
    const id = e?.currentTarget?.dataset?.id;
    if (!id) return;

    wx.showLoading({ title: '处理中...' });
    api
      .acceptFriendRequest(id)
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已添加', icon: 'success' });
        this.refreshAll();
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('Accept friend failed:', err);
        wx.showToast({ title: '操作失败', icon: 'none' });
      });
  },

  onTapReject(e) {
    const id = e?.currentTarget?.dataset?.id;
    if (!id) return;

    wx.showLoading({ title: '处理中...' });
    api
      .rejectFriendRequest(id)
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已拒绝', icon: 'success' });
        this.refreshAll();
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('Reject friend failed:', err);
        wx.showToast({ title: '操作失败', icon: 'none' });
      });
  },

  onTapChat(e) {
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
        wx.showToast({ title: '创建会话失败', icon: 'none' });
      });
  },
});

