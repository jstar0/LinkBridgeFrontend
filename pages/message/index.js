const api = require('../../utils/linkbridge/api');

Page({
  /** 页面的初始数据 */
  data: {
    sessions: [],
    loading: true, // 是否正在加载（用于拉取列表）
    refreshing: false, // t-pull-down-refresh state
    incomingRequests: [],
  },

  /** 生命周期函数--监听页面加载 */
  onLoad() {},

  /** 生命周期函数--监听页面初次渲染完成 */
  onReady() {},

  /** 生命周期函数--监听页面显示 */
  onShow() {
    if (!api.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    api.connectWebSocket();
    this.getMessageList();
    this.getIncomingRequests();

    this.wsHandler = (env) => {
      if (env?.type === 'session.created') {
        const session = env?.payload?.session;
        if (!session?.id) return;
        const decorated = {
          ...session,
          unreadCount: 0,
          avatar: (session && session.peer && session.peer.avatarUrl) || '/static/chat/avatar.png',
          desc: session && session.lastMessageText ? session.lastMessageText : ' ',
        };
        const next = [decorated, ...this.data.sessions.filter((s) => s.id !== session.id)];
        this.setData({ sessions: next });
        return;
      }

      if (env?.type === 'session.archived') {
        const archivedId = env?.payload?.session?.id || env?.payload?.sessionId || '';
        if (!archivedId) return;
        const next = this.data.sessions.filter((s) => s.id !== archivedId);
        if (next.length !== this.data.sessions.length) this.setData({ sessions: next });
        return;
      }

      if (env?.type === 'session.requested') {
        // New incoming request; refresh list.
        this.getIncomingRequests();
        return;
      }

      if (env?.type === 'session.request.accepted' || env?.type === 'session.request.rejected') {
        // Either accepted/rejected by the other side; refresh view.
        this.getIncomingRequests();
        return;
      }

      if (env?.type === 'message.created') {
        const msg = env?.payload?.message;
        const sid = msg?.sessionId;
        if (!sid) return;

        const next = [...this.data.sessions];
        const idx = next.findIndex((s) => s.id === sid);
        if (idx < 0) return;

        const session = { ...next[idx] };
        session.lastMessageText = msg?.text || session.lastMessageText || '';
        session.desc = msg?.text || session.desc || ' ';
        session.updatedAtMs = msg?.createdAtMs || session.updatedAtMs;
        session.unreadCount = (session.unreadCount || 0) + 1;

        next.splice(idx, 1);
        next.unshift(session);
        this.setData({ sessions: next });
      }
    };

    api.addWebSocketHandler(this.wsHandler);
  },

  /** 生命周期函数--监听页面隐藏 */
  onHide() {},

  /** 生命周期函数--监听页面卸载 */
  onUnload() {
    if (this.wsHandler) api.removeWebSocketHandler(this.wsHandler);
  },

  /** 页面相关事件处理函数--监听用户下拉动作 */
  onPullDownRefresh() {},

  /** 页面上拉触底事件的处理函数 */
  onReachBottom() {},

  /** 用户点击右上角分享 */
  onShareAppMessage() {},

  /** 获取会话列表 */
  getMessageList() {
    this.setData({ loading: true });
    return api
      .listSessions('active')
      .then((sessions) => {
        const decorated = (sessions || []).map((s) => ({
          ...s,
          unreadCount: 0,
          avatar: (s && s.peer && s.peer.avatarUrl) || '/static/chat/avatar.png',
          desc: s && s.lastMessageText ? s.lastMessageText : ' ',
        }));
        this.setData({ sessions: decorated, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  onRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });

    Promise.allSettled([this.getMessageList(), this.getIncomingRequests()])
      .catch(() => null)
      .finally(() => {
        // brief delay to feel like "snap back" (similar to model)
        setTimeout(() => this.setData({ refreshing: false }), 260);
      });
  },

  getIncomingRequests() {
    return api
      .listSessionRequests('in', 'pending')
      .then((requests) => {
        const items = (requests || []).slice(0, 10);
        return Promise.all(
          items.map((r) =>
            api
              .getUserById(r.requesterId)
              .then((u) => ({ id: r.id, requesterId: r.requesterId, user: u || { id: r.requesterId, displayName: '对方' } }))
              .catch(() => ({ id: r.id, requesterId: r.requesterId, user: { id: r.requesterId, displayName: '对方' } }))
          )
        );
      })
      .then((incomingRequests) => this.setData({ incomingRequests: incomingRequests || [] }))
      .catch(() => this.setData({ incomingRequests: [] }));
  },

  toChat(event) {
    const session = event?.currentTarget?.dataset?.session;
    if (!session?.id) return;

    // Reset unread count locally when opening.
    const sessions = this.data.sessions.map((s) => (s.id === session.id ? { ...s, unreadCount: 0 } : s));
    this.setData({ sessions });

    const peerName = session?.peer?.displayName || '';
    const peerUserId = session?.peer?.id || '';
    const url =
      `/pages/chat/index?sessionId=${encodeURIComponent(session.id)}` +
      (peerName ? `&peerName=${encodeURIComponent(peerName)}` : '') +
      (peerUserId ? `&peerUserId=${encodeURIComponent(peerUserId)}` : '');
    wx.navigateTo({ url });
  },

  onLongPressSession(event) {
    const session = event?.currentTarget?.dataset?.session;
    if (!session?.id) return;

    wx.showActionSheet({
      itemList: ['结束会话'],
      success: (res) => {
        if (res?.tapIndex !== 0) return;

        wx.showLoading({ title: '结束中...' });
        api
          .archiveSession(session.id)
          .then(() => {
            const next = this.data.sessions.filter((s) => s.id !== session.id);
            this.setData({ sessions: next });
            wx.hideLoading();
            wx.showToast({ title: '已结束', icon: 'none' });
          })
          .catch(() => {
            wx.hideLoading();
            wx.showToast({ title: '结束失败', icon: 'none' });
          });
      },
    });
  },

  onAcceptRequest(event) {
    const requestId = event?.currentTarget?.dataset?.id || '';
    if (!requestId) return;

    wx.showLoading({ title: '处理中...' });
    api
      .acceptSessionRequest(requestId)
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已接受', icon: 'none' });
        this.getIncomingRequests();
        this.getMessageList();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err?.message || '失败', icon: 'none' });
      });
  },

  onRejectRequest(event) {
    const requestId = event?.currentTarget?.dataset?.id || '';
    if (!requestId) return;

    wx.showLoading({ title: '处理中...' });
    api
      .rejectSessionRequest(requestId)
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已拒绝', icon: 'none' });
        this.getIncomingRequests();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err?.message || '失败', icon: 'none' });
      });
  },
});
