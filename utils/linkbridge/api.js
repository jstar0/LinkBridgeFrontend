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
    return res;
  });
}

function login(username, password) {
  return request('POST', '/v1/auth/login', { username, password }).then((res) => {
    setToken(res.token);
    setUser(res.user);
    return res;
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
};
