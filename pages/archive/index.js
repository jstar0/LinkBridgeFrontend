const api = require('../../utils/linkbridge/api');

Page({
  data: {
    users: [],
    indexList: [],
  },

  onLoad() {
    this.loadArchivedUsers();
  },

  onShow() {
    this.loadArchivedUsers();
  },

  loadArchivedUsers() {
    wx.showLoading({ title: '加载中...' });

    api.listSessions('archived')
      .then((sessions) => {
        // Group sessions by peer user
        const userMap = new Map();

        sessions.forEach((session) => {
          const peer = session.peer;
          if (!peer) return;

          const userId = peer.id;
          if (!userMap.has(userId)) {
            userMap.set(userId, {
              id: userId,
              displayName: peer.displayName || '未知用户',
              avatar: peer.avatar || '',
              role: this.getRoleLabel(peer.role),
              sessions: [],
              lastArchiveTime: '',
            });
          }

          const user = userMap.get(userId);
          user.sessions.push(session);

          // Update last archive time
          if (session.archivedAt) {
            const archiveTime = new Date(session.archivedAt);
            if (!user.lastArchiveTime || archiveTime > new Date(user.lastArchiveTime)) {
              user.lastArchiveTime = this.formatDate(archiveTime);
            }
          }
        });

        // Convert map to array and sort by first letter
        const users = Array.from(userMap.values()).sort((a, b) => {
          return a.displayName.localeCompare(b.displayName, 'zh-CN');
        });

        // Generate index list (A-Z, #)
        const indexList = this.generateIndexList(users);

        this.setData({ users, indexList });
      })
      .catch((err) => {
        console.error('Failed to load archived users:', err);
        wx.showToast({
          title: '加载失败',
          icon: 'none',
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  getRoleLabel(role) {
    const roleMap = {
      teacher: '[教师]',
      student: '[学生]',
      admin: '[行政]',
    };
    return roleMap[role] || '';
  },

  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  generateIndexList(users) {
    const indexes = new Set();
    users.forEach((user) => {
      const firstChar = user.displayName.charAt(0).toUpperCase();
      if (/[A-Z]/.test(firstChar)) {
        indexes.add(firstChar);
      } else {
        indexes.add('#');
      }
    });
    return Array.from(indexes).sort();
  },

  onIndexSelect(e) {
    const { index } = e.detail;
    console.log('Selected index:', index);
    // TDesign Indexes component handles scrolling automatically
  },

  onUserClick(e) {
    const { user } = e.currentTarget.dataset;
    if (!user || !user.sessions || user.sessions.length === 0) return;

    // Navigate to chat page with archived mode
    // Use the first session ID (or we could show a session picker)
    const sessionId = user.sessions[0].id;
    wx.navigateTo({
      url: `/pages/chat/index?sessionId=${sessionId}&archived=true&peerId=${user.id}`,
    });
  },

  onUserLongPress(e) {
    const { user } = e.currentTarget.dataset;
    if (!user) return;

    wx.showActionSheet({
      itemList: ['删除此用户的归档记录'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.deleteUserArchive(user);
        }
      },
    });
  },

  deleteUserArchive(user) {
    wx.showModal({
      title: '确认删除',
      content: `删除后，你将无法查看与 ${user.displayName} 的归档消息（对方仍可见）`,
      success: (res) => {
        if (res.confirm) {
          this.hideUserSessions(user);
        }
      },
    });
  },

  hideUserSessions(user) {
    wx.showLoading({ title: '删除中...' });

    // Hide all sessions with this user
    const promises = user.sessions.map((session) => api.hideSession(session.id));

    Promise.all(promises)
      .then(() => {
        wx.showToast({
          title: '已删除',
          icon: 'success',
        });
        // Reload the list
        this.loadArchivedUsers();
      })
      .catch((err) => {
        console.error('Failed to hide sessions:', err);
        wx.showToast({
          title: '删除失败',
          icon: 'none',
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },
});
