const TAB_VALUE_TO_URL = {
  dashboard: '/pages/linkbridge/dashboard/dashboard',
  search: '/pages/linkbridge/search/search',
  settings: '/pages/linkbridge/settings/settings',
};

Component({
  properties: {
    value: { type: String, value: '' },
    current: { type: String, value: '' },
  },

  data: {
    innerValue: '',
  },

  observers: {
    value(value) {
      this.syncInnerValue(value);
    },
    current(current) {
      if (!this.properties.value) {
        this.syncInnerValue(current);
      }
    },
  },

  lifetimes: {
    attached() {
      this.syncInnerValue(this.properties.value || this.properties.current || 'dashboard');
    },
  },

  methods: {
    syncInnerValue(nextValue) {
      if (!nextValue || nextValue === this.data.innerValue) return;
      this.setData({ innerValue: nextValue });
    },

    onChange(event) {
      const nextValue = event?.detail?.value;
      if (!nextValue || nextValue === this.data.innerValue) return;

      this.setData({ innerValue: nextValue });

      const url = TAB_VALUE_TO_URL[nextValue];
      if (!url) return;

      wx.reLaunch({ url });
    },
  },
});

