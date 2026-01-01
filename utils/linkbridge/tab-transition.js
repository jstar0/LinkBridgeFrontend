const app = getApp();

const ORDER = {
  message: 0,
  my: 1,
};

function recordTabTransition(from, to) {
  if (!from || !to) return;
  if (from === to) return;

  const fromIdx = ORDER[from];
  const toIdx = ORDER[to];
  const dir = typeof fromIdx === 'number' && typeof toIdx === 'number' && toIdx > fromIdx ? 1 : -1;

  app.globalData.__lbTabTransition = {
    from,
    to,
    dir,
    ts: Date.now(),
  };
}

function consumeTabTransition(to) {
  const t = app.globalData.__lbTabTransition;
  if (!t) return null;
  if (t.to !== to) return null;
  if (Date.now() - (t.ts || 0) > 1500) {
    app.globalData.__lbTabTransition = null;
    return null;
  }
  app.globalData.__lbTabTransition = null;
  return t;
}

function applyTabTransition(page, key) {
  const t = consumeTabTransition(key);
  if (!t) return;

  const startX = (t.dir || 1) * 24; // px

  const init = wx.createAnimation({ duration: 0, timingFunction: 'linear' });
  init.translateX(startX).opacity(0.92).step();
  page.setData({ pageAnim: init.export() });

  setTimeout(() => {
    const enter = wx.createAnimation({ duration: 220, timingFunction: 'ease-out' });
    enter.translateX(0).opacity(1).step();
    page.setData({ pageAnim: enter.export() });
  }, 16);
}

module.exports = {
  recordTabTransition,
  applyTabTransition,
};

