const api = require('../../utils/linkbridge/api');
const app = getApp();
const e2ee = require('../../utils/linkbridge/e2ee');

const BURN_STATE_PREFIX = 'lb_burn_state_v1_';
const DEFAULT_BURN_SECONDS = 10;

function loadBurnState(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return {};
  try {
    const raw = wx.getStorageSync(`${BURN_STATE_PREFIX}${sid}`);
    const obj = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

function saveBurnState(sessionId, map) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  try {
    wx.setStorageSync(`${BURN_STATE_PREFIX}${sid}`, JSON.stringify(map || {}));
  } catch (e) {
    // ignore
  }
}

function buildViewMessage(msg, myUserId, sessionId, burnStateMap) {
  const senderId = msg?.senderId || '';
  const type = msg?.type || 'text';
  const text = msg?.text || '';
  const meta = msg?.meta || {};

  // Key announce messages are control frames; never show them in chat UI.
  if (type === 'text' && e2ee.isKeyAnnounceText(text)) return null;

  let content = text;
  let encrypted = false;
  let burnAfterSec = 0;
  let decryptStatus = '';

  if (type === 'text' && e2ee.isEncryptedText(text)) {
    encrypted = true;
    const dec = e2ee.decryptText(sessionId, text);
    if (dec.ok) {
      content = dec.text;
      burnAfterSec = Number(dec.burnAfterSec || 0) || 0;
    } else {
      decryptStatus = String(dec.reason || 'DECRYPT_FAILED');
      content = '加密消息（未解密）';
    }
  }

  const messageId = msg?.id || null;
  const burnState = messageId ? burnStateMap?.[messageId] : null;
  const burnRead = !!burnState?.readAtMs;
  const burned = !!burnState?.burned || (burnState?.expireAtMs && Number(burnState.expireAtMs) <= Date.now());
  const expireAtMs = burnState?.expireAtMs ? Number(burnState.expireAtMs) : 0;
  const remainingSec = expireAtMs ? Math.max(0, Math.ceil((expireAtMs - Date.now()) / 1000)) : burnAfterSec;

  return {
    messageId,
    from: senderId && myUserId && senderId === myUserId ? 0 : 1,
    type,
    rawText: text,
    encrypted,
    decryptStatus,
    burnAfterSec,
    burnRead,
    burned,
    burnRemainingSec: burnAfterSec > 0 ? remainingSec : 0,
    content: burned && burnAfterSec > 0 ? '已焚毁' : content,
    meta,
    time: msg?.createdAtMs || Date.now(),
  };
}

function getWindowInfoCompat() {
  try {
    if (typeof wx?.getWindowInfo === 'function') return wx.getWindowInfo() || {};
  } catch (e) {
    // ignore
  }
  // Fallback for older base libs only (avoid calling deprecated APIs when `getWindowInfo` exists).
  if (typeof wx?.getWindowInfo !== 'function') {
    try {
      if (typeof wx?.getSystemInfoSync === 'function') return wx.getSystemInfoSync() || {};
    } catch (e) {
      // ignore
    }
  }
  return {};
}

function getSafeAreaInsetBottomPx() {
  const info = getWindowInfoCompat();
  const screenH = Number(info?.screenHeight || 0) || 0;
  const safeBottom = Number(info?.safeArea?.bottom || 0) || 0;
  if (screenH > 0 && safeBottom > 0) return Math.max(0, screenH - safeBottom);
  return 0;
}

function rpxToPx(rpx) {
  const info = getWindowInfoCompat();
  const w = Number(info?.windowWidth || 0) || 0;
  if (w > 0) return (Number(rpx || 0) || 0) * (w / 750);
  return 0;
}

function getBottomBarBaseHeightPx() {
  // Match the layout in pages/chat/index.less:
  // bottom padding: 24rpx + safe-area + 24rpx, input height 80rpx (approx), plus borders/gaps.
  // Keep it simple and slightly generous (129rpx) like the previous `.block` height.
  return Math.round(rpxToPx(129) + getSafeAreaInsetBottomPx());
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
    e2eeReady: false,
    e2eeHint: '',
    burnEnabled: false,
    burnSeconds: DEFAULT_BURN_SECONDS,
    burnStateById: {},
    input: '',
    scrollTop: 0,
    scrollNonce: 0,
    keyboardHeight: 0,
    bottomBarHeight: 0,
    bottomSpacer: 0,
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
      bottomBarHeight: getBottomBarBaseHeightPx(),
      bottomSpacer: getBottomBarBaseHeightPx(),
      burnStateById: loadBurnState(sessionId),
    });

    this.ensureE2EE();

    // Clear unread for this session when entering chat, even if user didn't come from the session list.
    if (typeof app?.setSessionUnread === 'function') app.setSessionUnread(sessionId, 0);

    api.connectWebSocket();
    this.loadMessages();

    if (peerUserId) {
      this.loadPeerProfile(peerUserId);
    }

    this.wsHandler = (env) => {
      if (env?.type !== 'message.created') return;
      const msg = env?.payload?.message;
      if (!msg || msg.sessionId !== this.data.sessionId) return;

      const myId = this.data.myUserId || api.getUser()?.id || '';

      // Consume key announce and do not show it.
      if (msg?.type === 'text' && e2ee.isKeyAnnounceText(msg?.text || '')) {
        // Ignore my own key announce message (otherwise we'd mistakenly store my pub as peer pub).
        if (myId && msg?.senderId && String(msg.senderId) === String(myId)) return;
        const res = e2ee.tryConsumeKeyAnnounce(this.data.sessionId, msg.text);
        if (res?.ready) {
          this.setData({ e2eeReady: true, e2eeHint: '' });
          this.rebuildVisibleMessages();
          wx.showToast({ title: '加密通道已建立', icon: 'none' });
        }
        return;
      }

      const incomingID = msg?.id || '';
      if (incomingID && this.data.messages.some((m) => m.messageId === incomingID)) return;

      const vm = buildViewMessage(msg, myId, this.data.sessionId, this.data.burnStateById);
      if (!vm) return;
      this.setData({ messages: [...this.data.messages, vm] }, () => this.afterMessagesUpdated());
      wx.nextTick(() => this.scrollToBottom());
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
    this.setData({
      activeCall: activeCall || null,
      keyboardHeight: 0,
      bottomSpacer: Number(this.data.bottomBarHeight || 0) || getBottomBarBaseHeightPx(),
    });
    try {
      wx.hideKeyboard();
    } catch (e) {
      // ignore
    }

    // Ensure the first view is already at the latest message (state, no animation).
    // Use two delayed attempts to cover initial render/layout settling on real devices.
    this.scrollToBottom();
    setTimeout(() => this.scrollToBottom(), 80);
    setTimeout(() => this.scrollToBottom(), 220);
  },

  onReady() {
    // Measure the fixed bottom bar height so the scroll-view can reserve space.
    wx.nextTick(() => {
      const query = wx.createSelectorQuery().in(this);
      query.select('.bottom').boundingClientRect();
      query.exec((res) => {
        const h = Number(res?.[0]?.height || 0) || 0;
        const fallback = getBottomBarBaseHeightPx();
        const nextH = h > 0 ? h : fallback;
        this.setData(
          {
            bottomBarHeight: nextH,
            bottomSpacer: nextH + (Number(this.data.keyboardHeight || 0) || 0),
          },
          () => this.scrollToBottom()
        );
      });
    });
  },

  onUnload() {
    if (this.wsHandler) api.removeWebSocketHandler(this.wsHandler);
    this.teardownBurnTicker();
    this.teardownBurnObserver();
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
        // Consume any historical key announce messages so decryption can work on first open.
        try {
          const myId = this.data.myUserId || api.getUser()?.id || '';
          (messagesRes?.messages || []).forEach((m) => {
            if (m?.type === 'text' && e2ee.isKeyAnnounceText(m?.text || '')) {
              if (myId && m?.senderId && String(m.senderId) === String(myId)) return;
              e2ee.tryConsumeKeyAnnounce(this.data.sessionId, m.text);
            }
          });
        } catch (e) {
          // ignore
        }

        // Re-check readiness after consuming key announces.
        const ready = !!e2ee.getSessionKey(this.data.sessionId);
        if (ready !== !!this.data.e2eeReady) this.setData({ e2eeReady: ready, e2eeHint: ready ? '' : this.data.e2eeHint });

        const myId = this.data.myUserId || api.getUser()?.id || '';
        const burnMap = this.data.burnStateById || {};
        const vms = (messagesRes?.messages || [])
          .map((m) => buildViewMessage(m, myId, this.data.sessionId, burnMap))
          .filter(Boolean);

        // Check if session was reactivated
        const reactivatedAt = session?.reactivatedAt ? new Date(session.reactivatedAt).getTime() : null;

        this.setData({
          messages: vms,
          loading: false,
          reactivatedAt
        }, () => this.afterMessagesUpdated());
        wx.nextTick(() => this.scrollToBottom());
        setTimeout(() => this.scrollToBottom(), 80);
        setTimeout(() => this.scrollToBottom(), 220);
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  handleKeyboardHeightChange(event) {
    const height = Number(event?.detail?.height || 0) || 0;
    const base = Number(this.data.bottomBarHeight || 0) || 0;
    this.setData({ keyboardHeight: height, bottomSpacer: base + height }, () => {
      // Always keep latest messages visible when keyboard pops (WeChat/QQ-like behavior).
      this.scrollToBottom();
      setTimeout(() => this.scrollToBottom(), 120);
    });
  },

  handleFocus() {
    // Each time keyboard is about to pop, force-scroll to bottom.
    this.scrollToBottom();
    setTimeout(() => this.scrollToBottom(), 60);
  },

  handleBlur() {
    const base = Number(this.data.bottomBarHeight || 0) || 0;
    this.setData({ keyboardHeight: 0, bottomSpacer: base }, () => this.scrollToBottom());
  },

  handleInput(event) {
    this.setData({ input: event?.detail?.value || '' });
  },

  ensureE2EE() {
    const sid = this.data.sessionId || '';
    if (!sid) return;

    // If we already have a derived session key, we are ready.
    const key = e2ee.getSessionKey(sid);
    if (key) {
      this.setData({ e2eeReady: true, e2eeHint: '' });
      return;
    }

    // Ensure we announce our public key at least once per session.
    if (e2ee.shouldAnnounceKey(sid)) {
      const keyMsg = e2ee.buildKeyAnnounceText();
      api
        .sendTextMessage(sid, keyMsg)
        .then(() => e2ee.markKeyAnnounced(sid))
        .catch(() => null);
    }

    this.setData({ e2eeReady: false, e2eeHint: '正在建立加密通道…' });
  },

  rebuildVisibleMessages() {
    const myId = this.data.myUserId || api.getUser()?.id || '';
    const burnMap = this.data.burnStateById || {};

    const next = (this.data.messages || [])
      .map((vm) => {
        if (!vm) return null;
        if (vm.type !== 'text') return vm;
        const raw = vm.rawText || vm.content || '';
        if (e2ee.isKeyAnnounceText(raw)) return null;
        if (!e2ee.isEncryptedText(raw)) return vm;

        const fakeMsg = {
          id: vm.messageId,
          senderId: vm.from === 0 ? myId : 'peer',
          type: 'text',
          text: raw,
          createdAtMs: vm.time,
        };
        return buildViewMessage(fakeMsg, myId, this.data.sessionId, burnMap);
      })
      .filter(Boolean);

    this.setData({ messages: next }, () => this.afterMessagesUpdated());
  },

  onToggleBurn(e) {
    const v = !!e?.detail?.value;
    this.setData({ burnEnabled: v });
  },

  afterMessagesUpdated() {
    this.refreshBurnObserver();
    this.ensureBurnTicker();
  },

  refreshBurnObserver() {
    this.teardownBurnObserver();

    const shouldObserve = (this.data.messages || []).some((m) => m?.type === 'text' && m?.burnAfterSec > 0 && !m?.burned);
    if (!shouldObserve) return;

    const observer = wx.createIntersectionObserver(this, { observeAll: true });
    // Observe within the scroll-view.
    try {
      observer.relativeTo('#chatScroll', { top: 0, bottom: 0 });
    } catch (e) {
      observer.relativeToViewport({ top: 0, bottom: 0 });
    }
    observer.observe('.lb-burn-observe', (res) => {
      const mid = res?.dataset?.mid || '';
      const ratio = Number(res?.intersectionRatio || 0) || 0;
      if (!mid || ratio < 0.6) return;
      this.onBurnMessageSeen(mid);
    });
    this._burnObserver = observer;
  },

  teardownBurnObserver() {
    try {
      if (this._burnObserver) this._burnObserver.disconnect();
    } catch (e) {
      // ignore
    }
    this._burnObserver = null;
  },

  onBurnMessageSeen(messageId) {
    const mid = String(messageId || '').trim();
    if (!mid) return;

    const msg = (this.data.messages || []).find((m) => String(m?.messageId || '') === mid);
    if (!msg || msg.type !== 'text') return;
    if (!(Number(msg.burnAfterSec || 0) > 0)) return;
    if (msg.burned) return;

    const map = this.data.burnStateById || {};
    if (map?.[mid]?.readAtMs) return;

    const readAtMs = Date.now();
    const expireAtMs = readAtMs + Number(msg.burnAfterSec) * 1000;
    map[mid] = { readAtMs, expireAtMs, burned: false };
    this.setData({ burnStateById: map });
    saveBurnState(this.data.sessionId, map);

    this.tickBurnCountdowns();
  },

  ensureBurnTicker() {
    if (this._burnTicker) return;
    const map = this.data.burnStateById || {};
    const need = (this.data.messages || []).some((m) => {
      if (!m || m.type !== 'text') return false;
      if (!(Number(m.burnAfterSec || 0) > 0) || m.burned) return false;
      const mid = String(m.messageId || '').trim();
      if (!mid) return false;
      return !!map?.[mid]?.readAtMs;
    });
    if (!need) return;
    this._burnTicker = setInterval(() => this.tickBurnCountdowns(), 450);
  },

  teardownBurnTicker() {
    if (!this._burnTicker) return;
    clearInterval(this._burnTicker);
    this._burnTicker = null;
  },

  tickBurnCountdowns() {
    const map = this.data.burnStateById || {};
    const now = Date.now();
    let changed = false;

    const nextMsgs = (this.data.messages || []).map((m) => {
      if (!m || m.type !== 'text') return m;
      const burnAfter = Number(m.burnAfterSec || 0) || 0;
      if (burnAfter <= 0) return m;
      const mid = String(m.messageId || '').trim();
      if (!mid) return m;

      const st = map?.[mid];
      if (!st?.readAtMs || !st?.expireAtMs) return m;

      const expireAt = Number(st.expireAtMs);
      const remainingSec = Math.max(0, Math.ceil((expireAt - now) / 1000));
      const burnedNow = remainingSec <= 0;

      const next = { ...m };
      if (next.burnRemainingSec !== remainingSec) {
        next.burnRemainingSec = remainingSec;
        changed = true;
      }
      if (!!next.burned !== burnedNow) {
        next.burned = burnedNow;
        next.content = burnedNow ? '已焚毁' : next.content;
        changed = true;
      }

      if (burnedNow && !st.burned) {
        map[mid] = { ...st, burned: true };
      }

      return next;
    });

    if (changed) {
      this.setData({ messages: nextMsgs, burnStateById: map });
      saveBurnState(this.data.sessionId, map);
    }

    const hasActive = nextMsgs.some((m) => m?.type === 'text' && m?.burnAfterSec > 0 && !m?.burned);
    if (!hasActive) this.teardownBurnTicker();
  },

  sendMessage() {
    const content = (this.data.input || '').trim();
    if (!content) return;

    this.setData({ input: '' });

    if (!this.data.e2eeReady) {
      this.ensureE2EE();
      wx.showToast({ title: '加密通道建立中', icon: 'none' });
      return;
    }

    const burnAfter = this.data.burnEnabled ? Number(this.data.burnSeconds || DEFAULT_BURN_SECONDS) || DEFAULT_BURN_SECONDS : 0;
    const enc = e2ee.encryptText(this.data.sessionId, content, burnAfter);
    if (!enc?.ok || !enc?.text) {
      this.ensureE2EE();
      wx.showToast({ title: '暂时无法加密发送', icon: 'none' });
      return;
    }

    api
      .sendTextMessage(this.data.sessionId, enc.text)
      .then((msg) => {
        const myId = this.data.myUserId || api.getUser()?.id || '';
        const vm = buildViewMessage(msg, myId, this.data.sessionId, this.data.burnStateById);
        if (!vm) return;
        const id = vm?.messageId || '';
        if (id && this.data.messages.some((m) => m.messageId === id)) return;
        this.setData({ messages: [...this.data.messages, vm] }, () => this.afterMessagesUpdated());
        wx.nextTick(() => this.scrollToBottom());
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
        // WeChat image pickers usually do not provide a stable "original filename".
        // Use a friendly name instead of server-side randomized storage name.
        const rawExt = String(filePath.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
        const ext = rawExt && /^[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : 'jpg';
        const friendlyName = `图片.${ext}`;
        return api.uploadFile(filePath, friendlyName).then((up) => ({ up, friendlyName }));
      })
      .then(({ up, friendlyName }) => {
        const meta = {
          name: friendlyName || '图片',
          sizeBytes: up?.sizeBytes || 0,
          url: up?.url || '',
        };
        return api.sendImageMessage(this.data.sessionId, meta);
      })
      .then((msg) => {
        wx.hideLoading();
        const myId = this.data.myUserId || api.getUser()?.id || '';
        const vm = buildViewMessage(msg, myId, this.data.sessionId, this.data.burnStateById);
        if (!vm) return;
        const id = vm?.messageId || '';
        if (id && this.data.messages.some((m) => m.messageId === id)) return;
        this.setData({ messages: [...this.data.messages, vm], sending: false }, () => this.afterMessagesUpdated());
        wx.nextTick(() => this.scrollToBottom());
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
            const originalName = String(name || '').trim();
            return api.uploadFile(path, originalName).then((up) => ({ up, originalName }));
          })
          .then(({ up, originalName }) => {
            const meta = {
              // Keep the user's original file name for display and for forwarding via `wx.shareFileMessage`.
              name: originalName || up?.name || '文件',
              sizeBytes: up?.sizeBytes || 0,
              url: up?.url || '',
            };
            return api.sendFileMessage(this.data.sessionId, meta);
          })
          .then((msg) => {
            wx.hideLoading();
            const myId = this.data.myUserId || api.getUser()?.id || '';
            const vm = buildViewMessage(msg, myId, this.data.sessionId, this.data.burnStateById);
            if (!vm) return;
            const id = vm?.messageId || '';
            if (id && this.data.messages.some((m) => m.messageId === id)) return;
            this.setData({ messages: [...this.data.messages, vm], sending: false }, () => this.afterMessagesUpdated());
            wx.nextTick(() => this.scrollToBottom());
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
    const name = String(event?.currentTarget?.dataset?.name || '').trim();
    const fullUrl = this.getFileUrl({ url });
    if (!fullUrl) return;

    const sys = (() => {
      try {
        return typeof wx?.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : {};
      } catch (e) {
        return {};
      }
    })();
    const platform = String(sys?.platform || '').toLowerCase();
    const isMobile = platform === 'ios' || platform === 'android';

    if (!isMobile) {
      wx.showToast({ title: 'PC/开发者工具暂不支持分享文件，请在手机上操作', icon: 'none' });
      return;
    }

    if (typeof wx?.shareFileMessage !== 'function') {
      wx.showToast({ title: '当前微信版本不支持分享文件', icon: 'none' });
      return;
    }

    const raw = name || url || fullUrl;
    const ext = String(raw.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
    const safeExt = ext && /^[a-z0-9]{1,10}$/.test(ext) ? ext : 'bin';
    const fileName = name || (safeExt ? `文件.${safeExt}` : '文件');

    // Download directly into USER_DATA_PATH with a proper suffix (Android is picky about extensions).
    const targetPath = `${wx.env.USER_DATA_PATH}/lb_share_${Date.now()}_${Math.floor(Math.random() * 1e6)}.${safeExt}`;

    wx.showLoading({ title: '下载中...' });
    wx.downloadFile({
      url: fullUrl,
      filePath: targetPath,
      success: (res) => {
        wx.hideLoading();
        const localPath = res?.filePath || res?.tempFilePath || '';
        if (!localPath) {
          wx.showToast({ title: '下载失败', icon: 'none' });
          return;
        }

        wx.shareFileMessage({
          filePath: localPath,
          fileName,
          fail: (err) => {
            const msg = String(err?.errMsg || '').toLowerCase();
            if (msg.includes('not supported') || msg.includes('not support')) {
              wx.showToast({ title: '当前环境不支持分享文件', icon: 'none' });
              return;
            }
            wx.showToast({ title: '分享失败', icon: 'none' });
          },
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
    const base = Number(this.data.bottomBarHeight || 0) || 0;
    this.setData({ keyboardHeight: 0, bottomSpacer: base }, () => wx.navigateTo({ url }));
  },

  onClosePeerProfile() {
    this.setData({ peerProfileVisible: false });
  },

  onPeerProfileVisibleChange(e) {
    this.setData({ peerProfileVisible: !!e?.detail?.visible });
  },

  scrollToBottom() {
    const nonce = (Number(this.data.scrollNonce || 0) || 0) + 1;
    // Use an oversized scrollTop to clamp to the bottom, and toggle by 1px to force updates.
    const base = 10_000_000;
    this.setData({ scrollNonce: nonce, scrollTop: base + (nonce % 2) });
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
