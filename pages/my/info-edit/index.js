import { areaList } from './areaData.js';

const api = require('../../../utils/linkbridge/api');

Page({
  data: {
    personInfo: {
      name: '',
      gender: 2,
      birth: '',
      address: [],
      introduction: '',
      photos: [],
    },
    genderOptions: [
      { label: '男', value: 0 },
      { label: '女', value: 1 },
      { label: '保密', value: 2 },
    ],
    birthVisible: false,
    birthStart: '1970-01-01',
    birthEnd: '2026-12-31',
    birthFilter: (type, options) => (type === 'year' ? options.sort((a, b) => b.value - a.value) : options),
    addressText: '',
    addressVisible: false,
    provinces: [],
    cities: [],
    gridConfig: {
      column: 3,
      width: 160,
      height: 160,
    },
  },

  onLoad() {
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    this.initAreaData();
    this.loadMe();
  },

  loadMe() {
    api
      .getMe()
      .then((me) => {
        const name = me?.displayName || '';
        this.setData({ 'personInfo.name': name });
      })
      .catch(() => null);
  },

  getAreaOptions(data, filter) {
    const res = Object.keys(data).map((key) => ({ value: key, label: data[key] }));
    return typeof filter === 'function' ? res.filter(filter) : res;
  },

  getCities(provinceValue) {
    return this.getAreaOptions(areaList.cities, (city) => `${city.value}`.slice(0, 2) === `${provinceValue}`.slice(0, 2));
  },

  initAreaData() {
    const provinces = this.getAreaOptions(areaList.provinces);
    const cities = provinces.length ? this.getCities(provinces[0].value) : [];
    this.setData({ provinces, cities });
  },

  onAreaPick(e) {
    const { column, index } = e.detail;
    const { provinces } = this.data;
    if (column === 0 && provinces[index]) {
      const cities = this.getCities(provinces[index].value);
      this.setData({ cities });
    }
  },

  showPicker(e) {
    const { mode } = e.currentTarget.dataset;
    this.setData({ [`${mode}Visible`]: true });

    if (mode === 'address') {
      const provinceValue = this.data.personInfo.address?.[0] || (this.data.provinces?.[0]?.value || '');
      const cities = provinceValue ? this.getCities(provinceValue) : [];
      this.setData({ cities });
    }
  },

  hidePicker(e) {
    const { mode } = e.currentTarget.dataset;
    this.setData({ [`${mode}Visible`]: false });
  },

  onPickerChange(e) {
    const { value, label } = e.detail;
    const { mode } = e.currentTarget.dataset;
    this.setData({ [`personInfo.${mode}`]: value });
    if (mode === 'address') {
      this.setData({ addressText: (label || []).join(' ') });
    }
  },

  personInfoFieldChange(field, e) {
    const { value } = e.detail;
    this.setData({ [`personInfo.${field}`]: value });
  },

  onNameChange(e) {
    this.personInfoFieldChange('name', e);
  },

  onGenderChange(e) {
    this.personInfoFieldChange('gender', e);
  },

  onIntroductionChange(e) {
    this.personInfoFieldChange('introduction', e);
  },

  onPhotosRemove(e) {
    const { index } = e.detail;
    const { photos } = this.data.personInfo;
    photos.splice(index, 1);
    this.setData({ 'personInfo.photos': photos });
  },

  onPhotosSuccess(e) {
    const { files } = e.detail;
    this.setData({ 'personInfo.photos': files });
  },

  onPhotosDrop(e) {
    const { files } = e.detail;
    this.setData({ 'personInfo.photos': files });
  },

  onSaveInfo() {
    const displayName = (this.data.personInfo.name || '').trim();
    if (!displayName) {
      wx.showToast({ title: '请输入显示名称', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...' });
    api
      .updateDisplayName(displayName)
      .then((user) => {
        api.setUser(user);
        wx.hideLoading();
        wx.showToast({ title: '已保存', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 300);
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err?.message || '保存失败', icon: 'none' });
      });
  },
});

