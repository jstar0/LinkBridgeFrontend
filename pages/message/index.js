const api = require('../../utils/linkbridge/api');
const app = getApp();

const COLLAPSED_GROUPS_KEY = 'lb_message_group_collapsed_v1';
const DRAG_TOP_ZONE_PX = 96;
// Should cover the on-screen bottom drop zone which sits above the custom tab bar.
const DRAG_BOTTOM_ZONE_PX = 150;

function getSessionIdFromMessageEnv(env) {
  const msg = env?.payload?.message;
  return (
    msg?.sessionId ||
    msg?.sessionID ||
    env?.payload?.sessionId ||
    env?.payload?.sessionID ||
    env?.sessionId ||
    env?.sessionID ||
    ''
  );
}

function normalizeSessionSource(source) {
  const v = String(source || '').trim().toLowerCase();
  if (!v) return 'manual';
  if (v === 'wechat_code' || v === 'wechatcode' || v === 'wechat_qrcode' || v === 'wechat_qr') return 'wechat_code';
  if (v === 'map' || v === 'localfeed' || v === 'local_feed') return 'map';
  if (v === 'activity' || v === 'event') return 'activity';
  if (v === 'manual' || v === 'unknown' || v === 'other') return 'manual';
  return 'manual';
}

function getAutoGroupTitle(source) {
  const s = normalizeSessionSource(source);
  if (s === 'wechat_code') return '来自微信码';
  if (s === 'map') return '来自地图';
  if (s === 'activity') return '来自活动';
  return '其他会话';
}

function buildSessionGroups(sessions, collapsedKeys = [], relationshipGroups = []) {
  const list = Array.isArray(sessions) ? sessions : [];
  const collapsed = new Set(Array.isArray(collapsedKeys) ? collapsedKeys : []);

  const groupsMap = new Map();
  const autoSources = ['wechat_code', 'map', 'activity', 'manual'];

  // Seed user-defined groups (can be empty; still rendered as drop targets & manageable).
  const relGroups = Array.isArray(relationshipGroups) ? relationshipGroups : [];
  relGroups.forEach((g) => {
    const id = String(g?.id || '').trim();
    if (!id) return;
    const key = `group:${id}`;
    if (groupsMap.has(key)) return;
    groupsMap.set(key, {
      key,
      title: String(g?.name || '分组'),
      isCustom: true,
      collapsed: collapsed.has(key),
      sessions: [],
      latestUpdatedAtMs: 0,
    });
  });

  // Seed default auto groups in fixed order (only shown when has sessions, or when dragging).
  autoSources.forEach((src) => {
    const key = `auto:${src}`;
    if (groupsMap.has(key)) return;
    groupsMap.set(key, {
      key,
      title: getAutoGroupTitle(src),
      isCustom: false,
      collapsed: collapsed.has(key),
      sessions: [],
      latestUpdatedAtMs: 0,
    });
  });

  for (const s of list) {
    if (!s || !s.id) continue;
    if (s.isAI) continue;

    const rel = s.relationship || {};
    const groupId = rel.groupId ? String(rel.groupId).trim() : '';

    let key = '';
    let title = '';
    if (groupId) {
      key = `group:${groupId}`;
      title = String(rel.groupName || groupsMap.get(key)?.title || '分组');
    } else {
      const src = normalizeSessionSource(s.source || rel.source);
      key = `auto:${src}`;
      title = getAutoGroupTitle(src);
    }

    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        key,
        title,
        isCustom: key.startsWith('group:'),
        collapsed: collapsed.has(key),
        sessions: [],
        latestUpdatedAtMs: 0,
      });
    }

    const g = groupsMap.get(key);
    g.sessions.push(s);
    const ts = Number(s.updatedAtMs || 0) || 0;
    if (ts > (Number(g.latestUpdatedAtMs || 0) || 0)) g.latestUpdatedAtMs = ts;
  }

  const ordered = [];
  const seen = new Set();

  // 1) Custom groups: fixed order from backend list.
  relGroups.forEach((g) => {
    const id = String(g?.id || '').trim();
    if (!id) return;
    const key = `group:${id}`;
    const group = groupsMap.get(key);
    if (!group || seen.has(key)) return;
    ordered.push(group);
    seen.add(key);
  });

  // 2) Auto groups: fixed order.
  autoSources.forEach((src) => {
    const key = `auto:${src}`;
    const group = groupsMap.get(key);
    if (!group || seen.has(key)) return;
    ordered.push(group);
    seen.add(key);
  });

  // 3) Any leftover groups (future-proofing), stable by insertion order.
  Array.from(groupsMap.keys()).forEach((key) => {
    if (seen.has(key)) return;
    const group = groupsMap.get(key);
    if (group) ordered.push(group);
  });

  ordered.forEach((g) => {
    g.count = Array.isArray(g.sessions) ? g.sessions.length : 0;
  });

  return ordered;
}

function parseGroupIdFromKey(key) {
  const k = String(key || '').trim();
  if (!k.startsWith('group:')) return '';
  return k.slice('group:'.length);
}

function findNextAutoGroupName(relationshipGroups) {
  const list = Array.isArray(relationshipGroups) ? relationshipGroups : [];
  const names = new Set(list.map((g) => String(g?.name || '').trim()).filter(Boolean));
  const base = '新分组';
  if (!names.has(base)) return base;

  // Find max number from patterns like "新分组 2"
  let maxN = 1;
  names.forEach((n) => {
    const m = /^新分组\s*(\d+)$/.exec(n);
    if (m && m[1]) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v > maxN) maxN = v;
    }
  });
  return `新分组 ${maxN + 1}`;
}

Page({
  /** 页面的初始数据 */
  data: {
    sessions: [],
    aiSession: null,
    sessionGroups: [],
    loading: true, // 是否正在加载（用于拉取列表）
    refreshing: false, // t-pull-down-refresh state
    incomingRequests: [],
    collapsedGroupKeys: [],
    relationshipGroups: [],

    // Group management
    groupMenuVisible: false,
    groupMenuKey: '',
    groupMenuTitle: '',
    groupRenameVisible: false,
    groupRenameName: '',

    // Drag interaction (long-press session)
    dragging: false,
    draggingSessionId: '',
    draggingSession: null,
    dragGhostTopPx: 0,
    dragTargetType: 'none', // none | group | archive | create
    dragTargetKey: '',
    dragWindowHeight: 0,
    dragTopZoneTopPx: 0,
    dragTopZonePx: DRAG_TOP_ZONE_PX,
    dragBottomZonePx: DRAG_BOTTOM_ZONE_PX,
  },

  /** 生命周期函数--监听页面加载 */
  onLoad() {},

  /** 生命周期函数--监听页面初次渲染完成 */
  onReady() {},

  /** 生命周期函数--监听页面显示 */
  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && typeof tabBar.setActive === 'function') tabBar.setActive('message');

    if (!api.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    this.loadCollapsedGroups();
    this.loadRelationshipGroups();

    api.connectWebSocket();
    this.getMessageList();
    this.getIncomingRequests();

    this.wsHandler = (env) => {
      if (env?.type === 'session.created') {
        const session = env?.payload?.session;
        if (!session?.id) return;
        const unreadMap = app?.globalData?.unreadBySession || {};
        const decorated = {
          ...session,
          unreadCount: Number(unreadMap?.[session.id] || 0) || 0,
          avatar: (session && session.peer && session.peer.avatarUrl) || '/static/chat/avatar.png',
          desc: session && session.lastMessageText ? session.lastMessageText : ' ',
        };
        const next = [decorated, ...this.data.sessions.filter((s) => s.id !== session.id)];
        this.setSessions(next);
        return;
      }

      if (env?.type === 'session.archived') {
        const archivedId = env?.payload?.session?.id || env?.payload?.sessionId || '';
        if (!archivedId) return;
        const next = this.data.sessions.filter((s) => s.id !== archivedId);
        if (next.length !== this.data.sessions.length) this.setSessions(next);
        return;
      }

      if (env?.type === 'session.requested') {
        // New incoming request; refresh list.
        this.getIncomingRequests();
        return;
      }

      if (env?.type === 'session.request.accepted' || env?.type === 'session.request.rejected') {
        // Either accepted/rejected by the other side; refresh view.
        this.getIncomingRequests();
        return;
      }

      if (env?.type === 'message.created') {
        const msg = env?.payload?.message;
        const sid = getSessionIdFromMessageEnv(env);
        if (!sid) return;

        // If user is currently viewing this session in chat, do not mark it as unread.
        try {
          const pages = getCurrentPages();
          const cur = pages[pages.length - 1];
          if (cur?.route === 'pages/chat/index') {
            const openSid = cur?.data?.sessionId || cur?.options?.sessionId || '';
            if (openSid && openSid === sid) return;
          }
        } catch (e) {
          // ignore
        }

        // Keep global unread map in sync only when App-level handler is not ready yet.
        // Otherwise this will double-increment (App handler + page handler).
        if (!app?.globalData?.unreadWsReady && typeof app?.incrementSessionUnread === 'function') {
          app.incrementSessionUnread(sid, 1);
        }

        const next = [...this.data.sessions];
        const idx = next.findIndex((s) => s.id === sid);
        if (idx < 0) return;

        const session = { ...next[idx] };
        session.lastMessageText = msg?.text || session.lastMessageText || '';
        session.desc = msg?.text || session.desc || ' ';
        session.updatedAtMs = msg?.createdAtMs || session.updatedAtMs;

        const unreadMap = app?.globalData?.unreadBySession || {};
        const fromMap = Number(unreadMap?.[sid] || 0) || 0;
        const prev = Number(session.unreadCount || 0) || 0;
        session.unreadCount = fromMap > 0 ? fromMap : prev + 1;

        next.splice(idx, 1);
        next.unshift(session);
        this.setSessions(next);
      }
    };

    api.addWebSocketHandler(this.wsHandler);
  },

  /** 生命周期函数--监听页面隐藏 */
  onHide() {},

  /** 生命周期函数--监听页面卸载 */
  onUnload() {
    if (this.wsHandler) api.removeWebSocketHandler(this.wsHandler);
  },

  /** 页面相关事件处理函数--监听用户下拉动作 */
  onPullDownRefresh() {},

  /** 页面上拉触底事件的处理函数 */
  onReachBottom() {},

  /** 用户点击右上角分享 */
  onShareAppMessage() {},

  /** 获取会话列表 */
  getMessageList() {
    this.setData({ loading: true });
    return api
      .listSessions('active')
      .then((sessions) => {
        const unreadMap = app?.globalData?.unreadBySession || {};
        const decorated = (sessions || []).map((s) => ({
          ...s,
          unreadCount: Number(unreadMap?.[s?.id] || 0) || 0,
          avatar: (s && s.peer && s.peer.avatarUrl) || '/static/chat/avatar.png',
          desc: s && s.lastMessageText ? s.lastMessageText : ' ',
        }));

        // Prune stale unread entries for sessions that no longer exist.
        // Otherwise TabBar dot may stay on even when the visible session list has no unread.
        try {
          const valid = new Set((decorated || []).map((s) => s?.id).filter(Boolean));
          const map = app?.globalData?.unreadBySession || {};
          let changed = false;
          Object.keys(map || {}).forEach((sid) => {
            if (!valid.has(sid)) {
              delete map[sid];
              changed = true;
            }
          });
          if (changed) {
            app.globalData.unreadBySession = map;
            try {
              wx.setStorageSync('lb_unread_by_session_v1', JSON.stringify(map));
            } catch (e) {
              // ignore
            }
            if (typeof app.recalcUnreadNum === 'function') app.recalcUnreadNum();
          }
        } catch (e) {
          // ignore
        }

        // Add AI assistant at the top
        const aiSession = {
          id: 'ai-assistant',
          peer: {
            displayName: 'AI 助手',
            avatarUrl: '',
          },
          // Must be a valid local/remote image path; emoji/text will be treated as a file path and error in DevTools.
          avatar: '/static/chat/avatar.png',
          desc: '智能助手为您服务',
          unreadCount: 0,
          isAI: true,
        };

        this.setSessions([aiSession, ...decorated]);
        this.setData({ loading: false });
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  setSessions(nextSessions) {
    const sessions = Array.isArray(nextSessions) ? nextSessions : [];
    const aiSession = sessions.find((s) => !!s?.isAI) || null;

    const sessionGroups = buildSessionGroups(sessions, this.data.collapsedGroupKeys, this.data.relationshipGroups);
    this.setData({ sessions, aiSession, sessionGroups });
  },

  loadCollapsedGroups() {
    try {
      const raw = wx.getStorageSync(COLLAPSED_GROUPS_KEY);
      const keys = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      if (Array.isArray(keys)) this.setData({ collapsedGroupKeys: keys });
    } catch (e) {
      // ignore
    }
  },

  saveCollapsedGroups(keys) {
    try {
      wx.setStorageSync(COLLAPSED_GROUPS_KEY, JSON.stringify(keys || []));
    } catch (e) {
      // ignore
    }
  },

  loadRelationshipGroups() {
    return api
      .listRelationshipGroups()
      .then((groups) => {
        this.setData({ relationshipGroups: Array.isArray(groups) ? groups : [] });
        this.setSessions(this.data.sessions);
      })
      .catch(() => {
        this.setData({ relationshipGroups: [] });
        this.setSessions(this.data.sessions);
      });
  },

  onToggleGroup(event) {
    const key = event?.currentTarget?.dataset?.key || '';
    if (!key) return;

    const prev = Array.isArray(this.data.collapsedGroupKeys) ? this.data.collapsedGroupKeys : [];
    const set = new Set(prev);
    if (set.has(key)) set.delete(key);
    else set.add(key);

    const next = Array.from(set);
    this.setData({ collapsedGroupKeys: next });
    this.saveCollapsedGroups(next);

    // Rebuild groups with new collapsed state.
    this.setSessions(this.data.sessions);
  },

  onRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });

    Promise.allSettled([this.getMessageList(), this.getIncomingRequests()])
      .catch(() => null)
      .finally(() => {
        // brief delay to feel like "snap back" (similar to model)
        setTimeout(() => this.setData({ refreshing: false }), 260);
      });
  },

  getIncomingRequests() {
    return api
      .listSessionRequests('incoming', 'pending')
      .then((requests) => {
        const items = (requests || []).slice(0, 10);
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
      .then((incomingRequests) => this.setData({ incomingRequests: incomingRequests || [] }))
      .catch(() => this.setData({ incomingRequests: [] }));
  },

  toChat(event) {
    if (this.data.dragging) return;

    const session = event?.currentTarget?.dataset?.session;
    if (!session?.id) return;

    // Handle AI chat separately
    if (session.isAI) {
      wx.navigateTo({ url: '/pages/ai-chat/index' });
      return;
    }

    // Reset unread count locally when opening.
    const sessions = this.data.sessions.map((s) => (s.id === session.id ? { ...s, unreadCount: 0 } : s));
    this.setSessions(sessions);

    // Clear global per-session unread so tab bar dot updates correctly.
    if (typeof app?.setSessionUnread === 'function') app.setSessionUnread(session.id, 0);

    const peerName = session?.peer?.displayName || '';
    const peerUserId = session?.peer?.id || '';
    const url =
      `/pages/chat/index?sessionId=${encodeURIComponent(session.id)}` +
      (peerName ? `&peerName=${encodeURIComponent(peerName)}` : '') +
      (peerUserId ? `&peerUserId=${encodeURIComponent(peerUserId)}` : '');
    wx.navigateTo({ url });
  },

  onLongPressSession(event) {
    const session = event?.currentTarget?.dataset?.session;
    if (!session?.id) return;
    if (session.isAI) return;
    if (this.data.dragging) return;

    const touch = event?.touches?.[0] || event?.changedTouches?.[0] || null;
    const y = Number(touch?.clientY);
    const hasY = Number.isFinite(y);

    this.startDragSession(session, hasY ? y : 0);
  },

  startDragSession(session, touchClientY) {
    const sid = String(session?.id || '').trim();
    if (!sid) return;

    let windowHeight = 0;
    let topZoneTopPx = 0;
    try {
      const info = wx.getSystemInfoSync();
      windowHeight = Number(info?.windowHeight || 0) || 0;
      const statusBarHeight = Number(info?.statusBarHeight || 0) || 0;

      // Put the top drop zone below the custom navbar, otherwise it can be hidden by the status bar/notch.
      let navBottomPx = 0;
      try {
        const menu = wx.getMenuButtonBoundingClientRect();
        navBottomPx = Number(menu?.bottom || 0) || 0;
      } catch (e) {
        // ignore
      }
      if (!navBottomPx) navBottomPx = statusBarHeight + 44;
      topZoneTopPx = Math.max(8, navBottomPx + 8);
    } catch (e) {
      // ignore
    }

    this._dragOriginalCollapsedKeys = Array.isArray(this.data.collapsedGroupKeys) ? [...this.data.collapsedGroupKeys] : [];
    this._dragAutoExpanded = new Set();

    this.setData({
      dragging: true,
      draggingSessionId: sid,
      draggingSession: session,
      dragGhostTopPx: Math.max(0, (Number(touchClientY) || 0) - 34),
      dragTargetType: 'none',
      dragTargetKey: '',
      dragWindowHeight: windowHeight,
      dragTopZoneTopPx: topZoneTopPx,
    });

    wx.nextTick(() => this.measureDragTargets());
  },

  measureDragTargets() {
    const q = wx.createSelectorQuery().in(this);
    q.selectAll('.lb-group__header').fields({ rect: true, dataset: true }, (rects) => {
      this._dragHeaderRects = Array.isArray(rects) ? rects : [];
    });
    q.select('.lb-drag-zone--top').boundingClientRect((rect) => {
      this._dragTopZoneRect = rect || null;
    });
    q.select('.lb-drag-zone--bottom').boundingClientRect((rect) => {
      this._dragBottomZoneRect = rect || null;
    });
    q.exec();
  },

  onSessionTouchMove(event) {
    if (!this.data.dragging) return;
    const sid = String(event?.currentTarget?.dataset?.id || '').trim();
    if (!sid || sid !== this.data.draggingSessionId) return;

    const touch = event?.touches?.[0] || event?.changedTouches?.[0] || null;
    const y = Number(touch?.clientY);
    if (!Number.isFinite(y)) return;

    this.setData({ dragGhostTopPx: Math.max(0, y - 34) });
    this.updateDragTarget(y);
  },

  updateDragTarget(touchClientY) {
    const y = Number(touchClientY);
    if (!Number.isFinite(y)) return;

    const winH = Number(this.data.dragWindowHeight || 0) || 0;
    const topZone = Number(this.data.dragTopZonePx || 0) || DRAG_TOP_ZONE_PX;
    const bottomZone = Number(this.data.dragBottomZonePx || 0) || DRAG_BOTTOM_ZONE_PX;

    let type = 'none';
    let key = '';
    let hoverKey = '';

    const topRect = this._dragTopZoneRect;
    const bottomRect = this._dragBottomZoneRect;

    const hitRect = (rect) => {
      if (!rect) return false;
      const t = Number(rect?.top);
      const b = Number(rect?.bottom);
      return Number.isFinite(t) && Number.isFinite(b) && y >= t && y <= b;
    };

    if (hitRect(topRect) || y <= topZone) {
      type = 'archive';
    } else if (hitRect(bottomRect) || (winH && y >= winH - bottomZone)) {
      type = 'create';
    } else {
      const rects = Array.isArray(this._dragHeaderRects) ? this._dragHeaderRects : [];
      const hit = rects.find((r) => {
        const top = Number(r?.top);
        const bottom = Number(r?.bottom);
        return Number.isFinite(top) && Number.isFinite(bottom) && y >= top && y <= bottom;
      });
      if (hit && hit?.dataset?.key) {
        hoverKey = String(hit.dataset.key);
        if (hoverKey.startsWith('group:') || hoverKey.startsWith('auto:')) {
          type = 'group';
          key = hoverKey;
        }
      }
    }

    // Auto expand/collapse collapsed groups while hovering (even auto groups).
    this.applyDragHoverGroup(hoverKey);

    if (type !== this.data.dragTargetType || key !== this.data.dragTargetKey) {
      this.setData({ dragTargetType: type, dragTargetKey: key });
    }
  },

  applyDragHoverGroup(groupKey) {
    const key = String(groupKey || '').trim();
    const prevKey = String(this._dragHoverGroupKey || '').trim();
    if (key === prevKey) return;

    // Leaving a previously auto-expanded group -> restore its collapsed state.
    if (prevKey && this._dragAutoExpanded && this._dragAutoExpanded.has(prevKey)) {
      const origin = Array.isArray(this._dragOriginalCollapsedKeys) ? this._dragOriginalCollapsedKeys : [];
      const shouldBeCollapsed = origin.includes(prevKey);
      if (shouldBeCollapsed) {
        const now = Array.isArray(this.data.collapsedGroupKeys) ? this.data.collapsedGroupKeys : [];
        const set = new Set(now);
        set.add(prevKey);
        const next = Array.from(set);
        this.setData({ collapsedGroupKeys: next });
        this.saveCollapsedGroups(next);
        this.setSessions(this.data.sessions);
        wx.nextTick(() => this.measureDragTargets());
      }
    }

    this._dragHoverGroupKey = key;

    if (!key) return;

    // Entering a group: if it was collapsed before drag started, expand temporarily.
    const origin = Array.isArray(this._dragOriginalCollapsedKeys) ? this._dragOriginalCollapsedKeys : [];
    const wasCollapsed = origin.includes(key);
    if (!wasCollapsed) return;

    const now = Array.isArray(this.data.collapsedGroupKeys) ? this.data.collapsedGroupKeys : [];
    if (!now.includes(key)) return;

    if (this._dragAutoExpanded) this._dragAutoExpanded.add(key);
    const next = now.filter((k) => k !== key);
    this.setData({ collapsedGroupKeys: next });
    this.saveCollapsedGroups(next);
    this.setSessions(this.data.sessions);
    wx.nextTick(() => this.measureDragTargets());
  },

  onSessionTouchEnd(event) {
    if (!this.data.dragging) return;
    const sid = String(event?.currentTarget?.dataset?.id || '').trim();
    if (!sid || sid !== this.data.draggingSessionId) return;

    const session = this.data.draggingSession;
    const type = String(this.data.dragTargetType || 'none');
    const key = String(this.data.dragTargetKey || '');

    // Stop drag UI first; run actions after.
    this.endDragUi();

    if (!session?.id) return;

    if (type === 'archive') {
      const peerName = session?.peer?.displayName || '对方';
      wx.showModal({
        title: '结束会话',
        content: `确定要结束与「${peerName}」的会话吗？`,
        confirmText: '结束',
        cancelText: '取消',
        success: (res) => {
          if (!res?.confirm) return;
          this.archiveSession(session);
        },
      });
      return;
    }

    if (type === 'create') {
      this.createGroupAndMoveSession(session);
      return;
    }

    if (type === 'group') {
      const gid = parseGroupIdFromKey(key);

      // Dropping onto an auto group means "remove from custom group" (back to default grouping by source).
      if (!gid && key.startsWith('auto:')) {
        const inCustom = !!String(session?.relationship?.groupId || '').trim();
        if (!inCustom) {
          wx.showToast({ title: '已在默认分组', icon: 'none' });
          return;
        }

        wx.showLoading({ title: '移动中...' });
        api
          .updateSessionRelationship(session.id, { groupId: null })
          .then(() => {
            wx.hideLoading();
            wx.showToast({ title: '已移出分组', icon: 'none' });
            this.getMessageList();
            this.loadRelationshipGroups();
          })
          .catch((err) => {
            wx.hideLoading();
            wx.showToast({ title: err?.message || '移动失败', icon: 'none' });
          });
        return;
      }

      if (!gid) return;

      wx.showLoading({ title: '移动中...' });
      api
        .updateSessionRelationship(session.id, { groupId: gid })
        .then(() => {
          wx.hideLoading();
          wx.showToast({ title: '已移动', icon: 'none' });
          this.getMessageList();
          this.loadRelationshipGroups();
        })
        .catch((err) => {
          wx.hideLoading();
          wx.showToast({ title: err?.message || '移动失败', icon: 'none' });
        });
    }
  },

  onSessionTouchCancel(event) {
    if (!this.data.dragging) return;
    const sid = String(event?.currentTarget?.dataset?.id || '').trim();
    if (!sid || sid !== this.data.draggingSessionId) return;
    this.endDragUi();
  },

  endDragUi() {
    // Restore collapse states to what the user had before dragging (so auto-expand is temporary).
    const origin = Array.isArray(this._dragOriginalCollapsedKeys) ? this._dragOriginalCollapsedKeys : null;
    if (origin) {
      this.setData({ collapsedGroupKeys: origin });
      this.saveCollapsedGroups(origin);
      this.setSessions(this.data.sessions);
    }

    this._dragHoverGroupKey = '';
    this._dragHeaderRects = null;
    this._dragTopZoneRect = null;
    this._dragBottomZoneRect = null;
    this._dragAutoExpanded = null;
    this._dragOriginalCollapsedKeys = null;

    this.setData({
      dragging: false,
      draggingSessionId: '',
      draggingSession: null,
      dragTargetType: 'none',
      dragTargetKey: '',
    });
  },

  createGroupAndMoveSession(session) {
    wx.showLoading({ title: '创建中...' });
    api
      .listRelationshipGroups()
      .catch(() => [])
      .then((groups) => {
        const name = findNextAutoGroupName(groups);
        return api.createRelationshipGroup(name);
      })
      .then((group) => {
        const gid = String(group?.id || '').trim();
        if (!gid) throw new Error('missing group id');
        return api.updateSessionRelationship(session.id, { groupId: gid });
      })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已新建分组', icon: 'none' });
        this.getMessageList();
        this.loadRelationshipGroups();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err?.message || '创建失败', icon: 'none' });
      });
  },

  onTapGroupMenu(event) {
    const key = String(event?.currentTarget?.dataset?.key || '').trim();
    if (!key || !key.startsWith('group:')) return;
    const title = String(event?.currentTarget?.dataset?.title || '').trim();
    this.setData({ groupMenuVisible: true, groupMenuKey: key, groupMenuTitle: title || '分组' });
  },

  onGroupMenuVisibleChange(e) {
    const visible = !!e?.detail?.visible;
    this.setData({ groupMenuVisible: visible });
  },

  onCloseGroupMenu() {
    this.setData({ groupMenuVisible: false });
  },

  onOpenGroupRename() {
    const key = String(this.data.groupMenuKey || '').trim();
    if (!key) return;
    const currentName = String(this.data.groupMenuTitle || '').trim();
    this.setData({ groupMenuVisible: false, groupRenameVisible: true, groupRenameName: currentName });
  },

  onGroupRenameVisibleChange(e) {
    const visible = !!e?.detail?.visible;
    this.setData({ groupRenameVisible: visible });
  },

  onCloseGroupRename() {
    this.setData({ groupRenameVisible: false });
  },

  onGroupRenameNameChange(e) {
    const v = e?.detail?.value;
    this.setData({ groupRenameName: typeof v === 'string' ? v : String(v || '') });
  },

  onGroupRenameConfirm() {
    const key = String(this.data.groupMenuKey || '').trim();
    const gid = parseGroupIdFromKey(key);
    if (!gid) return;

    const name = String(this.data.groupRenameName || '').trim();
    if (!name) {
      wx.showToast({ title: '请输入分组名', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...' });
    api
      .renameRelationshipGroup(gid, name)
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已更新', icon: 'none' });
        this.setData({ groupRenameVisible: false, groupMenuVisible: false, groupMenuTitle: name });
        this.loadRelationshipGroups();
        this.getMessageList();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err?.message || '保存失败', icon: 'none' });
      });
  },

  onDeleteGroup() {
    const key = String(this.data.groupMenuKey || '').trim();
    const gid = parseGroupIdFromKey(key);
    if (!gid) return;

    const title = String(this.data.groupMenuTitle || '').trim() || '分组';

    wx.showModal({
      title: '删除分组',
      content: `确定要删除「${title}」吗？`,
      confirmText: '删除',
      cancelText: '取消',
      success: (res) => {
        if (!res?.confirm) return;
        this.deleteGroupAndUnassignSessions(gid);
      },
    });
  },

  deleteGroupAndUnassignSessions(groupId) {
    const gid = String(groupId || '').trim();
    if (!gid) return;

    const sessionsInGroup = (this.data.sessions || []).filter((s) => {
      const sid = String(s?.id || '').trim();
      if (!sid || s?.isAI) return false;
      const relGid = String(s?.relationship?.groupId || '').trim();
      return relGid && relGid === gid;
    });

    const unassignIds = sessionsInGroup.map((s) => s.id);

    const runSequential = (ids, fn) => {
      let p = Promise.resolve();
      (ids || []).forEach((id) => {
        p = p.then(() => fn(id));
      });
      return p;
    };

    wx.showLoading({ title: '删除中...' });
    runSequential(unassignIds, (sid) => api.updateSessionRelationship(sid, { groupId: null }).catch(() => null))
      .then(() => api.deleteRelationshipGroup(gid))
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已删除', icon: 'none' });
        this.setData({ groupMenuVisible: false, groupRenameVisible: false, groupMenuKey: '', groupMenuTitle: '' });
        this.loadRelationshipGroups();
        this.getMessageList();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err?.message || '删除失败', icon: 'none' });
      });
  },

  archiveSession(session) {
    wx.showLoading({ title: '结束中...' });
    api
      .archiveSession(session.id)
      .then(() => {
        const next = this.data.sessions.filter((s) => s.id !== session.id);
        this.setSessions(next);
        wx.hideLoading();
        wx.showToast({ title: '已结束', icon: 'none' });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '结束失败', icon: 'none' });
      });
  },

  onAcceptRequest(event) {
    const requestId = event?.currentTarget?.dataset?.id || '';
    if (!requestId) return;

    wx.showLoading({ title: '处理中...' });
    api
      .acceptSessionRequest(requestId)
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已接受', icon: 'none' });
        this.getIncomingRequests();
        this.getMessageList();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err?.message || '失败', icon: 'none' });
      });
  },

  onRejectRequest(event) {
    const requestId = event?.currentTarget?.dataset?.id || '';
    if (!requestId) return;

    wx.showLoading({ title: '处理中...' });
    api
      .rejectSessionRequest(requestId)
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已拒绝', icon: 'none' });
        this.getIncomingRequests();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err?.message || '失败', icon: 'none' });
      });
  },
});
