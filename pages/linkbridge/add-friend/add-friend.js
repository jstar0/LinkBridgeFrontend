import themeChangeBehavior from 'tdesign-miniprogram/mixins/theme-change';

const api = require('../../../utils/linkbridge/api');

function parseInviteCode(options) {
  if (!options) return '';

  const direct = (options.code || options.c || '').trim();
  if (direct) return direct;

  const sceneRaw = options.scene || '';
  const scene = decodeURIComponent(sceneRaw);
  if (!scene) return '';

  // Common patterns:
  // - "c=abcdef"
  // - "c=abcdef&x=y"
  // - "abcdef" (fallback)
  if (!scene.includes('=')) return scene.trim();

  const kvPairs = scene.split('&').map((p) => p.trim()).filter(Boolean);
  const found = kvPairs.find((p) => p.startsWith('c='));
  if (found) return found.slice(2).trim();

  // Fallback: treat full scene as code if we can't parse it.
  return scene.trim();
}

Page({
  behaviors: [themeChangeBehavior],
  data: {
    loading: false,
    success: false,
    errorMessage: '',
    inviteCode: '',
    peerName: '',
  },

  onLoad(options) {
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/linkbridge/login/login' });
      return;
    }

    const code = parseInviteCode(options);
    this.setData({ inviteCode: code });
    if (code) {
      this.consumeInvite(code);
    }
  },

  onGoBack() {
    wx.navigateBack();
  },

  onTapRetry() {
    const code = this.data.inviteCode;
    if (code) this.consumeInvite(code);
  },

  onTapGoFriends() {
    wx.navigateTo({ url: '/pages/linkbridge/friends/friends' });
  },

  consumeInvite(code) {
    this.setData({ loading: true, success: false, errorMessage: '', peerName: '' });

    api
      .consumeFriendInvite(code)
      .then((request) => {
        const peerId = request?.addresseeId || '';
        if (!peerId) {
          this.setData({ loading: false, success: true });
          return;
        }
        return api
          .getUserById(peerId)
          .then((u) => {
            this.setData({ loading: false, success: true, peerName: u?.displayName || '' });
          })
          .catch(() => {
            this.setData({ loading: false, success: true });
          });
      })
      .catch((err) => {
        const code = err?.code || '';
        let message = err?.message || '操作失败';
        if (code === 'FRIEND_INVITE_INVALID') message = '二维码无效或已过期，请让对方重新生成二维码';
        if (code === 'ALREADY_FRIENDS') message = '你们已经是好友了';
        if (code === 'FRIEND_REQUEST_EXISTS') message = '已发送过好友申请，请等待对方处理';
        if (code === 'VALIDATION_ERROR') message = '参数错误';
        this.setData({ loading: false, success: false, errorMessage: message });
      });
  },
});

