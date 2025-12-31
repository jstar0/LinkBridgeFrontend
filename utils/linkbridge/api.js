const BASE_URL = 'http://localhost:8080';
const WS_URL = 'ws://localhost:8080';

const TOKEN_KEY = 'linkbridge_token';
const USER_KEY = 'linkbridge_user';

function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

function setToken(token) {
  try {
    if (token) {
      wx.setStorageSync(TOKEN_KEY, token);
    } else {
      wx.removeStorageSync(TOKEN_KEY);
    }
  } catch (e) {
    console.error('Failed to save token:', e);
  }
}

function getUser() {
  try {
    const data = wx.getStorageSync(USER_KEY);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

function setUser(user) {
  try {
    if (user) {
      wx.setStorageSync(USER_KEY, JSON.stringify(user));
    } else {
      wx.removeStorageSync(USER_KEY);
    }
  } catch (e) {
    console.error('Failed to save user:', e);
  }
}

function clearAuth() {
  setToken('');
  setUser(null);
}

function isLoggedIn() {
  return !!getToken();
}

function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const header = { 'Content-Type': 'application/json' };
    if (token) {
      header['Authorization'] = `Bearer ${token}`;
    }

    wx.request({
      url: `${BASE_URL}${path}`,
      method,
      data,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          const error = res.data?.error || { code: 'unknown', message: 'Request failed' };
          if (error.code === 'TOKEN_INVALID' || error.code === 'TOKEN_EXPIRED') {
            clearAuth();
            wx.reLaunch({ url: '/pages/linkbridge/login/login' });
          }
          reject(error);
        }
      },
      fail(err) {
        reject({ code: 'network', message: err.errMsg || 'Network error' });
      },
    });
  });
}

function register(username, password, displayName) {
  return request('POST', '/v1/auth/register', { username, password, displayName }).then((res) => {
    setToken(res.token);
    setUser(res.user);
    return bindWeChatSession().catch(() => null).then(() => res);
  });
}

function login(username, password) {
  return request('POST', '/v1/auth/login', { username, password }).then((res) => {
    setToken(res.token);
    setUser(res.user);
    return bindWeChatSession().catch(() => null).then(() => res);
  });
}

function logout() {
  return request('POST', '/v1/auth/logout')
    .then((res) => {
      clearAuth();
      return res;
    })
    .catch((err) => {
      clearAuth();
      throw err;
    });
}

function getMe() {
  return request('GET', '/v1/auth/me').then((res) => res.user);
}

function searchUsers(query) {
  return request('GET', `/v1/users?q=${encodeURIComponent(query)}`).then((res) => res.users || []);
}

function getUserById(userId) {
  return request('GET', `/v1/users/${userId}`).then((res) => res.user);
}

function updateDisplayName(displayName) {
  return request('PUT', '/v1/users/me', { displayName }).then((res) => res.user);
}

function listSessions(status = 'active') {
  return request('GET', `/v1/sessions?status=${status}`).then((res) => res.sessions || []);
}

function createSession(peerUserId) {
  return request('POST', '/v1/sessions', { peerUserId }).then((res) => ({
    session: res.session,
    created: res.created,
    hint: res.hint,
  }));
}

function archiveSession(sessionId) {
  return request('POST', `/v1/sessions/${sessionId}/archive`).then((res) => res.session);
}

function listMessages(sessionId, beforeId) {
  let path = `/v1/sessions/${sessionId}/messages`;
  if (beforeId) {
    path += `?before=${encodeURIComponent(beforeId)}`;
  }
  return request('GET', path).then((res) => ({
    messages: res.messages || [],
    hasMore: res.hasMore || false,
  }));
}

function sendTextMessage(sessionId, text) {
  return request('POST', `/v1/sessions/${sessionId}/messages`, { type: 'text', text }).then(
    (res) => res.message
  );
}

function sendAttachmentMessage(sessionId, type, meta) {
  return request('POST', `/v1/sessions/${sessionId}/messages`, { type, meta }).then(
    (res) => res.message
  );
}

// File upload
function uploadFile(filePath) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    wx.uploadFile({
      url: `${BASE_URL}/v1/upload`,
      filePath: filePath,
      name: 'file',
      header: {
        Authorization: token ? `Bearer ${token}` : '',
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const data = JSON.parse(res.data);
            resolve(data);
          } catch (e) {
            reject({ code: 'parse_error', message: 'Failed to parse response' });
          }
        } else {
          reject({ code: 'upload_failed', message: 'Upload failed' });
        }
      },
      fail(err) {
        reject({ code: 'network', message: err.errMsg || 'Network error' });
      },
    });
  });
}

// WebSocket connection
let wsConnection = null;
let wsMessageHandlers = [];

function connectWebSocket() {
  const token = getToken();
  if (!token) {
    console.error('Cannot connect WebSocket: no token');
    return null;
  }

  if (wsConnection) {
    return wsConnection;
  }

  wsConnection = wx.connectSocket({
    url: `${WS_URL}/v1/ws?token=${encodeURIComponent(token)}`,
    success() {
      console.log('WebSocket connecting...');
    },
    fail(err) {
      console.error('WebSocket connect failed:', err);
      wsConnection = null;
    },
  });

  wx.onSocketOpen(() => {
    console.log('WebSocket connected');
  });

  wx.onSocketMessage((res) => {
    try {
      const data = JSON.parse(res.data);
      wsMessageHandlers.forEach((handler) => {
        try {
          handler(data);
        } catch (e) {
          console.error('WebSocket handler error:', e);
        }
      });
    } catch (e) {
      console.error('WebSocket parse error:', e);
    }
  });

  wx.onSocketError((err) => {
    console.error('WebSocket error:', err);
  });

  wx.onSocketClose(() => {
    console.log('WebSocket closed');
    wsConnection = null;
  });

  return wsConnection;
}

function closeWebSocket() {
  if (wsConnection) {
    wx.closeSocket();
    wsConnection = null;
  }
}

function addWebSocketHandler(handler) {
  if (typeof handler === 'function' && !wsMessageHandlers.includes(handler)) {
    wsMessageHandlers.push(handler);
  }
}

function removeWebSocketHandler(handler) {
  const index = wsMessageHandlers.indexOf(handler);
  if (index > -1) {
    wsMessageHandlers.splice(index, 1);
  }
}

function bindWeChatSession() {
  return new Promise((resolve, reject) => {
    if (typeof wx?.login !== 'function') {
      reject({ code: 'unsupported', message: 'wx.login not available' });
      return;
    }

    wx.login({
      success(res) {
        const code = res?.code || '';
        if (!code) {
          reject({ code: 'login_failed', message: 'missing code' });
          return;
        }
        request('POST', '/v1/wechat/bind', { code })
          .then(resolve)
          .catch(reject);
      },
      fail(err) {
        reject({ code: 'wx_login_failed', message: err?.errMsg || 'wx.login failed' });
      },
    });
  });
}

const CALL_SUBSCRIBE_TEMPLATE_ID = 'EMhcu11Ulsg58TCbXdkpJag5T5YxpxsPVuNo8mzSwqE';

function requestCallSubscribePermission() {
  return new Promise((resolve, reject) => {
    if (!CALL_SUBSCRIBE_TEMPLATE_ID) {
      resolve({ skipped: true });
      return;
    }
    if (typeof wx?.requestSubscribeMessage !== 'function') {
      reject({ code: 'unsupported', message: 'requestSubscribeMessage not available' });
      return;
    }

    wx.requestSubscribeMessage({
      tmplIds: [CALL_SUBSCRIBE_TEMPLATE_ID],
      success(res) {
        resolve(res);
      },
      fail(err) {
        reject({ code: 'subscribe_failed', message: err?.errMsg || 'subscribe failed' });
      },
    });
  });
}

function createCall(calleeUserId, mediaType = 'voice') {
  return request('POST', '/v1/calls', { calleeUserId, mediaType }).then((res) => res.call);
}

function getCall(callId) {
  return request('GET', `/v1/calls/${callId}`).then((res) => res);
}

function acceptCall(callId) {
  return request('POST', `/v1/calls/${callId}/accept`).then((res) => res.call);
}

function rejectCall(callId) {
  return request('POST', `/v1/calls/${callId}/reject`).then((res) => res.call);
}

function cancelCall(callId) {
  return request('POST', `/v1/calls/${callId}/cancel`).then((res) => res.call);
}

function endCall(callId) {
  return request('POST', `/v1/calls/${callId}/end`).then((res) => res.call);
}

function getVoipSign(callId) {
  return request('GET', `/v1/calls/${callId}/voip`).then((res) => res);
}

function requestFriend(userId) {
  return request('POST', '/v1/friends', { userId }).then((res) => res.request);
}

function listFriends() {
  return request('GET', '/v1/friends').then((res) => res.friends || []);
}

function listFriendRequests(box = 'incoming', status = 'pending') {
  const params = [];
  if (box) params.push(`box=${encodeURIComponent(box)}`);
  if (status) params.push(`status=${encodeURIComponent(status)}`);
  const qs = params.length ? `?${params.join('&')}` : '';
  return request('GET', `/v1/friends/requests${qs}`).then((res) => res.requests || []);
}

function acceptFriendRequest(requestId) {
  return request('POST', `/v1/friends/requests/${requestId}/accept`).then((res) => res.request);
}

function rejectFriendRequest(requestId) {
  return request('POST', `/v1/friends/requests/${requestId}/reject`).then((res) => res.request);
}

function cancelFriendRequest(requestId) {
  return request('POST', `/v1/friends/requests/${requestId}/cancel`).then((res) => res.request);
}

function consumeFriendInvite(code) {
  return request('POST', '/v1/friends/invites/consume', { code }).then((res) => res.request);
}

function getMyFriendQrImageUrl(cacheBuster = Date.now()) {
  const token = getToken();
  if (!token) return '';
  return `${BASE_URL}/v1/wechat/qrcode/friend?token=${encodeURIComponent(token)}&t=${encodeURIComponent(
    cacheBuster
  )}`;
}

module.exports = {
  BASE_URL,
  WS_URL,
  getToken,
  setToken,
  getUser,
  setUser,
  clearAuth,
  isLoggedIn,
  register,
  login,
  logout,
  getMe,
  searchUsers,
  getUserById,
  updateDisplayName,
  listSessions,
  createSession,
  archiveSession,
  listMessages,
  sendTextMessage,
  sendAttachmentMessage,
  uploadFile,
  connectWebSocket,
  closeWebSocket,
  addWebSocketHandler,
  removeWebSocketHandler,
  bindWeChatSession,
  requestCallSubscribePermission,
  createCall,
  getCall,
  acceptCall,
  rejectCall,
  cancelCall,
  endCall,
  getVoipSign,
  requestFriend,
  listFriends,
  listFriendRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  consumeFriendInvite,
  getMyFriendQrImageUrl,
};
