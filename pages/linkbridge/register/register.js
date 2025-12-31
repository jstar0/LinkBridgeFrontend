const api = require('../../../utils/linkbridge/api');

const usernameRegex = /^[a-zA-Z0-9_]{4,20}$/;

function getInputValue(e) {
  if (!e) return '';
  if (e.detail && typeof e.detail.value === 'string') return e.detail.value;
  if (typeof e.detail === 'string') return e.detail;
  return '';
}

function computeCanSubmit(username, displayName, password, confirmPassword) {
  const u = username || '';
  const dn = (displayName || '').trim();
  const p = password || '';
  const cp = confirmPassword || '';
  return (
    usernameRegex.test(u) &&
    dn.length >= 1 &&
    dn.length <= 20 &&
    p.length >= 8 &&
    p.length <= 32 &&
    p === cp
  );
}

Page({
  data: {
    username: '',
    displayName: '',
    password: '',
    confirmPassword: '',
    showPassword: false,
    showConfirmPassword: false,
    loading: false,
    canSubmit: false,
    errorMessage: '',
    usernameTip: '',
    passwordStrength: 'weak',
    passwordStrengthText: '弱',
  },

  onGoBack() {
    wx.navigateBack();
  },

  onUsernameChange(e) {
    const username = getInputValue(e);
    let usernameTip = '';
    if (username && !usernameRegex.test(username)) {
      usernameTip = '用户名需4-20位字母数字下划线';
    }

    const { displayName, password, confirmPassword } = this.data;
    this.setData({
      username,
      usernameTip,
      errorMessage: '',
      canSubmit: computeCanSubmit(username, displayName, password, confirmPassword),
    });
  },

  onDisplayNameChange(e) {
    const displayName = getInputValue(e);
    const { username, password, confirmPassword } = this.data;
    this.setData({
      displayName,
      errorMessage: '',
      canSubmit: computeCanSubmit(username, displayName, password, confirmPassword),
    });
  },

  onPasswordChange(e) {
    const password = getInputValue(e);
    const strength = this.calculatePasswordStrength(password);
    const { username, displayName, confirmPassword } = this.data;
    this.setData({
      password,
      passwordStrength: strength.level,
      passwordStrengthText: strength.text,
      errorMessage: '',
      canSubmit: computeCanSubmit(username, displayName, password, confirmPassword),
    });
  },

  onConfirmPasswordChange(e) {
    const confirmPassword = getInputValue(e);
    const { username, displayName, password } = this.data;
    this.setData({
      confirmPassword,
      errorMessage: '',
      canSubmit: computeCanSubmit(username, displayName, password, confirmPassword),
    });
  },

  onTogglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  onToggleConfirmPassword() {
    this.setData({ showConfirmPassword: !this.data.showConfirmPassword });
  },

  calculatePasswordStrength(password) {
    if (!password || password.length < 8) {
      return { level: 'weak', text: '弱' };
    }

    let score = 0;
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    if (password.length >= 12) score++;

    if (score >= 4) return { level: 'strong', text: '强' };
    if (score >= 3) return { level: 'medium', text: '中' };
    return { level: 'weak', text: '弱' };
  },

  validateForm() {
    const { username, displayName, password, confirmPassword } = this.data;

    if (!usernameRegex.test(username)) {
      return '用户名需4-20位字母数字下划线';
    }

    const trimmedDisplayName = displayName.trim();
    if (trimmedDisplayName.length < 1 || trimmedDisplayName.length > 20) {
      return '显示名称需1-20个字符';
    }

    if (password.length < 8 || password.length > 32) {
      return '密码需8-32位';
    }

    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return '密码需包含大小写字母和数字';
    }

    if (password !== confirmPassword) {
      return '两次输入的密码不一致';
    }

    return null;
  },

  onTapRegister() {
    const { username, displayName, password, loading } = this.data;
    if (loading) return;

    const validationError = this.validateForm();
    if (validationError) {
      this.setData({ errorMessage: validationError });
      return;
    }

    this.setData({ loading: true, errorMessage: '' });

    api
      .register(username.trim(), password, displayName.trim())
      .then(() => {
        wx.reLaunch({ url: '/pages/linkbridge/dashboard/dashboard' });
      })
      .catch((err) => {
        let message = '注册失败';
        if (err.code === 'USERNAME_EXISTS') {
          message = '用户名已存在';
        } else if (err.code === 'VALIDATION_ERROR') {
          message = err.message || '输入格式错误';
        } else if (err.code === 'network') {
          message = '网络错误，请检查网络连接';
        } else if (err.message) {
          message = err.message;
        }
        this.setData({ errorMessage: message, loading: false });
      });
  },

  onTapLogin() {
    wx.navigateBack();
  },
});
