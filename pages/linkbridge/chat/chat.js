import themeChangeBehavior from 'tdesign-miniprogram/mixins/theme-change';

const api = require('../../../utils/linkbridge/api');

function normalizeMessageForView(message, currentUserId) {
  if (!message || typeof message !== 'object') return null;

  const meta = message.meta && typeof message.meta === 'object' ? message.meta : {};
  const text = typeof message.text === 'string' ? message.text : '';

  return {
    id: message.id,
    sessionId: message.sessionId,
    sender: message.senderId === currentUserId ? 'me' : 'peer',
    senderId: message.senderId,
    type: typeof message.type === 'string' ? message.type : 'text',
    text,
    meta,
    createdAt: message.createdAtMs || message.createdAt,
  };
}

function buildMessageViewModels(messages, currentUserId) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => normalizeMessageForView(m, currentUserId)).filter(Boolean);
}

Page({
  behaviors: [themeChangeBehavior],
  data: {
    sessionId: '',
    peerName: '',
    peerUserId: '',
    navbarTitle: '聊天',
    messages: [],
    inputValue: '',
    canSend: false,
    isPlusMenuVisible: false,
    scrollIntoView: '',
    loading: false,
    hasMore: false,
    currentUserId: '',
  },

  wsHandler: null,

  onLoad(query) {
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/linkbridge/login/login' });
      return;
    }

    const sessionId = query?.sessionId || '';
    const peerName = query?.peerName || '';
    const peerUserId = query?.peerUserId || '';
    const currentUser = api.getUser();
    const currentUserId = currentUser?.id || '';

    this.setData({
      sessionId,
      peerName,
      peerUserId,
      navbarTitle: peerName || '聊天',
      currentUserId,
    });

    this.loadMessages(sessionId);
    this.setupWebSocket(sessionId);
  },

  onUnload() {
    if (this.wsHandler) {
      api.removeWebSocketHandler(this.wsHandler);
      this.wsHandler = null;
    }
  },

  setupWebSocket(sessionId) {
    api.connectWebSocket();

    this.wsHandler = (data) => {
      if (data.type === 'message.created' && data.sessionId === sessionId) {
        const message = data.payload?.message;
        if (message && message.senderId !== this.data.currentUserId) {
          this.appendMessageAndScroll(message);
        }
      }
    };

    api.addWebSocketHandler(this.wsHandler);
  },

  loadMessages(sessionId, beforeId) {
    if (!sessionId) return;

    this.setData({ loading: true });
    api
      .listMessages(sessionId, beforeId)
      .then((result) => {
        const viewModels = buildMessageViewModels(result.messages, this.data.currentUserId);
        if (beforeId) {
          const combined = [...viewModels, ...this.data.messages];
          this.setData({
            messages: combined,
            hasMore: result.hasMore,
            loading: false,
          });
        } else {
          const lastMessage = viewModels.length > 0 ? viewModels[viewModels.length - 1] : null;
          this.setData({
            messages: viewModels,
            scrollIntoView: lastMessage ? `msg-${lastMessage.id}` : '',
            hasMore: result.hasMore,
            loading: false,
          });
        }
      })
      .catch((err) => {
        console.error('Failed to load messages:', err);
        this.setData({ loading: false });
      });
  },

  onInputChange(e) {
    const nextValue = e?.detail?.value ?? '';
    const canSend = typeof nextValue === 'string' && nextValue.trim().length > 0;
    this.setData({ inputValue: nextValue, canSend });
  },

  appendMessageAndScroll(message) {
    const vm = normalizeMessageForView(message, this.data.currentUserId);
    if (!vm) return;
    const nextMessages = [...(this.data.messages || []), vm];
    this.setData({
      messages: nextMessages,
      scrollIntoView: `msg-${vm.id}`,
    });
  },

  onTapSend() {
    const sessionId = this.data.sessionId;
    const nextText = typeof this.data.inputValue === 'string' ? this.data.inputValue.trim() : '';
    if (!sessionId || !nextText) return;

    this.setData({ inputValue: '', canSend: false });

    api
      .sendTextMessage(sessionId, nextText)
      .then((message) => {
        this.appendMessageAndScroll(message);
      })
      .catch((err) => {
        console.error('Failed to send message:', err);
        wx.showToast({ title: '发送失败', icon: 'none' });
      });
  },

  onTapPlus() {
    this.setData({ isPlusMenuVisible: true });
  },

  onPlusMenuVisibleChange(e) {
    this.setData({ isPlusMenuVisible: !!e?.detail?.visible });
  },

  onTapChooseImage() {
    const sessionId = this.data.sessionId;
    if (!sessionId) return;

    this.setData({ isPlusMenuVisible: false });

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFile = res.tempFiles[0];
        if (!tempFile) return;

        wx.showLoading({ title: '上传中...' });

        api
          .uploadFile(tempFile.tempFilePath)
          .then((uploadRes) => {
            wx.hideLoading();
            return api.sendAttachmentMessage(sessionId, 'image', {
              name: uploadRes.name,
              sizeBytes: uploadRes.sizeBytes,
              url: uploadRes.url,
            });
          })
          .then((message) => {
            this.appendMessageAndScroll(message);
          })
          .catch((err) => {
            wx.hideLoading();
            console.error('Failed to send image:', err);
            wx.showToast({ title: '发送失败', icon: 'none' });
          });
      },
      fail: (err) => {
        if (err.errMsg && !err.errMsg.includes('cancel')) {
          console.error('Choose image failed:', err);
        }
      },
    });
  },

  onTapChooseFile() {
    const sessionId = this.data.sessionId;
    if (!sessionId) return;

    this.setData({ isPlusMenuVisible: false });

    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const tempFile = res.tempFiles[0];
        if (!tempFile) return;

        wx.showLoading({ title: '上传中...' });

        api
          .uploadFile(tempFile.path)
          .then((uploadRes) => {
            wx.hideLoading();
            return api.sendAttachmentMessage(sessionId, 'file', {
              name: uploadRes.name,
              sizeBytes: uploadRes.sizeBytes,
              url: uploadRes.url,
            });
          })
          .then((message) => {
            this.appendMessageAndScroll(message);
          })
          .catch((err) => {
            wx.hideLoading();
            console.error('Failed to send file:', err);
            wx.showToast({ title: '发送失败', icon: 'none' });
          });
      },
      fail: (err) => {
        if (err.errMsg && !err.errMsg.includes('cancel')) {
          console.error('Choose file failed:', err);
        }
      },
    });
  },

  onTapEndSession() {
    const sessionId = this.data.sessionId;
    if (!sessionId) {
      wx.reLaunch({ url: '/pages/linkbridge/dashboard/dashboard' });
      return;
    }

    api
      .archiveSession(sessionId)
      .then(() => {
        wx.reLaunch({ url: '/pages/linkbridge/dashboard/dashboard' });
      })
      .catch((err) => {
        console.error('Failed to archive session:', err);
        wx.reLaunch({ url: '/pages/linkbridge/dashboard/dashboard' });
      });
  },

  onTapVoiceCall() {
    const peerUserId = this.data.peerUserId;
    if (!peerUserId) {
      wx.showToast({ title: '无法发起通话', icon: 'none' });
      return;
    }

    const url =
      `/pages/linkbridge/call/call?peerUserId=${encodeURIComponent(peerUserId)}` +
      (this.data.peerName ? `&peerName=${encodeURIComponent(this.data.peerName)}` : '') +
      `&mediaType=voice`;
    wx.navigateTo({ url });
  },
});
