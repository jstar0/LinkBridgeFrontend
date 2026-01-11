const app = getApp();

Component({
  data: {
    value: '', // 初始值设置为空，避免第一次加载时闪烁
    unreadNum: 0, // 未读消息数量
    indicatorLeft: '0%',
    indicatorWidth: '50%',
    list: [
      {
        icon: 'chat',
        value: 'message',
        label: '会话',
      },
      {
        icon: 'location',
        value: 'nearby',
        label: '附近',
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
      this.setData({ indicatorWidth: this.calcIndicatorWidth() });

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
    calcIndicatorLeft(value) {
      const idx = this.data.list.findIndex((t) => t.value === value);
      const total = Math.max(1, this.data.list.length);
      const safeIdx = idx >= 0 ? idx : 0;
      return `${(safeIdx * 100) / total}%`;
    },

    calcIndicatorWidth() {
      const total = Math.max(1, this.data.list.length);
      return `${100 / total}%`;
    },

    onTap(e) {
      const value = e?.currentTarget?.dataset?.value || '';
      if (!value) return;
      if (value === this.data.value) return;

      const indicatorLeft = this.calcIndicatorLeft(value);
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
        indicatorLeft: this.calcIndicatorLeft(value),
        indicatorWidth: this.calcIndicatorWidth(),
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
      if (value === 'message' || value === 'nearby' || value === 'my') this.setValue(value);
    },
  },
});
