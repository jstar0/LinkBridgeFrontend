const api = require('../../utils/linkbridge/api');

Component({
  data: {
    popupVisible: false,
    isLoggedIn: false,
    qrUrl: '',
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
        qrUrl: loggedIn ? api.getMySessionQrImageUrl(Date.now()) : '',
      });
    },

    onOpen() {
      this.refresh();
      this.setData({ popupVisible: true });
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
          if (path) {
            this.onClose();
            const url = path.startsWith('/') ? path : `/${path}`;
            wx.navigateTo({ url });
            return;
          }
          wx.showToast({ title: '请扫描小程序码', icon: 'none' });
        },
        fail: () => {
          wx.showToast({ title: '已取消', icon: 'none' });
        },
      });
    },
  },
});

