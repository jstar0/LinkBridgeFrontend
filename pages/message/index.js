const api = require('../../utils/linkbridge/api');

Page({
  /** 页面的初始数据 */
  data: {
    sessions: [],
    loading: true, // 是否正在加载（用于下拉刷新）
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
    api
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
});
