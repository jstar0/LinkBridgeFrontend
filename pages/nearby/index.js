import useToastBehavior from '~/behaviors/useToast';

const api = require('../../utils/linkbridge/api');

const POSTS_KEY = 'lb_nearby_posts_mock_v1';
const COOLDOWN_MS = 3 * 24 * 3600 * 1000;
const HOMEBASE_GUIDE_KEY_PREFIX = 'lb_localfeed_homebase_guide_shown_v1_';

function getHomeBaseGuideKey(userId) {
  const id = String(userId || '').trim();
  return `${HOMEBASE_GUIDE_KEY_PREFIX}${id || 'anonymous'}`;
}

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

function clampNum(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function roundFixed(n, digits) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return v.toFixed(digits);
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

function formatRemaining(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v <= 0) return '0分钟';
  const totalMinutes = Math.ceil(v / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes - days * 60 * 24) / 60);
  const minutes = totalMinutes - days * 60 * 24 - hours * 60;
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  return `${minutes}分钟`;
}

function safeHideLoading() {
  try {
    const p = wx.hideLoading();
    if (p && typeof p.catch === 'function') p.catch(() => null);
  } catch (e) {
    // ignore
  }
}

function toFullUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return `${api.getBaseUrl()}${u.startsWith('/') ? '' : '/'}${u}`;
}

function normalizeServerLocalFeedPostItem(post, me) {
  const p = post || {};
  const expiresAtMs = Number(p.expiresAtMs || 0) || Date.now() + 30 * 24 * 3600 * 1000;
  const createdAtMs = Number(p.createdAtMs || 0) || Date.now();

  const images = Array.isArray(p.images) ? p.images : [];
  const urls = images.map((img) => toFullUrl(img?.url)).filter(Boolean);

  return decoratePost({
    id: String(p.id || ''),
    author: {
      userId: String(p.userId || me?.id || ''),
      displayName: me?.displayName || me?.username || '我',
      avatarUrl: me?.avatarUrl || '/static/chat/avatar.png',
    },
    text: typeof p.text === 'string' ? p.text : '',
    images: urls,
    lat: Number.NaN,
    lng: Number.NaN,
    createdAtMs,
    expiresAtMs,
    pinned: !!p.isPinned,
  });
}

function loadPosts() {
  const raw = wx.getStorageSync(POSTS_KEY);
  const list = safeParseJSON(raw, []);
  if (!Array.isArray(list)) return [];
  return list;
}

function savePosts(list) {
  wx.setStorageSync(POSTS_KEY, JSON.stringify(list || []));
}

function decoratePost(p) {
  const createdAtMs = Number(p?.createdAtMs || 0) || Date.now();
  const expiresAtMs = Number(p?.expiresAtMs || 0) || createdAtMs + 30 * 24 * 3600 * 1000;
  const pinned = !!p?.pinned;
  return {
    ...p,
    createdAtMs,
    expiresAtMs,
    pinned,
    createdAtText: formatTime(createdAtMs),
    expiresAtText: formatTime(expiresAtMs),
  };
}

function normalizeIconPath(path) {
  const p = String(path || '').trim();
  if (!p) return '/static/chat/avatar.png';
  if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('/')) return p;
  return '/static/chat/avatar.png';
}

function buildPinsFromPosts(posts, myHomeBase, myUserId) {
  const list = Array.isArray(posts) ? posts : [];
  const map = new Map();
  for (const p of list) {
    const uid = String(p?.author?.userId || '').trim();
    if (!uid) continue;
    if (!map.has(uid)) {
      map.set(uid, {
        userId: uid,
        displayName: String(p?.author?.displayName || ''),
        avatarUrl: String(p?.author?.avatarUrl || ''),
        lat: Number(p?.lat),
        lng: Number(p?.lng),
        posts: [],
      });
    }
    map.get(uid).posts.push(p);
  }

  const pins = [];
  for (const [, v] of map.entries()) {
    const postsOfUser = (v.posts || []).slice().sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.createdAtMs || 0) - (a.createdAtMs || 0);
    });
    const top = postsOfUser[0];

    let lat = Number(v.lat);
    let lng = Number(v.lng);
    if (myUserId && v.userId === myUserId && myHomeBase) {
      lat = Number(myHomeBase.lat);
      lng = Number(myHomeBase.lng);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    pins.push({
      userId: v.userId,
      displayName: v.displayName || '本地的人',
      avatarUrl: v.avatarUrl,
      lat,
      lng,
      postsCount: postsOfUser.length,
      topText: String(top?.text || ''),
      previewPosts: postsOfUser.slice(0, 3),
    });
  }

  return pins;
}

function normalizePinsFromServer(pins) {
  const list = Array.isArray(pins) ? pins : [];
  return list
    .map((p) => {
      const userId = String(p?.userId || '').trim();
      const lat = Number(p?.lat);
      const lng = Number(p?.lng);
      if (!userId || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        userId,
        displayName: String(p?.displayName || '本地的人'),
        avatarUrl: String(p?.avatarUrl || ''),
        lat,
        lng,
        postsCount: 0,
        topText: '',
        previewPosts: [],
      };
    })
    .filter(Boolean);
}

function clusterPins(pins, scale) {
  const s = Number(scale);
  if (!Number.isFinite(s) || s >= 14) return (pins || []).map((p) => ({ type: 'pin', pin: p }));

  const gridKm = s <= 10 ? 2.0 : s <= 12 ? 1.2 : 0.8;
  const clusters = new Map();
  for (const p of pins || []) {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const latStep = gridKm / 110.574;
    const lngStep = gridKm / (111.32 * Math.cos((lat * Math.PI) / 180) || 1);
    const key = `${Math.floor(lat / latStep)}_${Math.floor(lng / lngStep)}`;
    if (!clusters.has(key)) clusters.set(key, { latSum: 0, lngSum: 0, items: [] });
    const c = clusters.get(key);
    c.latSum += lat;
    c.lngSum += lng;
    c.items.push(p);
  }

  const out = [];
  for (const [, c] of clusters.entries()) {
    if (c.items.length === 1) out.push({ type: 'pin', pin: c.items[0] });
    else {
      out.push({
        type: 'cluster',
        count: c.items.length,
        lat: c.latSum / c.items.length,
        lng: c.lngSum / c.items.length,
      });
    }
  }

  out.sort((a, b) => {
    const ca = a.type === 'cluster' ? a.count : 1;
    const cb = b.type === 'cluster' ? b.count : 1;
    return cb - ca;
  });

  return out;
}

function toMarkersFromItems(items, maxCount = 150) {
  const out = [];
  const meta = {};
  const list = Array.isArray(items) ? items.slice(0, maxCount) : [];
  list.forEach((it, idx) => {
    if (it.type === 'cluster') {
      const lat = Number(it.lat);
      const lng = Number(it.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      meta[idx] = { type: 'cluster', lat, lng, count: it.count };
      out.push({
        id: idx,
        latitude: lat,
        longitude: lng,
        width: 34,
        height: 34,
        iconPath: '/static/icon_map.png',
        label: {
          content: String(it.count),
          color: '#ffffff',
          fontSize: 12,
          bgColor: '#0052d9',
          borderRadius: 16,
          padding: 6,
          textAlign: 'center',
        },
        callout: {
          content: `${it.count} 人`,
          display: 'BYCLICK',
          padding: 6,
          borderRadius: 8,
        },
      });
      return;
    }

    const p = it.pin;
    const lat = Number(p?.lat);
    const lng = Number(p?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    meta[idx] = { type: 'pin', userId: p.userId };
    out.push({
      id: idx,
      latitude: lat,
      longitude: lng,
      width: 42,
      height: 42,
      iconPath: normalizeIconPath(p.avatarUrl),
      callout: {
        content: `${p.displayName || '本地的人'}`,
        display: 'BYCLICK',
        padding: 6,
        borderRadius: 10,
      },
    });
  });

  return { markers: out, markerMeta: meta };
}

function filterVisiblePosts(posts, viewerLat, viewerLng, nowMs) {
  const now = Number(nowMs || 0) || Date.now();
  const list = Array.isArray(posts) ? posts : [];
  return list
    .filter((p) => (Number(p?.expiresAtMs || 0) || 0) > now)
    .map(decoratePost)
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.createdAtMs || 0) - (a.createdAtMs || 0);
    });
}

function inBbox(lat, lng, bbox) {
  const b = bbox || {};
  const sw = b?.southwest || b?.sw;
  const ne = b?.northeast || b?.ne;
  const swLat = Number(sw?.latitude ?? sw?.lat);
  const swLng = Number(sw?.longitude ?? sw?.lng);
  const neLat = Number(ne?.latitude ?? ne?.lat);
  const neLng = Number(ne?.longitude ?? ne?.lng);
  if (![swLat, swLng, neLat, neLng].every(Number.isFinite)) return true;
  return lat >= swLat && lat <= neLat && lng >= swLng && lng <= neLng;
}

function limitMarkers(posts, bbox, maxCount) {
  const list = Array.isArray(posts) ? posts : [];
  const max = Number(maxCount) > 0 ? Number(maxCount) : 120;
  const filtered = list.filter((p) => inBbox(Number(p.lat), Number(p.lng), bbox));
  if (filtered.length <= max) return filtered;
  return filtered.slice(0, max);
}

function normalizeHomeBaseFromServer(homeBase) {
  if (!homeBase) return null;
  const lat = Number(homeBase.lat);
  const lng = Number(homeBase.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const radiusM = Number(homeBase.radiusM);
  const safeRadiusM = Number.isFinite(radiusM) && radiusM > 0 ? Math.round(radiusM) : 1100;
  const radiusText = `${(safeRadiusM / 1000).toFixed(safeRadiusM % 1000 === 0 ? 0 : 1)}km`;
  return {
    name: '',
    lat,
    lng,
    latText: roundFixed(lat, 6),
    lngText: roundFixed(lng, 6),
    radiusM: safeRadiusM,
    radiusText,
    lastUpdatedYmd: Number(homeBase.lastUpdatedYmd || 0) || 0,
    updatedAtMs: Number(homeBase.updatedAtMs || 0) || 0,
  };
}

function calcModeIndicatorLeft(mode) {
  return mode === 'publish' ? '50%' : '0%';
}

Page({
  behaviors: [useToastBehavior],

  data: {
    isLoggedIn: false,
    center: { lat: 31.2304, lng: 121.4737 }, // fallback: Shanghai
    locationStatus: '未定位',

    viewMode: 'map', // map | publish
    modeIndicatorLeft: '0%',
    modeIndicatorWidth: '50%',

    homeBase: null,
    needHomeBase: false,

    posts: [],
    pins: [],
    markers: [],
    markerMeta: {},
    mapScale: 14,
    selectedUser: null,
    selectedUserPosts: [],
    detailVisible: false,

    myPosts: [],

    mapRegion: null,

    requestsVisible: false,
    loadingRequests: false,
    pendingRequests: [],

    publishVisible: false,
    draft: { text: '', images: [], ttlDays: '30', pinned: false },

    verificationVisible: false,
    verificationText: '',

    relationshipByUserId: {},
    dailyLimitReached: false,
    connectButtonText: '申请建立连接',
    connectButtonDisabled: false,
    connectButtonHint: '',
  },

  getPinsQueryParams() {
    const center = this.data.center || {};
    const centerLat = Number(center.lat);
    const centerLng = Number(center.lng);

    let minLat;
    let maxLat;
    let minLng;
    let maxLng;

    const region = this.data.mapRegion;
    const sw = region?.southwest;
    const ne = region?.northeast;
    if (sw && ne) {
      minLat = Number(sw.latitude);
      minLng = Number(sw.longitude);
      maxLat = Number(ne.latitude);
      maxLng = Number(ne.longitude);
    }

    if (![minLat, minLng, maxLat, maxLng, centerLat, centerLng].every(Number.isFinite)) {
      const s = clampNum(this.data.mapScale || 14, 5, 18);
      const factor = Math.pow(2, 14 - s);
      const latSpan = clampNum(0.06 * factor, 0.008, 0.6);
      const lngSpan = clampNum(latSpan / (Math.cos((centerLat * Math.PI) / 180) || 1), 0.008, 0.6);
      minLat = centerLat - latSpan;
      maxLat = centerLat + latSpan;
      minLng = centerLng - lngSpan;
      maxLng = centerLng + lngSpan;
    }

    return { minLat, maxLat, minLng, maxLng, centerLat, centerLng, limit: 200 };
  },

  scheduleRefreshFeed() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshFeed();
    }, 80);
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && typeof tabBar.setActive === 'function') tabBar.setActive('nearby');

    const loggedIn = api.isLoggedIn();
    this.setData({ isLoggedIn: loggedIn });

    if (loggedIn) api.connectWebSocket();

    const me = api.getUser() || {};

    const homeBaseTask = loggedIn
      ? this.refreshHomeBaseFromServer()
      : Promise.resolve({ homeBase: null, needHomeBase: false });

    Promise.allSettled([this.ensureLocation(), homeBaseTask])
      .catch(() => null)
      .then(() => this.refreshFeed())
      .then(() => this.refreshMyPosts())
      .then(() => {
        if (loggedIn) this.loadRequests();
      })
      .then(() => {
        const needHomeBase = !!this.data.needHomeBase;
        // Strong onboarding: if Home Base is missing, guide user to set it (once per user).
        if (loggedIn && needHomeBase && me?.id) {
          try {
            const key = getHomeBaseGuideKey(me.id);
            const shown = !!wx.getStorageSync(key);
            if (!shown) {
              wx.setStorageSync(key, 1);
              wx.showModal({
                title: '需要设置我的位置',
                content: '首次使用本地信息流需要先设置我的位置，否则无法发布且你的头像点位不会出现在地图上。',
                confirmText: '去设置',
                cancelText: '稍后',
                success: (res) => {
                  if (res?.confirm) this.onSwitchMode({ currentTarget: { dataset: { mode: 'publish' } } });
                },
              });
            }
          } catch (e) {
            // ignore
          }
          // Default to publish view so the user sees the setup UI immediately.
          this.setData({ viewMode: 'publish', modeIndicatorLeft: calcModeIndicatorLeft('publish') });
        }
      });

    if (loggedIn) this.bindWs();
  },

  onHide() {
    this.unbindWs();
    this.stopCooldownTimer();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  onUnload() {
    this.unbindWs();
    this.stopCooldownTimer();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  bindWs() {
    if (this.wsHandler) return;
    this.wsHandler = (env) => {
      if (!env?.type) return;
      if (env.type === 'session.requested') {
        this.loadRequests();
        return;
      }
      if (env.type === 'session.request.accepted' || env.type === 'session.request.rejected') {
        this.loadRequests();
        const req = env?.payload?.request;
        const session = env?.payload?.session;
        const me = api.getUser() || {};
        if (req?.requesterId && me?.id && req.requesterId === me.id) {
          const peerId = req?.addresseeId || '';
          if (!peerId) return;
          if (env.type === 'session.request.accepted' && session?.id) {
            this.setRelationshipStatus(peerId, { state: 'chat', sessionId: session.id });
          } else if (env.type === 'session.request.rejected') {
            this.setRelationshipStatus(peerId, { state: 'cooldown', untilMs: Date.now() + COOLDOWN_MS });
          }
        }
      }
    };
    api.addWebSocketHandler(this.wsHandler);
  },

  unbindWs() {
    if (!this.wsHandler) return;
    api.removeWebSocketHandler(this.wsHandler);
    this.wsHandler = null;
  },

  ensureLocation() {
    if (typeof wx?.getLocation !== 'function') {
      this.setData({ locationStatus: '当前环境不支持定位' });
      return Promise.resolve(null);
    }

    this.setData({ locationStatus: '定位中…' });
    return new Promise((resolve) => {
      wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: true,
        success: (res) => {
          const lat = Number(res?.latitude);
          const lng = Number(res?.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            this.setData({ locationStatus: '定位失败' }, () => resolve(null));
            return;
          }
          this.setData({ center: { lat, lng }, locationStatus: '已定位' }, () => resolve({ lat, lng }));
        },
        fail: (err) => {
          const msg = String(err?.errMsg || '').toLowerCase();
          const isAuth =
            msg.includes('auth deny') ||
            msg.includes('authorize') ||
            msg.includes('auth') ||
            msg.includes('permission') ||
            msg.includes('no permission');
          this.setData({ locationStatus: isAuth ? '定位失败/未授权' : '定位失败' }, () => resolve(null));
        },
      });
    });
  },

  refreshFeed() {
    if (!api.isLoggedIn()) {
      this.setData({ pins: [], markers: [], markerMeta: {} });
      return;
    }

    const q = this.getPinsQueryParams();
    api
      .listLocalFeedPins(q)
      .then((pins) => {
        const normalized = normalizePinsFromServer(pins);
        const pinsInView = limitMarkers(normalized, this.data.mapRegion, 300);
        const clustered = clusterPins(pinsInView, this.data.mapScale);
        const { markers, markerMeta } = toMarkersFromItems(clustered, 150);
        this.setData({ pins: normalized, markers, markerMeta });
      })
      .catch(() => {
        // Keep old markers to avoid flicker; if it's the first load, it stays empty.
      });
  },

  refreshHomeBaseFromServer() {
    if (!api.isLoggedIn()) {
      this.setData({ homeBase: null, needHomeBase: false });
      return Promise.resolve({ homeBase: null, needHomeBase: false });
    }

    return api
      .getLocalFeedHomeBase()
      .then((hb) => {
        const homeBase = normalizeHomeBaseFromServer(hb);
        const needHomeBase = !homeBase;
        this.setData({ homeBase, needHomeBase });
        return { homeBase, needHomeBase };
      })
      .catch(() => {
        // Keep previous value to avoid flicker.
        const homeBase = this.data.homeBase || null;
        const needHomeBase = !!api.isLoggedIn() && !homeBase;
        this.setData({ needHomeBase });
        return { homeBase, needHomeBase };
      });
  },

  refreshMyPosts() {
    if (!api.isLoggedIn()) {
      this.setData({ myPosts: [] });
      return Promise.resolve();
    }

    const me = api.getUser() || {};
    return api
      .listMyLocalFeedPosts()
      .then((posts) => {
        const normalized = (posts || [])
          .map((p) => normalizeServerLocalFeedPostItem(p, me))
          .filter((p) => p && p.id)
          .slice(0, 50);
        this.setData({ myPosts: normalized });
      })
      .catch(() => null);
  },

  refreshSelectedUserPosts(userId) {
    const uid = String(userId || '').trim();
    if (!uid) return;
    if (!api.isLoggedIn()) return;

    const center = this.data.center || {};
    const atLat = Number(center.lat);
    const atLng = Number(center.lng);
    api
      .listLocalFeedUserPosts(uid, atLat, atLng)
      .then((posts) => {
        const me = api.getUser() || {};
        const normalized = (posts || [])
          .map((p) => normalizeServerLocalFeedPostItem(p, me))
          .filter((p) => p && p.id)
          .slice(0, 3);
        this.setData({ selectedUserPosts: normalized });
      })
      .catch(() => null);
  },

  onSwitchMode(e) {
    const mode = e?.currentTarget?.dataset?.mode || 'map';
    if (mode !== 'map' && mode !== 'publish') return;
    if (mode === this.data.viewMode) return;
    this.setData({
      viewMode: mode,
      modeIndicatorLeft: calcModeIndicatorLeft(mode),
      modeIndicatorWidth: '50%',
    });
  },

  onRefresh() {
    this.ensureLocation()
      .catch(() => null)
      .then(() => {
        this.refreshFeed();
        return this.refreshMyPosts();
      })
      .then(() => {
        if (this.data.isLoggedIn) this.loadRequests();
      });
  },

  onDeleteMyPost(e) {
    if (!api.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    const postId = String(e?.currentTarget?.dataset?.id || '').trim();
    if (!postId) return;

    const title = String(e?.currentTarget?.dataset?.title || '').trim();
    const hint = title ? `「${title.slice(0, 40)}」` : '这条发布';

    wx.showModal({
      title: '删除发布',
      content: `确定要删除${hint}吗？删除后将对附近的人不可见。`,
      confirmText: '删除',
      cancelText: '取消',
      confirmColor: '#e34d59',
      success: (res) => {
        if (!res?.confirm) return;

        wx.showLoading({ title: '删除中...' });
        api
          .deleteLocalFeedPost(postId)
          .then((r) => {
            if (r?.deleted === false) throw new Error('delete failed');
          })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'none' });
            return this.refreshMyPosts();
          })
          .catch((err) => {
            wx.showToast({ title: err?.message || '删除失败', icon: 'none' });
          })
          .finally(() => safeHideLoading());
      },
    });
  },

  onMarkerTap(e) {
    const id = Number(e?.detail?.markerId);
    const meta = this.data.markerMeta?.[id];
    if (!meta) return;

    if (meta.type === 'cluster') {
      const lat = Number(meta.lat);
      const lng = Number(meta.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const cur = Number(this.data.mapScale) || 14;
      const next = Math.min(18, cur + 2);
      this.setData({ center: { lat, lng }, mapScale: next }, () => this.refreshFeed());
      return;
    }

    const userId = String(meta.userId || '').trim();
    if (!userId) return;
    const pin = (this.data.pins || []).find((p) => p.userId === userId);
    if (!pin) return;

    this.setData(
      {
        selectedUser: { userId: pin.userId, displayName: pin.displayName, avatarUrl: pin.avatarUrl },
        selectedUserPosts: [],
        detailVisible: true,
      },
      () => {
        this.refreshConnectUi();
        this.refreshRelationshipStatusForUser(userId);
        this.refreshSelectedUserPosts(userId);
      }
    );
  },

  onRegionChange(e) {
    // When user drags/zooms the map, refresh feed based on the new center.
    if (e?.type !== 'end') return;
    if (typeof wx?.createMapContext !== 'function') return;
    const ctx = wx.createMapContext('lfMap', this);
    if (!ctx || typeof ctx.getCenterLocation !== 'function') return;

    const nextScale = Number(e?.detail?.scale);
    const scaleChanged = Number.isFinite(nextScale) && nextScale !== this.data.mapScale;
    if (scaleChanged) this.setData({ mapScale: nextScale }, () => this.scheduleRefreshFeed());

    if (typeof ctx.getRegion === 'function') {
      ctx.getRegion({
        success: (res) => {
          if (res?.southwest && res?.northeast) this.setData({ mapRegion: res }, () => this.scheduleRefreshFeed());
        },
      });
    }

    ctx.getCenterLocation({
      success: (res) => {
        const lat = Number(res?.latitude);
        const lng = Number(res?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        // Avoid setData storms: only update when center changes enough.
        const prev = this.data.center || {};
        const d = distanceKm(Number(prev.lat), Number(prev.lng), lat, lng);
        if (Number.isFinite(d) && d < 0.05) {
          if (!scaleChanged) return; // ~50m
          this.scheduleRefreshFeed();
          return;
        }
        this.setData({ center: { lat, lng } }, () => this.scheduleRefreshFeed());
      },
    });
  },

  onDetailVisibleChange(e) {
    const v = !!e?.detail?.visible;
    this.setData({ detailVisible: v });
    if (!v) this.stopCooldownTimer();
  },

  onCloseDetail() {
    this.setData({ detailVisible: false });
    this.stopCooldownTimer();
  },

  onViewProfile() {
    const selected = this.data.selectedUser;
    const userId = selected?.userId || '';
    if (!userId) return;
    const name = selected?.displayName || '';
    const avatarUrl = selected?.avatarUrl || '';
    const center = this.data.center || {};
    const atLat = Number(center.lat);
    const atLng = Number(center.lng);
    const url =
      `/pages/localfeed/profile/index?userId=${encodeURIComponent(userId)}` +
      (name ? `&name=${encodeURIComponent(name)}` : '') +
      (avatarUrl ? `&avatarUrl=${encodeURIComponent(avatarUrl)}` : '') +
      (Number.isFinite(atLat) ? `&atLat=${encodeURIComponent(atLat)}` : '') +
      (Number.isFinite(atLng) ? `&atLng=${encodeURIComponent(atLng)}` : '');
    wx.navigateTo({ url });
  },

  onTapConnect() {
    if (this.data.needHomeBase) {
      this.onShowToast('#t-toast', '请先设置我的位置');
      this.onSwitchMode({ currentTarget: { dataset: { mode: 'publish' } } });
      return;
    }

    const selected = this.data.selectedUser;
    const peerId = selected?.userId || '';
    if (!peerId) return;

    if (!api.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    const status = this.data.relationshipByUserId?.[peerId] || { state: 'none' };
    if (status.state === 'self') {
      this.onShowToast('#t-toast', '不能向自己发起请求');
      return;
    }
    if (status.state === 'chat' && status.sessionId) {
      const peerName = selected?.displayName || '';
      const url =
        `/pages/chat/index?sessionId=${encodeURIComponent(status.sessionId)}` +
        (peerName ? `&peerName=${encodeURIComponent(peerName)}` : '') +
        `&peerUserId=${encodeURIComponent(peerId)}`;
      wx.navigateTo({ url });
      return;
    }
    if (status.state === 'pending') {
      this.onShowToast('#t-toast', '已发送请求，等待对方同意');
      return;
    }
    if (status.state === 'cooldown' && status.untilMs) {
      const left = Math.max(0, Number(status.untilMs) - Date.now());
      this.onShowToast('#t-toast', `冷却中，还需 ${formatRemaining(left)}`);
      return;
    }

    this.setData({ verificationVisible: true, verificationText: '' });
  },

  onVerificationVisibleChange(e) {
    this.setData({ verificationVisible: !!e?.detail?.visible });
  },

  onCloseVerification() {
    this.setData({ verificationVisible: false });
  },

  onVerificationInput(e) {
    this.setData({ verificationText: e?.detail?.value || '' });
  },

  onSendConnectRequest() {
    if (this.data.needHomeBase) {
      wx.showToast({ title: '请先设置地址', icon: 'none' });
      this.setData({ verificationVisible: false });
      this.onSwitchMode({ currentTarget: { dataset: { mode: 'publish' } } });
      return;
    }

    const selected = this.data.selectedUser;
    const peerId = selected?.userId || '';
    if (!peerId) return;

    const msg = String(this.data.verificationText || '').trim();
    wx.showLoading({ title: '发送中...' });
    api
      .createLocalFeedRelationshipRequest(peerId, msg)
      .then((res) => {
        safeHideLoading();
        const requestId = res?.request?.id || '';
        this.setRelationshipStatus(peerId, { state: 'pending', requestId });
        this.setData({ verificationVisible: false });
        wx.showToast({ title: '已发送请求', icon: 'none' });
      })
      .catch((err) => {
        safeHideLoading();
        const code = err?.code || '';
        // Backend should enforce rate-limit/cooldown; here we only surface and reflect state if possible.
        if (code === 'SESSION_REQUEST_EXISTS') {
          this.setRelationshipStatus(peerId, { state: 'pending' });
          wx.showToast({ title: '请求已存在', icon: 'none' });
          return;
        }
        if (code === 'RATE_LIMITED') {
          this.setData({ dailyLimitReached: true }, () => this.refreshConnectUi());
          wx.showToast({ title: err?.message || '今日请求次数已达上限', icon: 'none' });
          return;
        }
        if (code === 'COOLDOWN_ACTIVE') {
          this.setRelationshipStatus(peerId, { state: 'cooldown', untilMs: Date.now() + COOLDOWN_MS });
          wx.showToast({ title: err?.message || '冷却中，稍后再试', icon: 'none' });
          return;
        }
        if (code === 'SESSION_EXISTS') {
          wx.showToast({ title: '会话已存在，请在会话列表中打开', icon: 'none' });
          return;
        }
        wx.showToast({ title: err?.message || '发送失败', icon: 'none' });
      });
  },

  onOpenRequests() {
    this.setData({ requestsVisible: true });
    this.loadRequests();
  },

  onCloseRequests() {
    this.setData({ requestsVisible: false });
  },

  onRequestsVisibleChange(e) {
    this.setData({ requestsVisible: !!e?.detail?.visible });
  },

  loadRequests() {
    if (!api.isLoggedIn()) {
      this.setData({ pendingRequests: [], loadingRequests: false });
      return;
    }

    this.setData({ loadingRequests: true });
    api
      .listSessionRequests('incoming', 'pending')
      .then((requests) => {
        const items = (requests || []).slice(0, 20);
        return Promise.all(
          items.map((r) =>
            api
              .getUserById(r.requesterId)
              .then((u) => ({
                id: r.id,
                requesterId: r.requesterId,
                request: r,
                user: u || { id: r.requesterId, displayName: '对方' },
              }))
              .catch(() => ({
                id: r.id,
                requesterId: r.requesterId,
                request: r,
                user: { id: r.requesterId, displayName: '对方' },
              }))
          )
        );
      })
      .then((pendingRequests) => this.setData({ pendingRequests: pendingRequests || [], loadingRequests: false }))
      .catch(() => this.setData({ pendingRequests: [], loadingRequests: false }));
  },

  refreshRelationshipStatusForUser(peerUserId) {
    const peerId = String(peerUserId || '').trim();
    if (!peerId) return Promise.resolve();
    if (!api.isLoggedIn()) return Promise.resolve();

    const me = api.getUser() || {};
    if (me?.id && peerId === me.id) {
      this.setRelationshipStatus(peerId, { state: 'self' });
      return Promise.resolve();
    }

    return Promise.allSettled([api.listSessions('active'), api.listSessionRequests('outgoing', 'pending')]).then(
      ([sessRes, reqRes]) => {
        const sessions = sessRes.status === 'fulfilled' ? sessRes.value || [] : [];
        const outReq = reqRes.status === 'fulfilled' ? reqRes.value || [] : [];

        const s = (sessions || []).find((x) => (x?.peer?.id || '') === peerId && (x?.status || 'active') !== 'archived');
        if (s?.id) {
          this.setRelationshipStatus(peerId, { state: 'chat', sessionId: s.id });
          return;
        }

        const r = (outReq || []).find((x) => (x?.addresseeId || '') === peerId && (x?.status || '') === 'pending');
        if (r?.id) {
          this.setRelationshipStatus(peerId, { state: 'pending', requestId: r.id });
          return;
        }

        this.setRelationshipStatus(peerId, { state: 'none' });
      }
    );
  },

  setRelationshipStatus(peerUserId, status) {
    const peerId = String(peerUserId || '').trim();
    if (!peerId) return;
    const next = { ...(this.data.relationshipByUserId || {}) };
    next[peerId] = { ...(next[peerId] || {}), ...(status || {}) };
    this.setData({ relationshipByUserId: next }, () => this.refreshConnectUi());
  },

  refreshConnectUi() {
    const selected = this.data.selectedUser;
    const peerId = selected?.userId || '';
    const me = api.getUser() || {};

    if (!peerId) {
      this.setData({ connectButtonText: '申请建立连接', connectButtonDisabled: true, connectButtonHint: '' });
      return;
    }
    if (me?.id && peerId === me.id) {
      this.setData({ connectButtonText: '不能向自己发起', connectButtonDisabled: true, connectButtonHint: '' });
      return;
    }
    if (!api.isLoggedIn()) {
      this.setData({ connectButtonText: '登录后申请', connectButtonDisabled: false, connectButtonHint: '需要先登录' });
      return;
    }
    if (this.data.needHomeBase) {
      this.setData({
        connectButtonText: '请先设置地址',
        connectButtonDisabled: false,
        connectButtonHint: '首次使用需先设置我的位置',
      });
      return;
    }

    const status = this.data.relationshipByUserId?.[peerId] || { state: 'none' };
    if (status.state === 'chat' && status.sessionId) {
      this.setData({ connectButtonText: '进入聊天', connectButtonDisabled: false, connectButtonHint: '' });
      return;
    }
    if (status.state === 'pending') {
      this.setData({ connectButtonText: '等待同意', connectButtonDisabled: true, connectButtonHint: '对方同意后会出现在会话列表' });
      return;
    }
    if (status.state === 'cooldown') {
      const until = Number(status.untilMs || 0);
      const left = until ? until - Date.now() : COOLDOWN_MS;
      if (until && left <= 0) {
        this.setRelationshipStatus(peerId, { state: 'none', untilMs: 0 });
        return;
      }
      this.setData({
        connectButtonText: '冷却中',
        connectButtonDisabled: true,
        connectButtonHint: `还需 ${formatRemaining(left)}（被拒绝后 3 天内不可重复发送）`,
      });
      this.startCooldownTimer();
      return;
    }
    if (status.state === 'self') {
      this.setData({ connectButtonText: '不能向自己发起', connectButtonDisabled: true, connectButtonHint: '' });
      return;
    }
    if (this.data.dailyLimitReached) {
      this.setData({ connectButtonText: '今日已达上限', connectButtonDisabled: true, connectButtonHint: '每日最多发起 10 个新的地图关系请求' });
      return;
    }
    this.setData({ connectButtonText: '申请建立连接', connectButtonDisabled: false, connectButtonHint: '' });
  },

  startCooldownTimer() {
    if (this.cooldownTimer) return;
    this.cooldownTimer = setInterval(() => {
      if (!this.data.detailVisible) {
        this.stopCooldownTimer();
        return;
      }
      this.refreshConnectUi();
    }, 60 * 1000);
  },

  stopCooldownTimer() {
    if (!this.cooldownTimer) return;
    clearInterval(this.cooldownTimer);
    this.cooldownTimer = null;
  },

  onAcceptRequest(e) {
    const requestId = e?.currentTarget?.dataset?.id || '';
    if (!requestId) return;

    wx.showLoading({ title: '处理中...' });
    api
      .acceptSessionRequest(requestId)
      .then((res) => {
        safeHideLoading();
        const sessionId = res?.session?.id || '';
        const peerUserId = res?.request?.requesterId || '';
        this.loadRequests();
        wx.showToast({ title: '已同意', icon: 'none' });

        if (sessionId && peerUserId) {
          return api
            .getUserById(peerUserId)
            .then((u) => {
              const peerName = u?.displayName || '';
              const url =
                `/pages/chat/index?sessionId=${encodeURIComponent(sessionId)}` +
                (peerName ? `&peerName=${encodeURIComponent(peerName)}` : '') +
                `&peerUserId=${encodeURIComponent(peerUserId)}`;
              wx.navigateTo({ url });
            })
            .catch(() => null);
        }
        return null;
      })
      .catch((err) => {
        safeHideLoading();
        wx.showToast({ title: err?.message || '失败', icon: 'none' });
      });
  },

  onRejectRequest(e) {
    const requestId = e?.currentTarget?.dataset?.id || '';
    if (!requestId) return;

    wx.showLoading({ title: '处理中...' });
    api
      .rejectSessionRequest(requestId)
      .then(() => {
        safeHideLoading();
        wx.showToast({ title: '已拒绝', icon: 'none' });
        this.loadRequests();
      })
      .catch((err) => {
        safeHideLoading();
        wx.showToast({ title: err?.message || '失败', icon: 'none' });
      });
  },

  onOpenPublish() {
    if (!api.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    if (this.data.needHomeBase) {
      wx.showToast({ title: '请先设置我的位置', icon: 'none' });
      this.onSwitchMode({ currentTarget: { dataset: { mode: 'publish' } } });
      return;
    }
    this.setData({ publishVisible: true });
  },

  onClosePublish() {
    this.setData({ publishVisible: false });
  },

  onPublishVisibleChange(e) {
    this.setData({ publishVisible: !!e?.detail?.visible });
  },

  onDraftTextInput(e) {
    this.setData({ 'draft.text': e?.detail?.value || '' });
  },

  onTtlHoursInput(e) {
    const v = String(e?.detail?.value || '').trim();
    this.setData({ 'draft.ttlDays': v });
  },

  onTtlDaysInput(e) {
    const v = String(e?.detail?.value || '').trim();
    this.setData({ 'draft.ttlDays': v });
  },

  onPinnedChange(e) {
    this.setData({ 'draft.pinned': !!e?.detail?.value });
  },

  onPickImages() {
    if (!this.data.isLoggedIn) return;

    const current = Array.isArray(this.data.draft?.images) ? this.data.draft.images : [];
    const left = Math.max(0, 9 - current.length);
    if (left <= 0) {
      wx.showToast({ title: '最多选 9 张', icon: 'none' });
      return;
    }

    const choose = typeof wx.chooseMedia === 'function'
      ? () =>
          new Promise((resolve, reject) => {
            wx.chooseMedia({
              count: Math.min(9, left),
              mediaType: ['image'],
              sourceType: ['album', 'camera'],
              success: resolve,
              fail: reject,
            });
          })
      : () =>
          new Promise((resolve, reject) => {
            wx.chooseImage({
              count: Math.min(9, left),
              sourceType: ['album', 'camera'],
              success: (r) => resolve({ tempFiles: (r?.tempFilePaths || []).map((p) => ({ tempFilePath: p })) }),
              fail: reject,
            });
          });

    choose()
      .then((r) => {
        const picked = (r?.tempFiles || []).map((f) => f?.tempFilePath).filter(Boolean);
        if (!picked.length) return;
        this.setData({ 'draft.images': [...current, ...picked].slice(0, 9) });
      })
      .catch((err) => {
        const msg = String(err?.errMsg || err?.message || '').toLowerCase();
        if (msg.includes('cancel')) return;
        wx.showToast({ title: '选图失败', icon: 'none' });
      });
  },

  onRemoveDraftImage(e) {
    const idx = Number(e?.currentTarget?.dataset?.index || 0);
    const imgs = Array.isArray(this.data.draft?.images) ? [...this.data.draft.images] : [];
    if (idx < 0 || idx >= imgs.length) return;
    imgs.splice(idx, 1);
    this.setData({ 'draft.images': imgs });
  },

  onPreviewDraftImage(e) {
    const idx = Number(e?.currentTarget?.dataset?.index || 0);
    const imgs = Array.isArray(this.data.draft?.images) ? this.data.draft.images : [];
    if (!imgs.length) return;
    wx.previewImage({ urls: imgs, current: imgs[idx] || imgs[0] });
  },

  onPublish() {
    if (!this.data.isLoggedIn) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    if (this.data.needHomeBase) {
      wx.showToast({ title: '请先设置我的位置', icon: 'none' });
      return;
    }

    const text = String(this.data.draft?.text || '').trim();
    const images = Array.isArray(this.data.draft?.images) ? this.data.draft.images.filter(Boolean) : [];
    if (!text && !images.length) {
      wx.showToast({ title: '写点内容或选张图片', icon: 'none' });
      return;
    }

    const ttlDays = clampNum(this.data.draft?.ttlDays || 30, 1, 365);
    const now = Date.now();

    const uploadTasks = images.map((p) => {
      const path = String(p || '').trim();
      if (!path) return Promise.resolve('');
      if (/^https?:\/\//i.test(path)) return Promise.resolve(path);
      if (path.startsWith('/uploads/') || path.startsWith('/static/')) return Promise.resolve(path);
      return api
        .uploadFile(path)
        .then((res) => String(res?.url || '').trim())
        .catch(() => '');
    });

    wx.showLoading({ title: '发布中...' });
    Promise.all(uploadTasks)
      .then((urls) => {
        const imageUrls = (urls || []).map((u) => String(u || '').trim()).filter(Boolean);
        const expiresAtMs = now + ttlDays * 24 * 3600 * 1000;
        return api.createLocalFeedPost({
          text,
          imageUrls,
          expiresAtMs,
          isPinned: !!this.data.draft?.pinned,
        });
      })
      .then(() => {
        safeHideLoading();
        this.setData({
          publishVisible: false,
          draft: { text: '', images: [], ttlDays: '30', pinned: false },
        });
        wx.showToast({ title: '已发布', icon: 'none' });
        return this.refreshMyPosts();
      })
      .catch((err) => {
        safeHideLoading();
        wx.showToast({ title: err?.message || '发布失败', icon: 'none' });
      });
  },

  onSetHomeBaseToCurrent() {
    if (!api.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    wx.showLoading({ title: '定位中...' });
    this.ensureLocation()
      .then((loc) => {
        if (!loc) {
          safeHideLoading();
          wx.showModal({
            title: '需要定位权限',
            content: '请允许获取定位后再使用“用当前位置设置”。你也可以选择“地图选点”。',
            confirmText: '去授权',
            cancelText: '取消',
            success: (res) => {
              if (!res?.confirm) return;

              const openSetting = () => {
                if (typeof wx?.openSetting !== 'function') {
                  wx.showToast({ title: '当前环境不支持打开设置', icon: 'none' });
                  return;
                }
                wx.openSetting({});
              };

              // If the permission hasn't been requested before, `openSetting` may not show it.
              if (typeof wx?.getSetting !== 'function' || typeof wx?.authorize !== 'function') {
                openSetting();
                return;
              }

              wx.getSetting({
                success: (s) => {
                  const auth = s?.authSetting || {};
                  const locSetting = auth['scope.userLocation'];
                  if (locSetting === true) {
                    this.onSetHomeBaseToCurrent();
                    return;
                  }
                  if (locSetting === false) {
                    openSetting();
                    return;
                  }
                  // locSetting is undefined -> request it once so it appears in settings.
                  wx.authorize({
                    scope: 'scope.userLocation',
                    success: () => this.onSetHomeBaseToCurrent(),
                    fail: () => openSetting(),
                  });
                },
                fail: () => openSetting(),
              });
            },
          });
          return null;
        }

        const currentRadiusM = Number(this.data.homeBase?.radiusM);
        const radiusM = Number.isFinite(currentRadiusM) && currentRadiusM > 0 ? Math.round(currentRadiusM) : undefined;
        return api.setLocalFeedHomeBase({ lat: loc.lat, lng: loc.lng, radiusM }).then((hb) => {
          const homeBase = normalizeHomeBaseFromServer(hb);
          const needHomeBase = !homeBase;
          this.setData({ homeBase, needHomeBase }, () => this.refreshFeed());
          wx.showToast({ title: '已更新位置', icon: 'none' });
        });
      })
      .catch((err) => {
        const code = err?.code || '';
        if (code === 'HOME_BASE_UPDATE_LIMITED') {
          wx.showToast({ title: '今天最多修改 3 次位置（0点重置）', icon: 'none' });
          return;
        }
        wx.showToast({ title: err?.message || '设置失败', icon: 'none' });
      })
      .finally(() => safeHideLoading());
  },

  onChooseHomeBaseRadius() {
    if (!api.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    const hb = this.data.homeBase;
    if (!hb) {
      wx.showToast({ title: '请先设置我的位置', icon: 'none' });
      return;
    }

    const options = [
      { label: '0.5km', value: 500 },
      { label: '1.1km（推荐）', value: 1100 },
      { label: '2km', value: 2000 },
      { label: '5km', value: 5000 },
      { label: '10km', value: 10000 },
    ];
    const labels = options.map((o) => o.label);
    const current = Number(hb.radiusM);
    const currentIndex = options.findIndex((o) => o.value === current);

    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        const idx = Number(res?.tapIndex);
        if (!Number.isFinite(idx) || idx < 0 || idx >= options.length) return;
        const radiusM = options[idx].value;
        wx.showLoading({ title: '更新中...' });
        api
          .setLocalFeedHomeBase({ lat: hb.lat, lng: hb.lng, radiusM })
          .then((serverHb) => {
            safeHideLoading();
            const next = normalizeHomeBaseFromServer(serverHb);
            this.setData({ homeBase: next });
            wx.showToast({ title: '已更新范围', icon: 'none' });
          })
          .catch((err) => {
            safeHideLoading();
            wx.showToast({ title: err?.message || '更新失败', icon: 'none' });
          });
      },
      fail: (err) => {
        const msg = String(err?.errMsg || '').toLowerCase();
        if (msg.includes('cancel')) return;
        wx.showToast({ title: '操作失败', icon: 'none' });
      },
    });

    if (currentIndex >= 0) {
      // no-op: action sheet doesn't support default selection; kept for readability.
    }
  },

  onChooseHomeBase() {
    if (!api.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    if (typeof wx?.chooseLocation !== 'function') {
      wx.showToast({ title: '当前环境不支持选点', icon: 'none' });
      return;
    }

    const choose = () =>
      wx.chooseLocation({
      success: (res) => {
        const lat = Number(res?.latitude);
        const lng = Number(res?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          wx.showToast({ title: '选点失败', icon: 'none' });
          return;
        }

        wx.showLoading({ title: '保存中...' });
        api
          .setLocalFeedHomeBase({ lat, lng })
          .then((hb) => {
            const homeBase = normalizeHomeBaseFromServer(hb);
            const needHomeBase = !homeBase;
            this.setData({ homeBase, needHomeBase }, () => this.refreshFeed());
            wx.showToast({ title: '已更新位置', icon: 'none' });
          })
          .catch((err) => {
            const code = err?.code || '';
            if (code === 'HOME_BASE_UPDATE_LIMITED') {
              wx.showToast({ title: '今天最多修改 3 次位置（0点重置）', icon: 'none' });
              return;
            }
            wx.showToast({ title: err?.message || '保存失败', icon: 'none' });
          })
          .finally(() => safeHideLoading());
      },
      fail: (err) => {
        const msg = String(err?.errMsg || '').toLowerCase();
        if (msg.includes('cancel')) return;
        wx.showToast({ title: '选点失败', icon: 'none' });
      },
    });

    // Best-effort: ensure location permission is requested so `chooseLocation` works reliably.
    if (typeof wx?.getSetting !== 'function' || typeof wx?.authorize !== 'function') {
      choose();
      return;
    }

    wx.getSetting({
      success: (s) => {
        const auth = s?.authSetting || {};
        const locSetting = auth['scope.userLocation'];
        if (locSetting === true) {
          choose();
          return;
        }
        if (locSetting === false) {
          wx.showModal({
            title: '需要定位权限',
            content: '请先在设置中允许定位权限后再使用地图选点。',
            confirmText: '去设置',
            cancelText: '取消',
            success: (r) => {
              if (!r?.confirm) return;
              if (typeof wx?.openSetting !== 'function') {
                wx.showToast({ title: '当前环境不支持打开设置', icon: 'none' });
                return;
              }
              wx.openSetting({});
            },
          });
          return;
        }
        // undefined -> request once then retry
        wx.authorize({
          scope: 'scope.userLocation',
          success: () => choose(),
          fail: () => choose(),
        });
      },
      fail: () => choose(),
    });
  },
});
