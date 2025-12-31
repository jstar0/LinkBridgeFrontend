const api = require('../../utils/linkbridge/api');

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return String(value || '');
  }
}

function parseQueryString(qs) {
  const out = {};
  if (!qs) return out;
  qs
    .split('&')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((kv) => {
      const idx = kv.indexOf('=');
      if (idx < 0) return;
      const k = decodeURIComponent(kv.slice(0, idx));
      const v = decodeURIComponent(kv.slice(idx + 1));
      out[k] = v;
    });
  return out;
}

function extractInviteCodeFromPath(path) {
  if (!path) return '';
  const parts = String(path).split('?');
  if (parts.length < 2) return '';
  const query = parseQueryString(parts.slice(1).join('?'));
  if (query.c) return String(query.c);
  if (!query.scene) return '';
  const scene = parseQueryString(safeDecodeURIComponent(String(query.scene)));
  return scene.c ? String(scene.c) : '';
}

Component({
  data: {
    popupVisible: false,
    isLoggedIn: false,
    qrImagePath: '',
  },

  lifetimes: {
    attached() {
      this.refresh();
    },
  },

  methods: {
    refresh() {
      const loggedIn = api.isLoggedIn();
      this.setData({
        isLoggedIn: loggedIn,
        qrImagePath: loggedIn ? this.data.qrImagePath : '',
      });
    },

    loadQrImage() {
      if (!api.isLoggedIn()) {
        this.setData({ qrImagePath: '' });
        return Promise.resolve();
      }

      const token = api.getToken();
      if (!token) {
        this.setData({ qrImagePath: '' });
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        wx.request({
          url: `${api.getBaseUrl()}/v1/wechat/qrcode/session`,
          method: 'GET',
          header: { Authorization: `Bearer ${token}` },
          responseType: 'arraybuffer',
          success: (res) => {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            const fs = wx.getFileSystemManager();
            const filePath = `${wx.env.USER_DATA_PATH}/lb_session_qr.png`;
            fs.writeFile({
              filePath,
              data: res.data,
              encoding: 'binary',
              success: () => {
                this.setData({ qrImagePath: filePath });
                resolve();
              },
              fail: (err) => reject(err),
            });
          },
          fail: (err) => reject(err),
        });
      });
    },

    onOpen() {
      this.refresh();
      this.setData({ popupVisible: true });
      this.loadQrImage().catch(() => {
        wx.showToast({ title: '二维码加载失败', icon: 'none' });
      });
    },

    onClose() {
      this.setData({ popupVisible: false });
    },

    onPopupVisibleChange(e) {
      this.setData({ popupVisible: !!e?.detail?.visible });
    },

    onGoLogin() {
      this.onClose();
      wx.navigateTo({ url: '/pages/login/login' });
    },

    onScan() {
      if (typeof wx?.scanCode !== 'function') {
        wx.showToast({ title: '当前环境不支持扫码', icon: 'none' });
        return;
      }

      wx.scanCode({
        onlyFromCamera: true,
        scanType: ['qrCode'],
        success: (res) => {
          const path = res?.path || '';
          if (!path) {
            wx.showToast({ title: '请扫描小程序码', icon: 'none' });
            return;
          }

          const inviteCode = extractInviteCodeFromPath(path);
          if (!inviteCode) {
            // Fallback: navigate to the embedded path (for compatibility).
            this.onClose();
            const url = path.startsWith('/') ? path : `/${path}`;
            wx.navigateTo({ url });
            return;
          }

          if (!api.isLoggedIn()) {
            try {
              wx.setStorageSync('lb_pending_invite_code', inviteCode);
            } catch (e) {
              // ignore
            }
            this.onClose();
            wx.navigateTo({ url: '/pages/login/login' });
            return;
          }

          wx.showLoading({ title: '处理中...' });
          api
            .consumeSessionInvite(inviteCode)
            .then(() => {
              wx.hideLoading();
              this.onClose();
              wx.showToast({ title: '已发送会话请求', icon: 'none' });
              wx.switchTab({ url: '/pages/message/index' });
            })
            .catch((err) => {
              wx.hideLoading();
              const msg = err?.message || '处理失败';
              wx.showToast({ title: msg, icon: 'none' });
            });
        },
        fail: () => {
          wx.showToast({ title: '已取消', icon: 'none' });
        },
      });
    },
  },
});
