const api = require('../../utils/linkbridge/api');

function buildViewMessage(msg, myUserId) {
  const senderId = msg?.senderId || '';
  const text = msg?.text || '';
  return {
    messageId: msg?.id || null,
    from: senderId && myUserId && senderId === myUserId ? 0 : 1,
    content: text,
    time: msg?.createdAtMs || Date.now(),
  };
}

Page({
  data: {
    myAvatar: '/static/chat/avatar.png',
    sessionId: '',
    peerUserId: '',
    avatar: '/static/chat/avatar.png',
    name: '会话',
    peerProfileVisible: false,
    peerProfile: { id: '', username: '', displayName: '', avatarUrl: '/static/chat/avatar.png' },
    messages: [],
    input: '',
    anchor: '',
    keyboardHeight: 0,
    loading: false,
    myUserId: '',
  },

  onLoad(options) {
    const sessionId = (options?.sessionId || '').trim();
    const peerName = options?.peerName ? decodeURIComponent(options.peerName) : '';
    const peerUserId = options?.peerUserId ? decodeURIComponent(options.peerUserId) : '';

    if (!sessionId) {
      wx.showToast({ title: '缺少会话ID', icon: 'none' });
      wx.navigateBack();
      return;
    }

    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    const cachedMe = api.getUser();
    this.setData({
      sessionId,
      peerUserId,
      name: peerName || '会话',
      myUserId: cachedMe?.id || '',
    });

    api.connectWebSocket();
    this.loadMessages();

    if (peerUserId) {
      this.loadPeerProfile(peerUserId);
    }

    this.wsHandler = (env) => {
      if (env?.type !== 'message.created') return;
      const msg = env?.payload?.message;
      if (!msg || msg.sessionId !== this.data.sessionId) return;

      const incomingID = msg?.id || '';
      if (incomingID && this.data.messages.some((m) => m.messageId === incomingID)) return;

      const myId = this.data.myUserId || api.getUser()?.id || '';
      const vm = buildViewMessage(msg, myId);
      this.setData({ messages: [...this.data.messages, vm] });
      wx.nextTick(this.scrollToBottom);
    };
    api.addWebSocketHandler(this.wsHandler);

    // Ensure we have userId for sender mapping.
    if (!this.data.myUserId) {
      api
        .getMe()
        .then((me) => {
          api.setUser(me);
          this.setData({ myUserId: me?.id || '' });
        })
        .catch(() => null);
    }
  },

  onUnload() {
    if (this.wsHandler) api.removeWebSocketHandler(this.wsHandler);
  },

  loadMessages() {
    this.setData({ loading: true });
    api
      .listMessages(this.data.sessionId)
      .then((res) => {
        const myId = this.data.myUserId || api.getUser()?.id || '';
        const vms = (res?.messages || []).map((m) => buildViewMessage(m, myId));
        this.setData({ messages: vms, loading: false });
        wx.nextTick(this.scrollToBottom);
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  handleKeyboardHeightChange(event) {
    const height = event?.detail?.height || 0;
    if (!height) return;
    this.setData({ keyboardHeight: height });
    wx.nextTick(this.scrollToBottom);
  },

  handleBlur() {
    this.setData({ keyboardHeight: 0 });
  },

  handleInput(event) {
    this.setData({ input: event?.detail?.value || '' });
  },

  sendMessage() {
    const content = (this.data.input || '').trim();
    if (!content) return;

    this.setData({ input: '' });

    api
      .sendTextMessage(this.data.sessionId, content)
      .then((msg) => {
        const myId = this.data.myUserId || api.getUser()?.id || '';
        const vm = buildViewMessage(msg, myId);
        const id = vm?.messageId || '';
        if (id && this.data.messages.some((m) => m.messageId === id)) return;
        this.setData({ messages: [...this.data.messages, vm] });
        wx.nextTick(this.scrollToBottom);
      })
      .catch(() => {
        wx.showToast({ title: '发送失败', icon: 'none' });
      });
  },

  onTapVoiceCall() {
    const peerUserId = this.data.peerUserId || '';
    const peerName = this.data.name || '';
    if (!peerUserId) {
      wx.showToast({ title: '缺少对方信息', icon: 'none' });
      return;
    }

    const url =
      `/pages/call/index?peerUserId=${encodeURIComponent(peerUserId)}` +
      `&mediaType=voice` +
      (peerName ? `&peerName=${encodeURIComponent(peerName)}` : '');
    wx.navigateTo({ url });
  },

  loadPeerProfile(peerUserId) {
    api
      .getUserById(peerUserId)
      .then((u) => {
        const displayName = u?.displayName || this.data.name || '对方';
        const username = u?.username ? `@${u.username}` : '';
        const avatarUrl = u?.avatarUrl || '/static/chat/avatar.png';
        this.setData({
          peerProfile: {
            id: u?.id || peerUserId,
            username,
            displayName,
            avatarUrl,
          },
        });
      })
      .catch(() => null);
  },

  onTapPeerAvatar() {
    const peerUserId = this.data.peerUserId || '';
    if (!peerUserId) {
      wx.showToast({ title: '缺少对方信息', icon: 'none' });
      return;
    }
    this.setData({ peerProfileVisible: true });
    this.loadPeerProfile(peerUserId);
  },

  onClosePeerProfile() {
    this.setData({ peerProfileVisible: false });
  },

  onPeerProfileVisibleChange(e) {
    this.setData({ peerProfileVisible: !!e?.detail?.visible });
  },

  scrollToBottom() {
    this.setData({ anchor: 'bottom' });
  },
});
