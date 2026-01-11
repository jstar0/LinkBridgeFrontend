const api = require('../../../utils/linkbridge/api');

const PROFILE_KEY = 'lb_profile_card_v1';
const POSTS_KEY = 'lb_profile_posts_v1';

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

function normalizeTags(tagsText) {
  return String(tagsText || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function loadProfile() {
  const raw = wx.getStorageSync(PROFILE_KEY);
  return safeParseJSON(raw, { bio: '', tags: [] });
}

function saveProfile(profile) {
  wx.setStorageSync(PROFILE_KEY, JSON.stringify(profile || { bio: '', tags: [] }));
}

function loadPosts() {
  const raw = wx.getStorageSync(POSTS_KEY);
  const list = safeParseJSON(raw, []);
  if (!Array.isArray(list)) return [];
  return list.map((p) => ({
    ...p,
    createdAtText: formatTime(p.createdAtMs),
  }));
}

function savePosts(posts) {
  wx.setStorageSync(POSTS_KEY, JSON.stringify(posts || []));
}

Page({
  data: {
    isLoggedIn: false,
    me: { id: '', username: '', displayName: '', avatarUrl: '' },
    profile: { bio: '', tags: [] },
    posts: [],

    draft: { text: '', images: [] },
    editVisible: false,
    editDraft: { bio: '', tagsText: '' },
  },

  onLoad() {
    this.setData({
      profile: loadProfile(),
      posts: loadPosts(),
    });
  },

  onShow() {
    const loggedIn = api.isLoggedIn();
    this.setData({ isLoggedIn: loggedIn });
    if (!loggedIn) {
      this.setData({ me: { id: '', username: '', displayName: '', avatarUrl: '' } });
      return;
    }

    api
      .getMe()
      .then((me) => {
        this.setData({
          me: {
            id: me?.id || '',
            username: me?.username || '',
            displayName: me?.displayName || '',
            avatarUrl: me?.avatarUrl || '',
          },
        });
      })
      .catch(() => null);
  },

  onGoLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onOpenEditCard() {
    const profile = this.data.profile || loadProfile();
    const tagsText = Array.isArray(profile?.tags) ? profile.tags.join(' ') : '';
    this.setData({
      editVisible: true,
      editDraft: {
        bio: profile?.bio || '',
        tagsText,
      },
    });
  },

  onCloseEditCard() {
    this.setData({ editVisible: false });
  },

  onEditVisibleChange(e) {
    this.setData({ editVisible: !!e?.detail?.visible });
  },

  onEditBioInput(e) {
    this.setData({ 'editDraft.bio': e?.detail?.value || '' });
  },

  onEditTagsInput(e) {
    this.setData({ 'editDraft.tagsText': e?.detail?.value || '' });
  },

  onSaveCard() {
    const bio = String(this.data.editDraft?.bio || '').trim();
    const tags = normalizeTags(this.data.editDraft?.tagsText || '');
    const next = { bio, tags };
    saveProfile(next);
    this.setData({ profile: next, editVisible: false });
    wx.showToast({ title: '已保存', icon: 'none' });
  },

  onDraftTextInput(e) {
    this.setData({ 'draft.text': e?.detail?.value || '' });
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

        // Best-effort: persist to USER_DATA_PATH so preview still works after some time.
        const persistOne = (tempFilePath) =>
          new Promise((resolve) => {
            if (typeof wx.saveFile !== 'function') {
              resolve(tempFilePath);
              return;
            }
            wx.saveFile({
              tempFilePath,
              success: (res) => resolve(res?.savedFilePath || tempFilePath),
              fail: () => resolve(tempFilePath),
            });
          });

        return Promise.all(picked.map(persistOne)).then((saved) => {
          const next = [...current, ...saved].slice(0, 9);
          this.setData({ 'draft.images': next });
        });
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

  onPreviewPostImage(e) {
    const postId = String(e?.currentTarget?.dataset?.postid || '');
    const idx = Number(e?.currentTarget?.dataset?.index || 0);
    const post = (this.data.posts || []).find((p) => String(p.id) === postId);
    const imgs = Array.isArray(post?.images) ? post.images : [];
    if (!imgs.length) return;
    wx.previewImage({ urls: imgs, current: imgs[idx] || imgs[0] });
  },

  onPublish() {
    if (!this.data.isLoggedIn) return;
    const text = String(this.data.draft?.text || '').trim();
    const images = Array.isArray(this.data.draft?.images) ? this.data.draft.images.filter(Boolean) : [];
    if (!text && !images.length) {
      wx.showToast({ title: '写点内容或选张图片', icon: 'none' });
      return;
    }

    const now = Date.now();
    const post = {
      id: `p_${now}_${Math.random().toString(16).slice(2)}`,
      text,
      images,
      createdAtMs: now,
      createdAtText: formatTime(now),
    };

    const next = [post, ...(this.data.posts || [])].slice(0, 50);
    savePosts(next.map(({ createdAtText, ...rest }) => rest));
    this.setData({ posts: next, draft: { text: '', images: [] } });
    wx.showToast({ title: '已发布', icon: 'none' });
  },
});

