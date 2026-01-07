const api = require('../../utils/linkbridge/api');

function buildViewMessage(msg, myUserId) {
  const senderId = msg?.senderId || '';
  const type = msg?.type || 'text';
  const text = msg?.text || '';
  const meta = msg?.meta || {};
  return {
    messageId: msg?.id || null,
    from: senderId && myUserId && senderId === myUserId ? 0 : 1,
    type,
    content: text,
    meta,
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
    scrollTop: 0,
    keyboardHeight: 0,
    loading: false,
    myUserId: '',
    sending: false,
    drawerVisible: false,
    activeCall: null,
    archived: false,
    reactivatedAt: null,
  },

  onLoad(options) {
    const sessionId = (options?.sessionId || '').trim();
    const peerName = options?.peerName ? decodeURIComponent(options.peerName) : '';
    const peerUserId = options?.peerUserId ? decodeURIComponent(options.peerUserId) : '';
    const archived = options?.archived === 'true';

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
      archived,
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

  onShow() {
    // Check for active call every time page is shown
    const activeCall = api.getActiveCall();
    // Reset keyboardHeight on show to avoid "floating" input after navigating away and back.
    this.setData({ activeCall: activeCall || null, keyboardHeight: 0 });
    try {
      wx.hideKeyboard();
    } catch (e) {
      // ignore
    }
  },

  onUnload() {
    if (this.wsHandler) api.removeWebSocketHandler(this.wsHandler);
  },

  loadMessages() {
    this.setData({ loading: true });

    // Load both messages and session info
    Promise.all([
      api.listMessages(this.data.sessionId),
      api.listSessions('active').then(sessions =>
        sessions.find(s => s.id === this.data.sessionId)
      )
    ])
      .then(([messagesRes, session]) => {
        const myId = this.data.myUserId || api.getUser()?.id || '';
        const vms = (messagesRes?.messages || []).map((m) => buildViewMessage(m, myId));

        // Check if session was reactivated
        const reactivatedAt = session?.reactivatedAt ? new Date(session.reactivatedAt).getTime() : null;

        this.setData({
          messages: vms,
          loading: false,
          reactivatedAt
        });
        wx.nextTick(this.scrollToBottom);
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  handleKeyboardHeightChange(event) {
    const height = Number(event?.detail?.height || 0) || 0;
    this.setData({ keyboardHeight: height }, () => {
      // Always keep latest messages visible when keyboard pops (WeChat/QQ-like behavior).
      this.scrollToBottom();
    });
  },

  handleFocus() {
    // Each time keyboard is about to pop, force-scroll to bottom.
    this.scrollToBottom();
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

  onTapMore() {
    this.setData({ drawerVisible: true });
  },

  onCloseDrawer() {
    this.setData({ drawerVisible: false });
  },

  onDrawerVisibleChange(e) {
    this.setData({ drawerVisible: !!e?.detail?.visible });
  },

  sendImage() {
    if (this.data.sending) return;
    this.setData({ drawerVisible: false });

    if (typeof wx?.chooseMedia !== 'function' && typeof wx?.chooseImage !== 'function') {
      wx.showToast({ title: '当前环境不支持选图', icon: 'none' });
      return;
    }

    const pick = typeof wx.chooseMedia === 'function'
      ? () =>
          new Promise((resolve, reject) => {
            wx.chooseMedia({
              count: 1,
              mediaType: ['image'],
              sourceType: ['album', 'camera'],
              success: (r) => resolve(r),
              fail: (e) => reject(e),
            });
          })
      : () =>
          new Promise((resolve, reject) => {
            wx.chooseImage({
              count: 1,
              sourceType: ['album', 'camera'],
              success: (r) => resolve({ tempFiles: (r?.tempFilePaths || []).map((p) => ({ tempFilePath: p })) }),
              fail: (e) => reject(e),
            });
          });

    this.setData({ sending: true });
    pick()
      .then((r) => {
        const file = r?.tempFiles?.[0];
        const filePath = file?.tempFilePath || '';
        if (!filePath) throw new Error('missing file');
        wx.showLoading({ title: '上传中...' });
        return api.uploadFile(filePath).then((up) => ({ up }));
      })
      .then(({ up }) => {
        const meta = {
          name: up?.name || 'image',
          sizeBytes: up?.sizeBytes || 0,
          url: up?.url || '',
        };
        return api.sendImageMessage(this.data.sessionId, meta);
      })
      .then((msg) => {
        wx.hideLoading();
        const myId = this.data.myUserId || api.getUser()?.id || '';
        const vm = buildViewMessage(msg, myId);
        const id = vm?.messageId || '';
        if (id && this.data.messages.some((m) => m.messageId === id)) return;
        this.setData({ messages: [...this.data.messages, vm], sending: false });
        wx.nextTick(this.scrollToBottom);
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ sending: false });
        wx.showToast({ title: '发送失败', icon: 'none' });
      });
  },

  sendFile() {
    if (this.data.sending) return;
    this.setData({ drawerVisible: false });

    const chooseFileFromWechat = () =>
      new Promise((resolve, reject) => {
        if (typeof wx?.chooseMessageFile !== 'function') {
          reject(new Error('chooseMessageFile not supported'));
          return;
        }
        wx.chooseMessageFile({
          count: 1,
          type: 'file',
          success: (r) => {
            const file = r?.tempFiles?.[0];
            resolve({
              path: file?.path || '',
              name: file?.name || '',
              size: file?.size || 0,
            });
          },
          fail: (e) => reject(e),
        });
      });

    wx.showActionSheet({
      itemList: ['从本地选择文件', '从微信聊天记录选择文件'],
      success: (res) => {
        const mode = res?.tapIndex === 0 ? 'local' : 'chat';

        this.setData({ sending: true });

        const maybePrompt = () => {
          if (mode !== 'local') return Promise.resolve();
          // WeChat Mini Program does not expose a universal "system file picker" API.
          // In many environments, the file chooser UI may still only show WeChat conversations.
          return new Promise((resolve) => {
            const tipKey = 'lb_local_file_tip_shown_v1';
            try {
              if (wx.getStorageSync(tipKey)) {
                resolve();
                return;
              }
            } catch (e) {
              // ignore
            }
            wx.showModal({
              title: '选择本地文件',
              content:
                '如果选择器里没有「本地文件/手机文件」，说明当前微信环境不支持直接选择本地文件。你可以先把文件发送到「文件传输助手」或任意聊天，再在下一步从聊天记录选择。',
              showCancel: false,
              success: () => {
                try {
                  wx.setStorageSync(tipKey, true);
                } catch (e) {
                  // ignore
                }
                resolve();
              },
              fail: () => resolve(),
            });
          });
        };

        maybePrompt()
          .then(() => chooseFileFromWechat())
          .then(({ path, name }) => {
            if (!path) throw new Error('missing file');
            wx.showLoading({ title: '上传中...' });
            return api.uploadFile(path, name);
          })
          .then((up) => {
            const meta = {
              name: up?.name || 'file',
              sizeBytes: up?.sizeBytes || 0,
              url: up?.url || '',
            };
            return api.sendFileMessage(this.data.sessionId, meta);
          })
          .then((msg) => {
            wx.hideLoading();
            const myId = this.data.myUserId || api.getUser()?.id || '';
            const vm = buildViewMessage(msg, myId);
            const id = vm?.messageId || '';
            if (id && this.data.messages.some((m) => m.messageId === id)) return;
            this.setData({ messages: [...this.data.messages, vm], sending: false });
            wx.nextTick(this.scrollToBottom);
          })
          .catch((err) => {
            wx.hideLoading();
            this.setData({ sending: false });

            const msg = String(err?.errMsg || err?.message || '');
            if (msg.toLowerCase().includes('cancel')) {
              return;
            }
            if (msg.toLowerCase().includes('choosemessagefile not supported')) {
              wx.showToast({ title: '当前环境不支持选择文件', icon: 'none' });
              return;
            }
            wx.showToast({ title: '发送失败', icon: 'none' });
          });
      },
      fail: () => {
        // canceled
      },
    });
  },

  getFileUrl(meta) {
    const url = meta?.url || '';
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return `${api.getBaseUrl()}${url.startsWith('/') ? '' : '/'}${url}`;
  },

  onTapImageMessage(event) {
    const url = event?.currentTarget?.dataset?.url || '';
    const fullUrl = this.getFileUrl({ url });
    if (!fullUrl) return;
    wx.previewImage({ urls: [fullUrl] });
  },

  onTapFileMessage(event) {
    const url = event?.currentTarget?.dataset?.url || '';
    const fullUrl = this.getFileUrl({ url });
    if (!fullUrl) return;

    wx.showLoading({ title: '下载中...' });
    wx.downloadFile({
      url: fullUrl,
      success: (res) => {
        wx.hideLoading();
        const filePath = res?.tempFilePath;
        if (!filePath) {
          wx.showToast({ title: '下载失败', icon: 'none' });
          return;
        }
        wx.openDocument({
          filePath,
          showMenu: true,
          fail: () => wx.showToast({ title: '无法打开文件', icon: 'none' }),
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '下载失败', icon: 'none' });
      },
    });
  },

  onTapVoiceCall() {
    this.setData({ drawerVisible: false });
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

  onTapVideoCall() {
    this.setData({ drawerVisible: false });
    const peerUserId = this.data.peerUserId || '';
    const peerName = this.data.name || '';
    if (!peerUserId) {
      wx.showToast({ title: '缺少对方信息', icon: 'none' });
      return;
    }

    const url =
      `/pages/call/index?peerUserId=${encodeURIComponent(peerUserId)}` +
      `&mediaType=video` +
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

    const url = `/pages/peer/index?userId=${encodeURIComponent(peerUserId)}`;
    try {
      wx.hideKeyboard();
    } catch (e) {
      // ignore
    }
    this.setData({ keyboardHeight: 0 }, () => wx.navigateTo({ url }));
  },

  onClosePeerProfile() {
    this.setData({ peerProfileVisible: false });
  },

  onPeerProfileVisibleChange(e) {
    this.setData({ peerProfileVisible: !!e?.detail?.visible });
  },

  scrollToBottom() {
    // `scroll-into-view` won't re-trigger if the value doesn't change.
    // Use `scrollTop` with a monotonically increasing value to force-scroll every time.
    const next = Number(this.data.scrollTop || 0) + 100000;
    this.setData({ scrollTop: next });
  },

  onRestoreCall() {
    const activeCall = this.data.activeCall;
    if (!activeCall) return;

    const url =
      `/pages/call/index?callId=${encodeURIComponent(activeCall.callId)}` +
      `&peerUserId=${encodeURIComponent(activeCall.peerUserId)}` +
      `&mediaType=${activeCall.mediaType}` +
      (activeCall.peerDisplayName ? `&peerName=${encodeURIComponent(activeCall.peerDisplayName)}` : '');
    wx.navigateTo({ url });
  },
});
