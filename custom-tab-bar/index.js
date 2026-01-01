const app = getApp();

Component({
  data: {
    value: '', // 初始值设置为空，避免第一次加载时闪烁
    unreadNum: 0, // 未读消息数量
    indicatorLeft: '0%',
    list: [
      {
        icon: 'chat',
        value: 'message',
        label: '会话',
      },
      {
        icon: 'user',
        value: 'my',
        label: '我的',
      },
    ],
  },
  lifetimes: {
    ready() {
      this.syncRouteValue();

      // 同步全局未读消息数量
      this.setUnreadNum(app.globalData.unreadNum);
      app.eventBus.on('unread-num-change', (unreadNum) => {
        this.setUnreadNum(unreadNum);
      });
    },
  },
  pageLifetimes: {
    show() {
      this.syncRouteValue();
    },
  },
  methods: {
    onTap(e) {
      const value = e?.currentTarget?.dataset?.value || '';
      if (!value) return;
      if (value === this.data.value) return;

      const indicatorLeft = value === 'my' ? '50%' : '0%';
      // Ensure the underline updates on the first tap (setData callback before switchTab).
      this.setData({ value, indicatorLeft }, () => {
        wx.switchTab({ url: `/pages/${value}/index` });
      });
    },

    /** 设置未读消息数量 */
    setUnreadNum(unreadNum) {
      this.setData({ unreadNum });
    },

    setValue(value) {
      if (!value) return;
      this.setData({
        value,
        indicatorLeft: value === 'my' ? '50%' : '0%',
      });
    },

    // Allow pages to force-sync the selected tab on show.
    setActive(value) {
      if (!value) return;
      if (value === this.data.value) return;
      this.setValue(value);
    },

    syncRouteValue() {
      const pages = getCurrentPages();
      const curPage = pages[pages.length - 1];
      const route = curPage?.route || '';
      const match = /pages\/(\w+)\/index/.exec(route);
      const value = match?.[1] || '';
      if (value === 'message' || value === 'my') this.setValue(value);
    },
  },
});
