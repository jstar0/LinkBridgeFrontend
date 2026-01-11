const POSTS_KEY = 'lb_nearby_posts_mock_v1';
const VIEWER_LOC_KEY = 'lb_localfeed_viewer_loc_v1';

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

function loadViewerLoc() {
  const raw = wx.getStorageSync(VIEWER_LOC_KEY);
  const obj = safeParseJSON(raw, null);
  const lat = Number(obj?.lat);
  const lng = Number(obj?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function saveViewerLoc(lat, lng) {
  wx.setStorageSync(VIEWER_LOC_KEY, JSON.stringify({ lat, lng, ts: Date.now() }));
}

// Haversine distance (km)
function distanceKm(aLat, aLng, bLat, bLng) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const aa = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
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
    this.ensureViewerLocation().finally(() => this.refresh());
  },

  ensureViewerLocation() {
    if (typeof wx?.getLocation !== 'function') return Promise.resolve();
    return new Promise((resolve) => {
      wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: true,
        success: (res) => {
          const lat = Number(res?.latitude);
          const lng = Number(res?.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lng)) saveViewerLoc(lat, lng);
          resolve();
        },
        fail: () => resolve(),
      });
    });
  },

  refresh() {
    const uid = this.data.userId;
    const now = Date.now();
    const viewer = loadViewerLoc();

    const posts = loadPosts()
      .filter((p) => (p?.author?.userId || '') === uid)
      .filter((p) => (Number(p?.expiresAtMs || 0) || 0) > now)
      .filter((p) => {
        // Enforce publisher-defined radius (best-effort on frontend mock).
        const r = Number(p?.radiusKm ?? 1) || 1;
        const lat = Number(p?.lat);
        const lng = Number(p?.lng);
        if (![lat, lng, r].every(Number.isFinite)) return true;
        if (!viewer) return true;
        return distanceKm(viewer.lat, viewer.lng, lat, lng) <= r;
      })
      .map(decoratePost)
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return (b.createdAtMs || 0) - (a.createdAtMs || 0);
      })
      .slice(0, 30);

    this.setData({ posts, loading: false });
  },

  onPreviewImage(e) {
    const postId = String(e?.currentTarget?.dataset?.postid || '').trim();
    const idx = Number(e?.currentTarget?.dataset?.index || 0);
    const post = (this.data.posts || []).find((p) => String(p?.id || '') === postId);
    const imgs = Array.isArray(post?.images) ? post.images.filter(Boolean) : [];
    if (!imgs.length) return;
    wx.previewImage({ urls: imgs, current: imgs[idx] || imgs[0] });
  },
});
