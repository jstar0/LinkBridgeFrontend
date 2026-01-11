export const checkConfig = (chatMode, agentConfig, modelConfig) => {
  const { botId } = agentConfig || {};
  const { modelProvider, quickResponseModel, deepReasoningModel } = modelConfig || {};
  // 检测不在微信环境，提示用户
  const appBaseInfo = typeof wx?.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : { host: { env: '' }, SDKVersion: '0.0.0' };
  const hostEnv = String(appBaseInfo?.host?.env || '').toLowerCase();
  // DevTools / non-WeChat host:
  // Allow AI to run in DevTools for debugging; real device is still recommended for production behavior.
  if (hostEnv === 'sdk') {
    // Do not block; just allow execution.
  }
  // WeCom (企业微信) host.
  if (hostEnv === 'wxwork' || hostEnv === 'wechatwork') {
    return [false, '请前往微信客户端扫码打开小程序'];
  }

  // 检测AI能力，不存在提示用户
  // NOTE: we intentionally require >= 3.8.1 to avoid using direct `wx.request` in this component.
  if (compareVersions(appBaseInfo.SDKVersion, "3.8.1") < 0) {
    return [false, "使用AI能力需基础库为3.8.1及以上，请升级基础库版本或微信客户端"];
  }
  if (!["bot", "model"].includes(chatMode)) {
    return [false, "chatMode 不正确，值应为“bot”或“model”"];
  }
  if (chatMode === "bot" && !botId) {
    return [false, "当前chatMode值为bot，请配置botId"];
  }
  if (chatMode === "model" && (!modelProvider || !quickResponseModel)) {
    return [false, "当前chatMode值为model，请配置modelProvider和quickResponseModel"];
  }
  return [true, ""];
};
// 随机选取三个问题
export function randomSelectInitquestion(question = [], num = 3) {
  if (question.length <= num) {
    return [...question];
  }
  const set = new Set();
  while (set.size < num) {
    const randomIndex = Math.floor(Math.random() * question.length);
    set.add(question[randomIndex]);
  }
  return Array.from(set);
}

export const getCloudInstance = (function () {
  let cloudInstance = null;
  let cloudInited = false;

  function ensureCloudInit() {
    if (cloudInited) return;
    if (!wx?.cloud || typeof wx.cloud.init !== "function") return;
    try {
      // DevTools requires explicit init before using `wx.cloud.extend.*` APIs.
      // Env can be selected in DevTools; keep it default here.
      wx.cloud.init({ traceUser: true });
      cloudInited = true;
    } catch (e) {
      // ignore; downstream calls will surface a clearer error if init truly failed.
    }
  }
  return async function (envShareConfig) {
    if (cloudInstance) {
      return cloudInstance;
    }
    // 如果开启了环境共享，走环境共享的ai实例
    if (envShareConfig && envShareConfig.resourceAppid && envShareConfig.resourceEnv) {
      let instance = new wx.cloud.Cloud({
        // 资源方 AppID
        resourceAppid: envShareConfig.resourceAppid,
        // 资源方环境 ID
        resourceEnv: envShareConfig.resourceEnv,
      });
      await instance.init();
      // 烦，环境共享时创建实例，没有把环境id挂在instance上，这里手动挂上去，如果你发现instance上有个env，那么这个insatnce就是环境共享的云开发实例
      instance.env = envShareConfig.resourceEnv;
      cloudInstance = instance;
      return cloudInstance;
    } else {
      ensureCloudInit();
      cloudInstance = wx.cloud;
      return cloudInstance;
    }
  };
})();

export const compareVersions = (version1, version2) => {
  const v1Parts = version1.split(".").map(Number);
  const v2Parts = version2.split(".").map(Number);
  const maxLength = Math.max(v1Parts.length, v2Parts.length);

  for (let i = 0; i < maxLength; i++) {
    const num1 = v1Parts[i] || 0;
    const num2 = v2Parts[i] || 0;

    if (num1 > num2) {
      return 1;
    } else if (num1 < num2) {
      return -1;
    }
  }
  return 0;
};

let isDomainWarn = false;

export const commonRequest = async (options) => {
  const cloudInstance = await getCloudInstance();
  const self = this;
  const ai = cloudInstance.extend.AI;
  return ai.request(options);
};

export const sleep = (timeout) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, timeout);
  });
};
