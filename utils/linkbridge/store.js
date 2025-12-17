const STORAGE_KEY = 'lb_state_v1';
const STATE_VERSION = 1;

function safeGetStorageSync(key) {
  try {
    if (typeof wx?.getStorageSync !== 'function') return null;
    return wx.getStorageSync(key);
  } catch (error) {
    return null;
  }
}

function safeSetStorageSync(key, value) {
  try {
    if (typeof wx?.setStorageSync !== 'function') return false;
    wx.setStorageSync(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

function parseRawState(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }
  if (typeof raw === 'object') return raw;
  return null;
}

function getRandomInt(minInclusive, maxInclusive) {
  const min = Math.ceil(minInclusive);
  const max = Math.floor(maxInclusive);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateSessionId() {
  const rand = Math.random().toString(16).slice(2, 8);
  return `sess_${Date.now()}_${rand}`;
}

function generateMessageId() {
  const rand = Math.random().toString(16).slice(2, 10);
  return `msg_${Date.now()}_${rand}`;
}

function formatStudentDisplayName(peerName) {
  return `[学生] ${peerName}`;
}

function makeDefaultState() {
  const now = Date.now();

  const sessionA = {
    id: generateSessionId(),
    peerRole: 'Student',
    peerName: 'Student_8821',
    displayName: formatStudentDisplayName('Student_8821'),
    status: 'active',
    lastMessagePreview: '你好老师，我想咨询作业。',
    lastMessageAt: now - 3 * 60 * 1000,
    unreadCount: 2,
  };

  const sessionB = {
    id: generateSessionId(),
    peerRole: 'Student',
    peerName: '张三-CS',
    displayName: formatStudentDisplayName('张三-CS'),
    status: 'active',
    lastMessagePreview: '老师，我已提交实验报告。',
    lastMessageAt: now - 26 * 60 * 1000,
    unreadCount: 0,
  };

  return {
    version: STATE_VERSION,
    currentUser: {
      id: 'teacher_1',
      role: 'Teacher',
      displayName: '老师',
    },
    sessions: [sessionA, sessionB],
    messagesBySession: {
      [sessionA.id]: [],
      [sessionB.id]: [],
    },
  };
}

function normalizeState(state) {
  if (!state || typeof state !== 'object') return makeDefaultState();

  const currentUser =
    state.currentUser && typeof state.currentUser === 'object'
      ? state.currentUser
      : { id: 'teacher_1', role: 'Teacher', displayName: '老师' };

  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const messagesBySession =
    state.messagesBySession && typeof state.messagesBySession === 'object' ? state.messagesBySession : {};

  return {
    version: STATE_VERSION,
    currentUser,
    sessions,
    messagesBySession,
  };
}

let cachedState = null;

function bootstrapState() {
  const raw = safeGetStorageSync(STORAGE_KEY);
  const parsed = parseRawState(raw);
  const nextState = normalizeState(parsed || makeDefaultState());
  cachedState = nextState;
  safeSetStorageSync(STORAGE_KEY, nextState);
  return nextState;
}

function getState() {
  if (!cachedState) return bootstrapState();
  return cachedState;
}

function setState(nextState) {
  cachedState = normalizeState(nextState);
  safeSetStorageSync(STORAGE_KEY, cachedState);
  return cachedState;
}

function listSessions() {
  return getState().sessions || [];
}

function listActiveSessions() {
  return listSessions()
    .filter((session) => session?.status === 'active')
    .sort((a, b) => (b?.lastMessageAt || 0) - (a?.lastMessageAt || 0));
}

function getSessionById(sessionId) {
  if (!sessionId) return null;
  return listSessions().find((session) => session?.id === sessionId) || null;
}

function listMessages(sessionId) {
  if (!sessionId) return [];
  const state = getState();
  const list = state?.messagesBySession?.[sessionId];
  return Array.isArray(list) ? list : [];
}

function normalizeSender(sender) {
  return sender === 'peer' ? 'peer' : 'me';
}

function buildAttachmentPreview(kind, meta) {
  if (kind === 'image') return '[图片]';
  if (kind === 'file') {
    const name = meta?.name ? ` ${meta.name}` : '';
    return `[文件]${name}`;
  }
  return '[附件]';
}

function updateSessionById(sessions, sessionId, patch) {
  if (!sessionId) return sessions;
  if (!Array.isArray(sessions)) return sessions;

  const index = sessions.findIndex((session) => session?.id === sessionId);
  if (index < 0) return sessions;

  const prevSession = sessions[index];
  const nextSession = { ...prevSession, ...patch };
  const nextSessions = sessions.slice();
  nextSessions[index] = nextSession;
  return nextSessions;
}

function updateSessionPreview(sessionId, { lastMessagePreview, lastMessageAt }) {
  if (!sessionId) return null;

  const state = getState();
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];

  const patch = {};
  if (typeof lastMessagePreview === 'string') patch.lastMessagePreview = lastMessagePreview;
  if (typeof lastMessageAt === 'number') patch.lastMessageAt = lastMessageAt;

  const nextSessions = updateSessionById(sessions, sessionId, patch);
  if (nextSessions === sessions) return getSessionById(sessionId);

  setState({ ...state, sessions: nextSessions });
  return getSessionById(sessionId);
}

function addTextMessage(sessionId, text, sender = 'me') {
  const nextText = typeof text === 'string' ? text.trim() : '';
  if (!sessionId || !nextText) return null;

  const now = Date.now();
  const message = {
    id: generateMessageId(),
    sessionId,
    sender: normalizeSender(sender),
    type: 'text',
    text: nextText,
    createdAt: now,
  };

  const state = getState();
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const messagesBySession =
    state.messagesBySession && typeof state.messagesBySession === 'object' ? state.messagesBySession : {};

  const prevMessages = Array.isArray(messagesBySession[sessionId]) ? messagesBySession[sessionId] : [];
  const nextMessages = [...prevMessages, message];

  const nextState = {
    ...state,
    sessions: updateSessionById(sessions, sessionId, { lastMessagePreview: nextText, lastMessageAt: now }),
    messagesBySession: {
      ...messagesBySession,
      [sessionId]: nextMessages,
    },
  };

  setState(nextState);
  return message;
}

function addAttachmentMessage(sessionId, kind = 'image', meta = {}) {
  if (!sessionId) return null;

  const messageType = kind === 'file' ? 'file' : 'image';
  const safeMeta = meta && typeof meta === 'object' ? meta : {};
  const now = Date.now();

  const message = {
    id: generateMessageId(),
    sessionId,
    sender: 'me',
    type: messageType,
    meta: safeMeta,
    createdAt: now,
  };

  const state = getState();
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const messagesBySession =
    state.messagesBySession && typeof state.messagesBySession === 'object' ? state.messagesBySession : {};

  const prevMessages = Array.isArray(messagesBySession[sessionId]) ? messagesBySession[sessionId] : [];
  const nextMessages = [...prevMessages, message];

  const preview = buildAttachmentPreview(messageType, safeMeta);
  const nextState = {
    ...state,
    sessions: updateSessionById(sessions, sessionId, { lastMessagePreview: preview, lastMessageAt: now }),
    messagesBySession: {
      ...messagesBySession,
      [sessionId]: nextMessages,
    },
  };

  setState(nextState);
  return message;
}

function archiveSession(sessionId) {
  if (!sessionId) return null;
  const state = getState();
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const nextSessions = updateSessionById(sessions, sessionId, { status: 'archived' });
  if (nextSessions === sessions) return null;

  setState({ ...state, sessions: nextSessions });
  return getSessionById(sessionId);
}

function createSessionFromScan() {
  const peerName = `Student_${getRandomInt(1000, 9999)}`;
  const newSession = {
    id: generateSessionId(),
    peerRole: 'Student',
    peerName,
    displayName: formatStudentDisplayName(peerName),
    status: 'active',
    lastMessagePreview: '已建立会话',
    lastMessageAt: Date.now(),
    unreadCount: 0,
  };

  const state = getState();
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const messagesBySession =
    state.messagesBySession && typeof state.messagesBySession === 'object' ? state.messagesBySession : {};

  setState({
    ...state,
    sessions: [newSession, ...sessions],
    messagesBySession: {
      ...messagesBySession,
      [newSession.id]: [],
    },
  });

  return newSession;
}

module.exports = {
  STORAGE_KEY,
  addAttachmentMessage,
  addTextMessage,
  archiveSession,
  bootstrapState,
  createSessionFromScan,
  getSessionById,
  getState,
  listActiveSessions,
  listMessages,
  listSessions,
  setState,
  updateSessionPreview,
};
