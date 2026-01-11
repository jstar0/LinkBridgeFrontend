import useToastBehavior from '~/behaviors/useToast';

const api = require('../../utils/linkbridge/api');

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

function clampNum(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
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
  const expiresAtMs = Number(p?.expiresAtMs || 0) || createdAtMs + 24 * 3600 * 1000;
  return {
    ...p,
    createdAtMs,
    expiresAtMs,
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
        content: `${p.author?.displayName || '附近的人'}：${(p.text || '').slice(0, 12)}`,
        display: 'BYCLICK',
        padding: 6,
        borderRadius: 8,
      },
    }));
}

Page({
  behaviors: [useToastBehavior],

  data: {
    isLoggedIn: false,
    center: { lat: 31.2304, lng: 121.4737 }, // fallback: Shanghai
    locationStatus: '未定位',

    posts: [],
    markers: [],
    selectedPost: null,
    detailVisible: false,

    requestsVisible: false,
    loadingRequests: false,
    pendingRequests: [],

    publishVisible: false,
    draft: { text: '', images: [], ttlHours: '24' },
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && typeof tabBar.setActive === 'function') tabBar.setActive('nearby');

    const loggedIn = api.isLoggedIn();
    this.setData({ isLoggedIn: loggedIn });

    this.ensureLocation()
      .catch(() => null)
      .then(() => this.refreshFeed());
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
          author: { userId: 'u_seed_1', displayName: '附近的人', avatarUrl: '/static/chat/avatar.png' },
          text: '今天想找人一起语音聊聊～',
          images: [],
          lat: center.lat + 0.002,
          lng: center.lng + 0.002,
          createdAtMs: now - 15 * 60 * 1000,
          expiresAtMs: now + 6 * 3600 * 1000,
          inviteCode: '',
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
          inviteCode: '',
        },
      ];
      posts = seed;
      savePosts(posts);
    }

    // Filter expired
    posts = posts.filter((p) => (Number(p?.expiresAtMs || 0) || 0) > now).map(decoratePost);

    // If user is logged in and has no local post, keep center consistent.
    if (this.data.isLoggedIn && me?.id) {
      // noop for now
    }

    this.setData({
      posts,
      markers: toMarkers(posts),
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
    this.setData({ selectedPost, detailVisible: true });
  },

  onDetailVisibleChange(e) {
    this.setData({ detailVisible: !!e?.detail?.visible });
  },

  onCloseDetail() {
    this.setData({ detailVisible: false });
  },

  onPreviewSelectedImage(e) {
    const idx = Number(e?.currentTarget?.dataset?.index || 0);
    const imgs = this.data.selectedPost?.images || [];
    if (!imgs.length) return;
    wx.previewImage({ urls: imgs, current: imgs[idx] || imgs[0] });
  },

  onApplyConnect() {
    const code = String(this.data.selectedPost?.inviteCode || '').trim();
    if (!code) {
      this.onShowToast('#t-toast', '暂不支持：缺少对方邀请信息');
      return;
    }
    if (!api.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    wx.showLoading({ title: '提交中...' });
    api
      .consumeSessionInvite(code)
      .then((res) => {
        wx.hideLoading();
        this.setData({ detailVisible: false });
        if (res?.reactivated && res?.sessionId) {
          wx.showToast({ title: '会话已激活', icon: 'none' });
          return;
        }
        wx.showToast({ title: '已发送请求', icon: 'none' });
      })
      .catch((err) => {
        wx.hideLoading();
        const msg = String(err?.message || '').includes('exists') ? '请求已存在' : '提交失败';
        wx.showToast({ title: msg, icon: 'none' });
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
              .then((u) => ({ id: r.id, requesterId: r.requesterId, user: u || { id: r.requesterId, displayName: '对方' } }))
              .catch(() => ({ id: r.id, requesterId: r.requesterId, user: { id: r.requesterId, displayName: '对方' } }))
          )
        );
      })
      .then((pendingRequests) => this.setData({ pendingRequests: pendingRequests || [], loadingRequests: false }))
      .catch(() => this.setData({ pendingRequests: [], loadingRequests: false }));
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
    this.setData({ 'draft.ttlHours': v });
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

    const ttl = clampNum(this.data.draft?.ttlHours || 24, 1, 24 * 30);
    const now = Date.now();
    const user = api.getUser() || {};
    const post = decoratePost({
      id: `p_${now}_${Math.random().toString(16).slice(2)}`,
      author: {
        userId: user?.id || '',
        displayName: user?.displayName || user?.username || '我',
        avatarUrl: user?.avatarUrl || '/static/chat/avatar.png',
      },
      text,
      images,
      lat: this.data.center.lat,
      lng: this.data.center.lng,
      createdAtMs: now,
      expiresAtMs: now + ttl * 3600 * 1000,
      inviteCode: '',
    });

    const next = [post, ...(loadPosts() || [])].slice(0, 50);
    savePosts(next);
    this.setData({ publishVisible: false, draft: { text: '', images: [], ttlHours: '24' } });
    this.refreshFeed();
    wx.showToast({ title: '已发布（mock）', icon: 'none' });
  },
});
