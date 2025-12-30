const api = require('../../../utils/linkbridge/api');

const usernameRegex = /^[a-zA-Z0-9_]{4,20}$/;

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
    const username = e.detail.value || '';
    let usernameTip = '';
    if (username && !usernameRegex.test(username)) {
      usernameTip = '用户名需4-20位字母数字下划线';
    }
    this.setData({ username, usernameTip, errorMessage: '' });
    this.updateCanSubmit();
  },

  onDisplayNameChange(e) {
    const displayName = e.detail.value || '';
    this.setData({ displayName, errorMessage: '' });
    this.updateCanSubmit();
  },

  onPasswordChange(e) {
    const password = e.detail.value || '';
    const strength = this.calculatePasswordStrength(password);
    this.setData({
      password,
      passwordStrength: strength.level,
      passwordStrengthText: strength.text,
      errorMessage: '',
    });
    this.updateCanSubmit();
  },

  onConfirmPasswordChange(e) {
    const confirmPassword = e.detail.value || '';
    this.setData({ confirmPassword, errorMessage: '' });
    this.updateCanSubmit();
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

  updateCanSubmit() {
    const { username, displayName, password, confirmPassword } = this.data;
    const canSubmit =
      usernameRegex.test(username) &&
      displayName.trim().length >= 1 &&
      displayName.trim().length <= 20 &&
      password.length >= 8 &&
      password.length <= 32 &&
      password === confirmPassword;
    this.setData({ canSubmit });
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
