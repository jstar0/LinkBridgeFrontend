const BASE_URL = 'http://localhost:8080';

function request(method, path, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${path}`,
      method,
      data,
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(res.data?.error || { code: 'unknown', message: 'Request failed' });
        }
      },
      fail(err) {
        reject({ code: 'network', message: err.errMsg || 'Network error' });
      },
    });
  });
}

function listSessions(status = 'active') {
  return request('GET', `/v1/sessions?status=${status}`).then((res) => res.sessions || []);
}

function createSession(peerName, peerIdentity) {
  return request('POST', '/v1/sessions', { peerName, peerIdentity }).then((res) => res.session);
}

function archiveSession(sessionId) {
  return request('POST', `/v1/sessions/${sessionId}/archive`).then((res) => res.session);
}

function listMessages(sessionId) {
  return request('GET', `/v1/sessions/${sessionId}/messages`).then((res) => res.messages || []);
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

module.exports = {
  BASE_URL,
  listSessions,
  createSession,
  archiveSession,
  listMessages,
  sendTextMessage,
  sendAttachmentMessage,
};
