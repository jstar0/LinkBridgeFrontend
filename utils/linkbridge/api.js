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

/**
 * Low-level HTTP request wrapper (the only place allowed to call `wx.request`).
 *
 * @param {string} method
 * @param {string} path - relative path, e.g. `/v1/auth/me`
 * @param {any} data
 * @param {{ responseType?: 'text'|'arraybuffer', header?: Record<string,string> }} [options]
 */
function request(method, path, data, options = {}) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const header = { 'Content-Type': 'application/json' };
    if (token) {
      header.Authorization = `Bearer ${token}`;
    }
    if (options && options.header) Object.assign(header, options.header);

    wx.request({
      url: `${getBaseUrl()}${path}`,
      method,
      data,
      header,
      responseType: options?.responseType,
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

/**
 * Raw request helper for non-JSON endpoints (kept here to satisfy the "api.js only" networking rule).
 *
 * @param {import('miniprogram-api-typings').WxRequestOption} options
 */
function wxRequest(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      ...options,
      success: (res) => resolve(res),
      fail: (err) => reject(err),
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

/**
 * Create a "map relationship request" (request -> accept -> session created).
 *
 * POST /v1/session-requests
 * Request body:
 * - addresseeId: string (required)        // target user id
 * - verificationMessage: string (optional, max ~120 chars suggested)
 *
 * Response:
 * - request: { id, requesterId, addresseeId, status, createdAtMs, updatedAtMs }
 * - created: boolean
 * - hint?: string
 *
 * Error codes (backend main as of now):
 * - TOKEN_INVALID / TOKEN_EXPIRED
 * - VALIDATION_ERROR
 * - SESSION_REQUEST_EXISTS
 * - RATE_LIMITED (daily max 10 for map requests)
 * - COOLDOWN_ACTIVE (cooldown 3 days after rejection)
 * - SESSION_EXISTS (session already exists and is active)
 */
function createLocalFeedRelationshipRequest(addresseeId, verificationMessage) {
  const addressee = String(addresseeId || '').trim();
  const msg = String(verificationMessage || '').trim();
  if (!addressee) return Promise.reject({ code: 'VALIDATION', message: 'addresseeId is required' });
  return request('POST', '/v1/session-requests', { addresseeId: addressee, verificationMessage: msg ? msg.slice(0, 120) : '' }).then(
    (res) => res
  );
}

/**
 * Local Feed: get current user's Home Base (location pin).
 *
 * GET /v1/home-base
 * Response:
 * - homeBase: { lat: number, lng: number, lastUpdatedYmd: number, updatedAtMs: number } | null
 *
 * Error codes:
 * - TOKEN_INVALID / TOKEN_EXPIRED
 */
function getLocalFeedHomeBase() {
  return request('GET', '/v1/home-base').then((res) => res.homeBase ?? null);
}

/**
 * Local Feed: set/update current user's Home Base (location pin).
 *
 * PUT /v1/home-base
 * Request body:
 * - lat: number (required)
 * - lng: number (required)
 *
 * Response:
 * - homeBase: { lat: number, lng: number, lastUpdatedYmd: number, updatedAtMs: number }
 *
 * Error codes (backend main as of now):
 * - TOKEN_INVALID / TOKEN_EXPIRED
 * - VALIDATION_ERROR
 * - HOME_BASE_UPDATE_LIMITED (daily max 1 change; reset at 00:00)
 */
function setLocalFeedHomeBase({ name, lat, lng }) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return Promise.reject({ code: 'VALIDATION', message: 'invalid lat/lng' });
  return request('PUT', '/v1/home-base', { lat: la, lng: ln }).then((res) => res.homeBase);
}

/**
 * Local Feed: create a post.
 *
 * POST /v1/local-feed/posts
 * Request body:
 * - text?: string
 * - imageUrls?: string[]     // already-uploaded URLs (use api.uploadFile first)
 * - isPinned?: boolean
 * - radiusM?: number         // visibility radius (meters)
 * - expiresAtMs: number      // absolute expire time
 *
 * Response:
 * - post: { id, userId, text?, radiusM, expiresAtMs, isPinned, createdAtMs, updatedAtMs, images:[{url,sortOrder}] }
 *
 * Error codes:
 * - TOKEN_INVALID / TOKEN_EXPIRED
 * - VALIDATION_ERROR
 */
function createLocalFeedPost(payload) {
  const p = payload || {};
  const text = typeof p.text === 'string' ? p.text : p.text == null ? undefined : String(p.text);
  const expiresAtMs = Number(p.expiresAtMs);

  const isPinned = typeof p.isPinned === 'boolean' ? p.isPinned : typeof p.pinned === 'boolean' ? p.pinned : undefined;

  let radiusM = p.radiusM != null ? Number(p.radiusM) : NaN;
  if (!Number.isFinite(radiusM) && p.radiusKm != null) {
    const km = Number(p.radiusKm);
    if (Number.isFinite(km)) radiusM = Math.round(km * 1000);
  }
  if (!Number.isFinite(radiusM)) radiusM = undefined;

  const imageUrls = Array.isArray(p.imageUrls) ? p.imageUrls : Array.isArray(p.images) ? p.images : [];

  return request('POST', '/v1/local-feed/posts', {
    text,
    imageUrls: (imageUrls || []).map((u) => String(u || '').trim()).filter(Boolean),
    radiusM,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : undefined,
    isPinned,
  }).then((res) => res.post);
}

/**
 * Local Feed: list my posts.
 *
 * GET /v1/local-feed/posts
 * Response: { posts: localFeedPostItem[] }
 */
function listMyLocalFeedPosts() {
  return request('GET', '/v1/local-feed/posts').then((res) => res.posts || []);
}

/**
 * Local Feed: delete my post.
 *
 * POST /v1/local-feed/posts/:id/delete
 * Response: { deleted: true }
 */
function deleteLocalFeedPost(postId) {
  const id = String(postId || '').trim();
  if (!id) return Promise.reject({ code: 'VALIDATION', message: 'postId is required' });
  return request('POST', `/v1/local-feed/posts/${encodeURIComponent(id)}/delete`).then((res) => res);
}

/**
 * Local Feed: list map pins for current view.
 *
 * GET /v1/local-feed/pins?minLat=...&maxLat=...&minLng=...&maxLng=...&centerLat=...&centerLng=...&limit=...
 * Response: { pins: Pin[] }
 *
 * Pin schema (backend main as of now):
 * - userId: string
 * - displayName: string
 * - avatarUrl?: string
 * - lat: number
 * - lng: number
 * - updatedAtMs: number
 */
function listLocalFeedPins(params = {}) {
  const p = params || {};
  let minLat = p.minLat != null ? Number(p.minLat) : undefined;
  let maxLat = p.maxLat != null ? Number(p.maxLat) : undefined;
  let minLng = p.minLng != null ? Number(p.minLng) : undefined;
  let maxLng = p.maxLng != null ? Number(p.maxLng) : undefined;

  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) {
    const raw = String(p.bbox || '').trim();
    if (raw) {
      const parts = raw.split(',').map((x) => Number(String(x || '').trim()));
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        [minLat, minLng, maxLat, maxLng] = parts;
      }
    }
  }

  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) {
    return Promise.reject({ code: 'VALIDATION', message: 'bbox/minLat/maxLat/minLng/maxLng is required' });
  }

  const centerLatRaw = p.centerLat != null ? Number(p.centerLat) : (minLat + maxLat) / 2;
  const centerLngRaw = p.centerLng != null ? Number(p.centerLng) : (minLng + maxLng) / 2;
  if (![centerLatRaw, centerLngRaw].every(Number.isFinite)) {
    return Promise.reject({ code: 'VALIDATION', message: 'centerLat/centerLng is required' });
  }

  const qs = [
    ['minLat', minLat],
    ['maxLat', maxLat],
    ['minLng', minLng],
    ['maxLng', maxLng],
    ['centerLat', centerLatRaw],
    ['centerLng', centerLngRaw],
    ['limit', p.limit],
  ]
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  return request('GET', `/v1/local-feed/pins?${qs}`).then((res) => res.pins || []);
}

/**
 * Local Feed: list a user's visible posts for the current viewer.
 *
 * GET /v1/local-feed/users/:userId/posts?atLat=...&atLng=...
 * Response: { posts: localFeedPostItem[] }
 */
function listLocalFeedUserPosts(userId, viewerLat, viewerLng) {
  const uid = String(userId || '').trim();
  if (!uid) return Promise.reject({ code: 'VALIDATION', message: 'userId is required' });
  const la = Number(viewerLat);
  const ln = Number(viewerLng);
  const qs = Number.isFinite(la) && Number.isFinite(ln) ? `atLat=${encodeURIComponent(la)}&atLng=${encodeURIComponent(ln)}` : '';
  const suffix = qs ? `?${qs}` : '';
  return request('GET', `/v1/local-feed/users/${encodeURIComponent(uid)}/posts${suffix}`).then((res) => res.posts || []);
}

function normalizeSessionRequestBox(box) {
  const v = String(box || '').trim();
  if (v === 'incoming' || v === 'outgoing') return v;
  if (v === 'in') return 'incoming';
  if (v === 'out') return 'outgoing';
  return 'incoming';
}

function listSessionRequests(box = 'incoming', status = 'pending') {
  const qs = `box=${encodeURIComponent(normalizeSessionRequestBox(box))}&status=${encodeURIComponent(status)}`;
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

/**
 * GET /v1/wechat/qrcode/session
 * Response: PNG binary (arraybuffer)
 * Errors: TOKEN_INVALID/TOKEN_EXPIRED/WECHAT_NOT_CONFIGURED/...
 */
function getMyWeChatCodePng() {
  return request('GET', '/v1/wechat/qrcode/session', null, { responseType: 'arraybuffer' });
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
  wxRequest,
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
  createLocalFeedRelationshipRequest,
  getLocalFeedHomeBase,
  setLocalFeedHomeBase,
  createLocalFeedPost,
  listMyLocalFeedPosts,
  deleteLocalFeedPost,
  listLocalFeedPins,
  listLocalFeedUserPosts,
  listSessionRequests,
  acceptSessionRequest,
  rejectSessionRequest,
  cancelSessionRequest,
  getMySessionQrImageUrl,
  getMyWeChatCodePng,
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
