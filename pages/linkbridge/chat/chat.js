import themeChangeBehavior from 'tdesign-miniprogram/mixins/theme-change';

const api = require('../../../utils/linkbridge/api');

function normalizeMessageForView(message) {
  if (!message || typeof message !== 'object') return null;

  const meta = message.meta && typeof message.meta === 'object' ? message.meta : {};
  const text = typeof message.text === 'string' ? message.text : '';

  return {
    id: message.id,
    sessionId: message.sessionId,
    sender: message.sender === 'peer' ? 'peer' : 'me',
    type: typeof message.type === 'string' ? message.type : 'text',
    text,
    meta,
    createdAt: message.createdAtMs || message.createdAt,
  };
}

function buildMessageViewModels(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map(normalizeMessageForView).filter(Boolean);
}

Page({
  behaviors: [themeChangeBehavior],
  data: {
    sessionId: '',
    peerName: '',
    navbarTitle: '聊天',
    messages: [],
    inputValue: '',
    canSend: false,
    isPlusMenuVisible: false,
    scrollIntoView: '',
    loading: false,
  },

  onLoad(query) {
    const sessionId = query?.sessionId || '';
    const peerName = query?.peerName || '';

    this.setData({
      sessionId,
      peerName,
      navbarTitle: peerName || '聊天',
    });

    this.loadMessages(sessionId);
  },

  loadMessages(sessionId) {
    if (!sessionId) return;

    this.setData({ loading: true });
    api
      .listMessages(sessionId)
      .then((messages) => {
        const viewModels = buildMessageViewModels(messages);
        const lastMessage = viewModels.length > 0 ? viewModels[viewModels.length - 1] : null;
        this.setData({
          messages: viewModels,
          scrollIntoView: lastMessage ? `msg-${lastMessage.id}` : '',
          loading: false,
        });
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
    const vm = normalizeMessageForView(message);
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

  onTapSimulateImage() {
    const sessionId = this.data.sessionId;
    if (!sessionId) return;

    this.setData({ isPlusMenuVisible: false });

    api
      .sendAttachmentMessage(sessionId, 'image', { name: 'demo.jpg' })
      .then((message) => {
        this.appendMessageAndScroll(message);
      })
      .catch((err) => {
        console.error('Failed to send image:', err);
        wx.showToast({ title: '发送失败', icon: 'none' });
      });
  },

  onTapSimulateFile() {
    const sessionId = this.data.sessionId;
    if (!sessionId) return;

    this.setData({ isPlusMenuVisible: false });

    api
      .sendAttachmentMessage(sessionId, 'file', { name: 'demo.pdf' })
      .then((message) => {
        this.appendMessageAndScroll(message);
      })
      .catch((err) => {
        console.error('Failed to send file:', err);
        wx.showToast({ title: '发送失败', icon: 'none' });
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
});
