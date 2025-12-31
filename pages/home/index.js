Page({
  goMy() {
    wx.switchTab({ url: '/pages/my/index' });
  },

  goMessage() {
    wx.switchTab({ url: '/pages/message/index' });
  },
});
