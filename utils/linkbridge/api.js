function getBaseUrl() {
  return 'http://103.40.13.96:8081';
}

function getWsUrl() {
  return getBaseUrl().replace(/^http/i, 'ws');
}

// Align with template naming.
const TOKEN_KEY = 'access_token';
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
      header.Authorization = `Bearer ${token}`;
    }

    wx.request({
      url: `${getBaseUrl()}${path}`,
      method,
      data,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }

        const error = res.data?.error || { code: 'unknown', message: 'Request failed' };
        if (error.code === 'TOKEN_INVALID' || error.code === 'TOKEN_EXPIRED') {
          clearAuth();
          wx.reLaunch({ url: '/pages/login/login' });
        }
        reject(error);
      },
      fail(err) {
        reject({ code: 'network', message: err?.errMsg || 'Network error' });
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

function getUserById(userId) {
  return request('GET', `/v1/users/${encodeURIComponent(userId)}`).then((res) => res.user);
}

function updateDisplayName(displayName) {
  return request('PUT', '/v1/users/me', { displayName }).then((res) => res.user);
}

function listSessions(status = 'active') {
  return request('GET', `/v1/sessions?status=${encodeURIComponent(status)}`).then((res) => res.sessions || []);
}

function createSession(peerUserId) {
  return request('POST', '/v1/sessions', { peerUserId }).then((res) => res.session);
}

function archiveSession(sessionId) {
  return request('POST', `/v1/sessions/${encodeURIComponent(sessionId)}/archive`).then((res) => res.session);
}

function reactivateSession(sessionId) {
  return request('POST', `/v1/sessions/${encodeURIComponent(sessionId)}/reactivate`).then((res) => res.session);
}

function hideSession(sessionId) {
  return request('POST', `/v1/sessions/${encodeURIComponent(sessionId)}/hide`).then((res) => res);
}

function listMessages(sessionId, beforeId) {
  let path = `/v1/sessions/${encodeURIComponent(sessionId)}/messages`;
  if (beforeId) {
    path += `?before=${encodeURIComponent(beforeId)}`;
  }
  return request('GET', path).then((res) => ({
    messages: res.messages || [],
    hasMore: !!res.hasMore,
  }));
}

function sendTextMessage(sessionId, text) {
  return request('POST', `/v1/sessions/${encodeURIComponent(sessionId)}/messages`, { type: 'text', text }).then(
    (res) => res.message
  );
}

function uploadFile(filePath, name) {
  const token = getToken();
  if (!token) return Promise.reject({ code: 'TOKEN_REQUIRED', message: 'Not logged in' });
  if (!filePath) return Promise.reject({ code: 'VALIDATION', message: 'missing filePath' });

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${getBaseUrl()}/v1/upload`,
      filePath,
      name: 'file',
      formData: name ? { name } : undefined,
      header: { Authorization: `Bearer ${token}` },
      success(res) {
        try {
          const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          resolve(data);
        } catch (e) {
          reject({ code: 'PARSE', message: 'invalid upload response' });
        }
      },
      fail(err) {
        reject({ code: 'network', message: err?.errMsg || 'upload failed' });
      },
    });
  });
}

function sendImageMessage(sessionId, meta) {
  return request('POST', `/v1/sessions/${encodeURIComponent(sessionId)}/messages`, { type: 'image', meta }).then(
    (res) => res.message
  );
}

function sendFileMessage(sessionId, meta) {
  return request('POST', `/v1/sessions/${encodeURIComponent(sessionId)}/messages`, { type: 'file', meta }).then(
    (res) => res.message
  );
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
        request('POST', '/v1/wechat/bind', { code }).then(resolve).catch(reject);
      },
      fail(err) {
        reject({ code: 'wx_login_failed', message: err?.errMsg || 'wx.login failed' });
      },
    });
  });
}

function createCall(calleeUserId, mediaType = 'voice') {
  return request('POST', '/v1/calls', { calleeUserId, mediaType }).then((res) => res.call);
}

function getCall(callId) {
  return request('GET', `/v1/calls/${encodeURIComponent(callId)}`).then((res) => res);
}

function acceptCall(callId) {
  return request('POST', `/v1/calls/${encodeURIComponent(callId)}/accept`).then((res) => res.call);
}

function rejectCall(callId) {
  return request('POST', `/v1/calls/${encodeURIComponent(callId)}/reject`).then((res) => res.call);
}

function cancelCall(callId) {
  return request('POST', `/v1/calls/${encodeURIComponent(callId)}/cancel`).then((res) => res.call);
}

function endCall(callId) {
  return request('POST', `/v1/calls/${encodeURIComponent(callId)}/end`).then((res) => res.call);
}

function getVoipSign(callId) {
  return request('GET', `/v1/calls/${encodeURIComponent(callId)}/voip`).then((res) => res);
}

function consumeSessionInvite(code) {
  return request('POST', '/v1/session-requests/invites/consume', { code }).then((res) => res);
}

function listSessionRequests(box = 'in', status = 'pending') {
  const qs = `box=${encodeURIComponent(box)}&status=${encodeURIComponent(status)}`;
  return request('GET', `/v1/session-requests?${qs}`).then((res) => res.requests || []);
}

function acceptSessionRequest(requestId) {
  return request('POST', `/v1/session-requests/${encodeURIComponent(requestId)}/accept`).then((res) => res);
}

function rejectSessionRequest(requestId) {
  return request('POST', `/v1/session-requests/${encodeURIComponent(requestId)}/reject`).then((res) => res);
}

function cancelSessionRequest(requestId) {
  return request('POST', `/v1/session-requests/${encodeURIComponent(requestId)}/cancel`).then((res) => res);
}

function getMySessionQrImageUrl(cacheBuster = Date.now()) {
  const token = getToken();
  if (!token) return '';
  return `${getBaseUrl()}/v1/wechat/qrcode/session?token=${encodeURIComponent(token)}&t=${encodeURIComponent(
    cacheBuster
  )}`;
}

// WebSocket connection (single instance)
let wsConnection = null;
let wsMessageHandlers = [];

function connectWebSocket() {
  const token = getToken();
  if (!token) return null;

  if (wsConnection) return wsConnection;

  wsConnection = wx.connectSocket({
    url: `${getWsUrl()}/v1/ws?token=${encodeURIComponent(token)}`,
  });

  wx.onSocketMessage((res) => {
    try {
      const data = JSON.parse(res.data);
      wsMessageHandlers.forEach((h) => {
        try {
          h(data);
        } catch (e) {
          console.error('WebSocket handler error:', e);
        }
      });
    } catch (e) {
      console.error('WebSocket parse error:', e);
    }
  });

  wx.onSocketClose(() => {
    wsConnection = null;
  });

  return wsConnection;
}

function closeWebSocket() {
  if (!wsConnection) return;
  try {
    wx.closeSocket();
  } catch (e) {
    // ignore
  }
  wsConnection = null;
}

function addWebSocketHandler(handler) {
  if (typeof handler === 'function' && !wsMessageHandlers.includes(handler)) {
    wsMessageHandlers.push(handler);
  }
}

function removeWebSocketHandler(handler) {
  const idx = wsMessageHandlers.indexOf(handler);
  if (idx >= 0) wsMessageHandlers.splice(idx, 1);
}

function sendWebSocketJson(obj) {
  if (!obj) return;
  const payload = JSON.stringify(obj);
  try {
    wx.sendSocketMessage({ data: payload });
  } catch (e) {
    // ignore
  }
}

function sendAudioFrame(callId, base64Data) {
  const cid = String(callId || '').trim();
  const data = String(base64Data || '').trim();
  if (!cid || !data) return;
  sendWebSocketJson({ type: 'audio.frame', callId: cid, data });
}

function sendVideoFrame(callId, base64Data) {
  const cid = String(callId || '').trim();
  const data = String(base64Data || '').trim();
  if (!cid || !data) return;
  sendWebSocketJson({ type: 'video.frame', callId: cid, data });
}

// Global call state management
let activeCall = null;

function setActiveCall(callInfo) {
  activeCall = callInfo;
}

function getActiveCall() {
  return activeCall;
}

function clearActiveCall() {
  activeCall = null;
}

module.exports = {
  getBaseUrl,
  getWsUrl,
  getToken,
  setToken,
  getUser,
  setUser,
  clearAuth,
  isLoggedIn,
  request,
  register,
  login,
  logout,
  getMe,
  getUserById,
  updateDisplayName,
  listSessions,
  createSession,
  archiveSession,
  reactivateSession,
  hideSession,
  listMessages,
  sendTextMessage,
  uploadFile,
  sendImageMessage,
  sendFileMessage,
  bindWeChatSession,
  createCall,
  getCall,
  acceptCall,
  rejectCall,
  cancelCall,
  endCall,
  getVoipSign,
  consumeSessionInvite,
  listSessionRequests,
  acceptSessionRequest,
  rejectSessionRequest,
  cancelSessionRequest,
  getMySessionQrImageUrl,
  connectWebSocket,
  closeWebSocket,
  addWebSocketHandler,
  removeWebSocketHandler,
  sendWebSocketJson,
  sendAudioFrame,
  sendVideoFrame,
  setActiveCall,
  getActiveCall,
  clearActiveCall,
};
