const api = require('../../utils/linkbridge/api');
const app = getApp();

const COLLAPSED_GROUPS_KEY = 'lb_message_group_collapsed_v1';

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

function buildSessionGroups(sessions, collapsedKeys = [], groupNameById = {}) {
  const list = Array.isArray(sessions) ? sessions : [];
  const collapsed = new Set(Array.isArray(collapsedKeys) ? collapsedKeys : []);

  const groupsMap = new Map();

  for (const s of list) {
    if (!s || !s.id) continue;
    if (s.isAI) continue;

    const rel = s.relationship || {};
    const groupId = rel.groupId ? String(rel.groupId).trim() : '';

    let key = '';
    let title = '';
    if (groupId) {
      key = `group:${groupId}`;
      title = String(rel.groupName || groupNameById?.[groupId] || '分组');
    } else {
      const src = normalizeSessionSource(s.source || rel.source);
      key = `auto:${src}`;
      title = getAutoGroupTitle(src);
    }

    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        key,
        title,
        collapsed: collapsed.has(key),
        sessions: [],
        latestUpdatedAtMs: Number(s.updatedAtMs || 0) || 0,
      });
    }

    groupsMap.get(key).sessions.push(s);
  }

  const groups = Array.from(groupsMap.values());
  groups.sort((a, b) => (Number(b.latestUpdatedAtMs || 0) || 0) - (Number(a.latestUpdatedAtMs || 0) || 0));
  groups.forEach((g) => {
    g.count = Array.isArray(g.sessions) ? g.sessions.length : 0;
  });

  return groups;
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
    groupPickerVisible: false,
    createGroupVisible: false,
    groupActionSession: null,
    newGroupName: '',
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
    const groupNameById = {};
    (this.data.relationshipGroups || []).forEach((g) => {
      if (g && g.id) groupNameById[String(g.id)] = String(g.name || '');
    });

    const sessionGroups = buildSessionGroups(sessions, this.data.collapsedGroupKeys, groupNameById);
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

    const hasGroup = !!(session?.relationship?.groupId && String(session.relationship.groupId).trim());
    const items = hasGroup ? ['移动到分组', '创建分组并移动', '从分组移除', '结束会话'] : ['移动到分组', '创建分组并移动', '结束会话'];

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const idx = Number(res?.tapIndex);
        if (!Number.isFinite(idx) || idx < 0) return;

        if (idx === 0) {
          this.openGroupPicker(session);
          return;
        }
        if (idx === 1) {
          this.openCreateGroup(session);
          return;
        }
        if (hasGroup && idx === 2) {
          wx.showLoading({ title: '处理中...' });
          api
            .updateSessionRelationship(session.id, { groupId: null })
            .then(() => {
              wx.hideLoading();
              wx.showToast({ title: '已移出分组', icon: 'none' });
              this.getMessageList();
            })
            .catch((err) => {
              wx.hideLoading();
              wx.showToast({ title: err?.message || '失败', icon: 'none' });
            });
          return;
        }

        // "结束会话"
        if ((!hasGroup && idx === 2) || (hasGroup && idx === 3)) this.archiveSession(session);
      },
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

  openGroupPicker(session) {
    this.setData({ groupActionSession: session, groupPickerVisible: true });
    this.loadRelationshipGroups();
  },

  openCreateGroup(session) {
    this.setData({ groupActionSession: session, createGroupVisible: true, newGroupName: '' });
  },

  onGroupPickerVisibleChange(e) {
    const visible = !!e?.detail?.visible;
    this.setData({ groupPickerVisible: visible });
  },

  onCloseGroupPicker() {
    this.setData({ groupPickerVisible: false });
  },

  onCreateGroupVisibleChange(e) {
    const visible = !!e?.detail?.visible;
    this.setData({ createGroupVisible: visible });
  },

  onCloseCreateGroup() {
    this.setData({ createGroupVisible: false });
  },

  loadRelationshipGroups() {
    return api
      .listRelationshipGroups()
      .then((groups) => {
        this.setData({ relationshipGroups: Array.isArray(groups) ? groups : [] });
        // Refresh groups' title mapping (only affects manual group title fallback).
        this.setSessions(this.data.sessions);
      })
      .catch(() => {
        this.setData({ relationshipGroups: [] });
      });
  },

  onPickGroup(event) {
    const groupId = event?.currentTarget?.dataset?.id;
    const session = this.data.groupActionSession;
    if (!session?.id) return;

    const gid = String(groupId || '').trim();
    if (!gid) return;

    wx.showLoading({ title: '处理中...' });
    api
      .updateSessionRelationship(session.id, { groupId: gid })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已移动', icon: 'none' });
        this.setData({ groupPickerVisible: false, groupActionSession: null });
        this.getMessageList();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err?.message || '失败', icon: 'none' });
      });
  },

  onTapCreateGroupFromPicker() {
    const session = this.data.groupActionSession;
    if (!session?.id) return;
    this.setData({ groupPickerVisible: false });
    this.openCreateGroup(session);
  },

  onClearGroup() {
    const session = this.data.groupActionSession;
    if (!session?.id) return;

    wx.showLoading({ title: '处理中...' });
    api
      .updateSessionRelationship(session.id, { groupId: null })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已移出分组', icon: 'none' });
        this.setData({ groupPickerVisible: false, groupActionSession: null });
        this.getMessageList();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err?.message || '失败', icon: 'none' });
      });
  },

  onNewGroupNameChange(e) {
    const v = e?.detail?.value;
    this.setData({ newGroupName: typeof v === 'string' ? v : String(v || '') });
  },

  onCreateGroupConfirm() {
    const name = String(this.data.newGroupName || '').trim();
    const session = this.data.groupActionSession;
    if (!session?.id) return;
    if (!name) {
      wx.showToast({ title: '请输入分组名', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '创建中...' });
    api
      .createRelationshipGroup(name)
      .then((group) => {
        const gid = String(group?.id || '').trim();
        if (!gid) throw new Error('missing group id');
        return api.updateSessionRelationship(session.id, { groupId: gid });
      })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已创建并移动', icon: 'none' });
        this.setData({ createGroupVisible: false, groupPickerVisible: false, groupActionSession: null, newGroupName: '' });
        this.getMessageList();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err?.message || '失败', icon: 'none' });
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
