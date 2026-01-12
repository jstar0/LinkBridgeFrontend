const VIEWER_LOC_KEY = 'lb_localfeed_viewer_loc_v1';

const api = require('../../../utils/linkbridge/api');

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
  return {
    ...p,
    createdAtMs,
    expiresAtMs,
    pinned: !!p?.pinned,
    createdAtText: formatTime(createdAtMs),
    expiresAtText: formatTime(expiresAtMs),
  };
}

function toFullUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return `${api.getBaseUrl()}${u.startsWith('/') ? '' : '/'}${u}`;
}

function normalizeServerPostItem(post) {
  const p = post || {};
  const images = Array.isArray(p.images) ? p.images : [];
  const urls = images.map((img) => toFullUrl(img?.url)).filter(Boolean);

  return decoratePost({
    id: String(p.id || ''),
    text: typeof p.text === 'string' ? p.text : '',
    images: urls,
    pinned: !!p.isPinned,
    createdAtMs: Number(p.createdAtMs || 0) || Date.now(),
    expiresAtMs: Number(p.expiresAtMs || 0) || Date.now() + 30 * 24 * 3600 * 1000,
  });
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
    viewerLat: null,
    viewerLng: null,
  },

  onLoad(options) {
    const userId = String(options?.userId || '').trim();
    const name = String(options?.name || '').trim();
    const avatarUrl = String(options?.avatarUrl || '').trim();
    const atLat = Number(options?.atLat);
    const atLng = Number(options?.atLng);
    this.setData({
      userId,
      name,
      avatarUrl,
      viewerLat: Number.isFinite(atLat) ? atLat : null,
      viewerLng: Number.isFinite(atLng) ? atLng : null,
    });
  },

  onShow() {
    const la = Number(this.data.viewerLat);
    const ln = Number(this.data.viewerLng);
    if (Number.isFinite(la) && Number.isFinite(ln)) {
      this.refresh();
      return;
    }
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
    const uid = String(this.data.userId || '').trim();
    if (!uid) return;

    const explicitLat = Number(this.data.viewerLat);
    const explicitLng = Number(this.data.viewerLng);
    const viewer =
      Number.isFinite(explicitLat) && Number.isFinite(explicitLng) ? { lat: explicitLat, lng: explicitLng } : loadViewerLoc();
    this.setData({ loading: true });

    api
      .listLocalFeedUserPosts(uid, viewer?.lat, viewer?.lng)
      .then((posts) => {
        const normalized = (posts || [])
          .map((p) => normalizeServerPostItem(p))
          .filter((p) => p && p.id)
          .slice(0, 30);
        this.setData({ posts: normalized, loading: false });
      })
      .catch(() => this.setData({ posts: [], loading: false }));
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
