import themeChangeBehavior from 'tdesign-miniprogram/mixins/theme-change';

const linkbridgeStore = require('../../../utils/linkbridge/store');

function normalizeMessageForView(message) {
  if (!message || typeof message !== 'object') return null;

  const meta = message.meta && typeof message.meta === 'object' ? message.meta : {};
  const text = typeof message.text === 'string' ? message.text : '';

  return {
    ...message,
    sender: message.sender === 'peer' ? 'peer' : 'me',
    type: typeof message.type === 'string' ? message.type : 'text',
    text,
    meta,
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
  },

  onLoad(query) {
    linkbridgeStore.bootstrapState();

    const sessionId = query?.sessionId || '';
    const peerNameFromQuery = query?.peerName || '';

    let peerName = peerNameFromQuery;
    if (!peerName && sessionId) {
      const session = linkbridgeStore.getSessionById(sessionId);
      peerName = session?.peerName || '';
    }

    const messages = buildMessageViewModels(linkbridgeStore.listMessages(sessionId));
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

    this.setData({
      sessionId,
      peerName,
      navbarTitle: peerName || '聊天',
      messages,
      scrollIntoView: lastMessage ? `msg-${lastMessage.id}` : '',
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

    const message = linkbridgeStore.addTextMessage(sessionId, nextText, 'me');
    if (!message) return;

    this.setData({ inputValue: '', canSend: false });
    this.appendMessageAndScroll(message);
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

    const message = linkbridgeStore.addAttachmentMessage(sessionId, 'image', { name: 'demo.jpg' });
    if (!message) return;

    this.setData({ isPlusMenuVisible: false });
    this.appendMessageAndScroll(message);
  },

  onTapSimulateFile() {
    const sessionId = this.data.sessionId;
    if (!sessionId) return;

    const message = linkbridgeStore.addAttachmentMessage(sessionId, 'file', { name: 'demo.pdf' });
    if (!message) return;

    this.setData({ isPlusMenuVisible: false });
    this.appendMessageAndScroll(message);
  },

  onTapEndSession() {
    const sessionId = this.data.sessionId;
    if (sessionId) linkbridgeStore.archiveSession(sessionId);
    wx.reLaunch({ url: '/pages/linkbridge/dashboard/dashboard' });
  },
});
