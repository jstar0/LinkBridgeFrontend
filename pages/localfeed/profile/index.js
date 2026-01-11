const POSTS_KEY = 'lb_nearby_posts_mock_v1';

function safeParseJSON(raw, fallback) {
  if (!raw) return fallback;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return obj ?? fallback;
  } catch (e) {
    return fallback;
  }
}

function formatTime(ts) {
  const d = new Date(Number(ts || 0) || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function decoratePost(p) {
  const createdAtMs = Number(p?.createdAtMs || 0) || Date.now();
  const expiresAtMs = Number(p?.expiresAtMs || 0) || createdAtMs + 30 * 24 * 3600 * 1000;
  const radiusKm = Number(p?.radiusKm ?? 1) || 1;
  return {
    ...p,
    createdAtMs,
    expiresAtMs,
    radiusKm: Number(radiusKm.toFixed(2)),
    pinned: !!p?.pinned,
    createdAtText: formatTime(createdAtMs),
    expiresAtText: formatTime(expiresAtMs),
  };
}

function loadPosts() {
  const raw = wx.getStorageSync(POSTS_KEY);
  const list = safeParseJSON(raw, []);
  return Array.isArray(list) ? list : [];
}

Page({
  data: {
    loading: true,
    userId: '',
    name: '',
    avatarUrl: '',
    posts: [],
  },

  onLoad(options) {
    const userId = String(options?.userId || '').trim();
    const name = String(options?.name || '').trim();
    const avatarUrl = String(options?.avatarUrl || '').trim();
    this.setData({ userId, name, avatarUrl });
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const uid = this.data.userId;
    const now = Date.now();
    const posts = loadPosts()
      .filter((p) => (p?.author?.userId || '') === uid)
      .filter((p) => (Number(p?.expiresAtMs || 0) || 0) > now)
      .map(decoratePost)
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return (b.createdAtMs || 0) - (a.createdAtMs || 0);
      })
      .slice(0, 30);

    this.setData({ posts, loading: false });
  },
});

