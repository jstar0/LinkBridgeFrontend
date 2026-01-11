import useToastBehavior from '~/behaviors/useToast';

const api = require('../../utils/linkbridge/api');

const POSTS_KEY = 'lb_nearby_posts_mock_v1';
const HOME_BASE_KEY_PREFIX = 'lb_localfeed_home_base_v1_';
const COOLDOWN_MS = 3 * 24 * 3600 * 1000;

function getHomeBaseKey(userId) {
  const id = String(userId || '').trim();
  return `${HOME_BASE_KEY_PREFIX}${id || 'anonymous'}`;
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
  const radiusKm = clampNum(p?.radiusKm ?? 1, 0.1, 50);
  const pinned = !!p?.pinned;
  return {
    ...p,
    createdAtMs,
    expiresAtMs,
    radiusKm: Number(radiusKm.toFixed(2)),
    pinned,
    createdAtText: formatTime(createdAtMs),
    expiresAtText: formatTime(expiresAtMs),
  };
}

function toMarkers(posts) {
  return (posts || [])
    .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .map((p, idx) => ({
      id: idx,
      latitude: Number(p.lat),
      longitude: Number(p.lng),
      width: 34,
      height: 34,
      // Reuse an existing static asset to avoid missing-file compile/runtime issues.
      iconPath: '/static/icon_map.png',
      callout: {
        content: `${p.author?.displayName || '本地的人'}：${(p.text || '').slice(0, 12)}`,
        display: 'BYCLICK',
        padding: 6,
        borderRadius: 8,
      },
    }));
}

function filterVisiblePosts(posts, viewerLat, viewerLng, nowMs) {
  const now = Number(nowMs || 0) || Date.now();
  const list = Array.isArray(posts) ? posts : [];
  return list
    .filter((p) => (Number(p?.expiresAtMs || 0) || 0) > now)
    .filter((p) => {
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      const r = clampNum(p.radiusKm ?? 1, 0.1, 50);
      if (!Number.isFinite(viewerLat) || !Number.isFinite(viewerLng)) return true;
      return distanceKm(viewerLat, viewerLng, lat, lng) <= r;
    })
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

function loadHomeBase(userId) {
  const raw = wx.getStorageSync(getHomeBaseKey(userId));
  const obj = safeParseJSON(raw, null);
  if (!obj) return null;
  const lat = Number(obj.lat);
  const lng = Number(obj.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    name: String(obj.name || ''),
    lat,
    lng,
    latText: roundFixed(lat, 6),
    lngText: roundFixed(lng, 6),
    updatedAtMs: Number(obj.updatedAtMs || 0) || 0,
  };
}

function saveHomeBase(userId, homeBase) {
  const key = getHomeBaseKey(userId);
  wx.setStorageSync(key, JSON.stringify(homeBase || null));
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

    posts: [],
    markers: [],
    selectedPost: null,
    detailVisible: false,

    myPosts: [],

    mapRegion: null,

    requestsVisible: false,
    loadingRequests: false,
    pendingRequests: [],

    publishVisible: false,
    draft: { text: '', images: [], ttlDays: '30', radiusKm: '1', pinned: false },

    verificationVisible: false,
    verificationText: '',

    relationshipByUserId: {},
    dailyLimitReached: false,
    connectButtonText: '申请建立连接',
    connectButtonDisabled: false,
    connectButtonHint: '',
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && typeof tabBar.setActive === 'function') tabBar.setActive('nearby');

    const loggedIn = api.isLoggedIn();
    this.setData({ isLoggedIn: loggedIn });

    if (loggedIn) api.connectWebSocket();

    const me = api.getUser() || {};
    const homeBase = loggedIn && me?.id ? loadHomeBase(me.id) : null;
    this.setData({ homeBase });

    this.ensureLocation()
      .catch(() => null)
      .then(() => this.refreshFeed())
      .then(() => {
        if (loggedIn) this.loadRequests();
      });

    if (loggedIn) this.bindWs();
  },

  onHide() {
    this.unbindWs();
  },

  onUnload() {
    this.unbindWs();
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
      return Promise.resolve();
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
            this.setData({ locationStatus: '定位失败' });
            resolve();
            return;
          }
          this.setData({
            center: { lat, lng },
            locationStatus: '已定位',
          });
          resolve();
        },
        fail: () => {
          this.setData({ locationStatus: '定位失败/未授权' });
          resolve();
        },
      });
    });
  },

  refreshFeed() {
    const now = Date.now();
    const me = api.getUser() || {};
    const center = this.data.center;

    const raw = loadPosts();
    // Seed a few mock posts on first run (no server yet).
    let posts = Array.isArray(raw) ? raw : [];
    if (!posts.length) {
      const seed = [
        {
          id: `seed_${now}_1`,
          author: { userId: 'u_seed_1', displayName: '本地的人', avatarUrl: '/static/chat/avatar.png' },
          text: '今天想找人一起语音聊聊～',
          images: [],
          lat: center.lat + 0.002,
          lng: center.lng + 0.002,
          createdAtMs: now - 15 * 60 * 1000,
          expiresAtMs: now + 6 * 3600 * 1000,
          radiusKm: 1,
          pinned: false,
        },
        {
          id: `seed_${now}_2`,
          author: { userId: 'u_seed_2', displayName: '路过', avatarUrl: '/static/chat/avatar.png' },
          text: '有推荐的播客/书吗？',
          images: [],
          lat: center.lat - 0.0015,
          lng: center.lng + 0.0012,
          createdAtMs: now - 45 * 60 * 1000,
          expiresAtMs: now + 24 * 3600 * 1000,
          radiusKm: 1,
          pinned: false,
        },
      ];
      posts = seed;
      savePosts(posts);
    }

    const visible = filterVisiblePosts(posts, center.lat, center.lng, now);
    const myPosts = visible.filter((p) => (p?.author?.userId || '') && me?.id && p.author.userId === me.id);
    const markerPosts = limitMarkers(visible, this.data.mapRegion, 120);

    this.setData({
      posts: visible,
      markers: toMarkers(markerPosts),
      myPosts,
    });
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
        if (this.data.isLoggedIn) this.loadRequests();
      });
  },

  onMarkerTap(e) {
    const id = Number(e?.detail?.markerId);
    const posts = this.data.posts || [];
    if (!Number.isFinite(id) || id < 0 || id >= posts.length) return;
    const selectedPost = posts[id];
    this.setData({ selectedPost, detailVisible: true }, () => {
      this.refreshConnectUi();
      const peerId = selectedPost?.author?.userId || '';
      if (peerId) this.refreshRelationshipStatusForUser(peerId);
    });
  },

  onRegionChange(e) {
    // When user drags/zooms the map, refresh feed based on the new center.
    if (e?.type !== 'end') return;
    if (typeof wx?.createMapContext !== 'function') return;
    const ctx = wx.createMapContext('lfMap', this);
    if (!ctx || typeof ctx.getCenterLocation !== 'function') return;

    if (typeof ctx.getRegion === 'function') {
      ctx.getRegion({
        success: (res) => {
          if (res?.southwest && res?.northeast) this.setData({ mapRegion: res });
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
        if (Number.isFinite(d) && d < 0.05) return; // ~50m
        this.setData({ center: { lat, lng } }, () => this.refreshFeed());
      },
    });
  },

  onDetailVisibleChange(e) {
    this.setData({ detailVisible: !!e?.detail?.visible });
  },

  onCloseDetail() {
    this.setData({ detailVisible: false });
  },

  onViewProfile() {
    const selected = this.data.selectedPost;
    const userId = selected?.author?.userId || '';
    if (!userId) return;
    const name = selected?.author?.displayName || '';
    const avatarUrl = selected?.author?.avatarUrl || '';
    const url =
      `/pages/localfeed/profile/index?userId=${encodeURIComponent(userId)}` +
      (name ? `&name=${encodeURIComponent(name)}` : '') +
      (avatarUrl ? `&avatarUrl=${encodeURIComponent(avatarUrl)}` : '');
    wx.navigateTo({ url });
  },

  onPreviewSelectedImage(e) {
    const idx = Number(e?.currentTarget?.dataset?.index || 0);
    const imgs = this.data.selectedPost?.images || [];
    if (!imgs.length) return;
    wx.previewImage({ urls: imgs, current: imgs[idx] || imgs[0] });
  },

  onTapConnect() {
    const selected = this.data.selectedPost;
    const peerId = selected?.author?.userId || '';
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
      const peerName = selected?.author?.displayName || '';
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
      this.onShowToast('#t-toast', '对方已拒绝，请稍后再试');
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
    const selected = this.data.selectedPost;
    const peerId = selected?.author?.userId || '';
    if (!peerId) return;

    const msg = String(this.data.verificationText || '').trim();
    wx.showLoading({ title: '发送中...' });
    api
      .createLocalFeedRelationshipRequest(peerId, msg)
      .then((res) => {
        wx.hideLoading();
        const requestId = res?.request?.id || '';
        this.setRelationshipStatus(peerId, { state: 'pending', requestId });
        this.setData({ verificationVisible: false });
        wx.showToast({ title: '已发送请求', icon: 'none' });
      })
      .catch((err) => {
        wx.hideLoading();
        const code = err?.code || '';
        // Backend should enforce rate-limit/cooldown; here we only surface and reflect state if possible.
        if (code === 'SESSION_REQUEST_EXISTS') {
          this.setRelationshipStatus(peerId, { state: 'pending' });
          wx.showToast({ title: '请求已存在', icon: 'none' });
          return;
        }
        if (code === 'LOCALFEED_REQUEST_DAILY_LIMIT' || code === 'RATE_LIMITED') {
          this.setData({ dailyLimitReached: true }, () => this.refreshConnectUi());
          wx.showToast({ title: err?.message || '今日请求次数已达上限', icon: 'none' });
          return;
        }
        if (code === 'LOCALFEED_REQUEST_COOLDOWN') {
          this.setRelationshipStatus(peerId, { state: 'cooldown', untilMs: Date.now() + COOLDOWN_MS });
          wx.showToast({ title: err?.message || '冷却中，稍后再试', icon: 'none' });
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
      .listSessionRequests('in', 'pending')
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

    return Promise.allSettled([api.listSessions('active'), api.listSessionRequests('out', 'pending')]).then(
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
    const selected = this.data.selectedPost;
    const peerId = selected?.author?.userId || '';
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
      this.setData({ connectButtonText: '冷却中', connectButtonDisabled: true, connectButtonHint: '被拒绝后 3 天内不可重复发送' });
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

  onAcceptRequest(e) {
    const requestId = e?.currentTarget?.dataset?.id || '';
    if (!requestId) return;

    wx.showLoading({ title: '处理中...' });
    api
      .acceptSessionRequest(requestId)
      .then((res) => {
        wx.hideLoading();
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
        wx.hideLoading();
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
        wx.hideLoading();
        wx.showToast({ title: '已拒绝', icon: 'none' });
        this.loadRequests();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err?.message || '失败', icon: 'none' });
      });
  },

  onOpenPublish() {
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

  onRadiusKmInput(e) {
    const v = String(e?.detail?.value || '').trim();
    this.setData({ 'draft.radiusKm': v });
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

    const text = String(this.data.draft?.text || '').trim();
    const images = Array.isArray(this.data.draft?.images) ? this.data.draft.images.filter(Boolean) : [];
    if (!text && !images.length) {
      wx.showToast({ title: '写点内容或选张图片', icon: 'none' });
      return;
    }

    const ttlDays = clampNum(this.data.draft?.ttlDays || 30, 1, 365);
    const radiusKm = clampNum(this.data.draft?.radiusKm || 1, 0.1, 50);
    const now = Date.now();
    const user = api.getUser() || {};
    const hb = this.data.homeBase;
    const lat = Number(hb?.lat) || Number(this.data.center.lat);
    const lng = Number(hb?.lng) || Number(this.data.center.lng);
    const post = decoratePost({
      id: `p_${now}_${Math.random().toString(16).slice(2)}`,
      author: {
        userId: user?.id || '',
        displayName: user?.displayName || user?.username || '我',
        avatarUrl: user?.avatarUrl || '/static/chat/avatar.png',
      },
      text,
      images,
      lat,
      lng,
      createdAtMs: now,
      expiresAtMs: now + ttlDays * 24 * 3600 * 1000,
      radiusKm,
      pinned: !!this.data.draft?.pinned,
    });

    const next = [post, ...(loadPosts() || [])].slice(0, 50);
    savePosts(next);
    this.setData({
      publishVisible: false,
      draft: { text: '', images: [], ttlDays: '30', radiusKm: '1', pinned: false },
    });
    this.refreshFeed();
    wx.showToast({ title: '已发布（mock）', icon: 'none' });
  },

  onSetHomeBaseToCurrent() {
    if (!api.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    wx.showLoading({ title: '定位中...' });
    this.ensureLocation()
      .then(() => {
        const me = api.getUser() || {};
        if (!me?.id) throw new Error('未登录');
        const hb = {
          name: '当前位置',
          lat: Number(this.data.center.lat),
          lng: Number(this.data.center.lng),
          latText: roundFixed(Number(this.data.center.lat), 6),
          lngText: roundFixed(Number(this.data.center.lng), 6),
          updatedAtMs: Date.now(),
        };
        saveHomeBase(me.id, hb);
        this.setData({ homeBase: hb });
      })
      .finally(() => wx.hideLoading());
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

    wx.chooseLocation({
      success: (res) => {
        const lat = Number(res?.latitude);
        const lng = Number(res?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          wx.showToast({ title: '选点失败', icon: 'none' });
          return;
        }
        const me = api.getUser() || {};
        if (!me?.id) return;
        const hb = {
          name: String(res?.name || res?.address || '选定位置'),
          lat,
          lng,
          latText: roundFixed(lat, 6),
          lngText: roundFixed(lng, 6),
          updatedAtMs: Date.now(),
        };
        saveHomeBase(me.id, hb);
        this.setData({ homeBase: hb });
      },
      fail: (err) => {
        const msg = String(err?.errMsg || '').toLowerCase();
        if (msg.includes('cancel')) return;
        wx.showToast({ title: '选点失败', icon: 'none' });
      },
    });
  },
});
