Page({
  data: {
    chatMode: "model", // model 表示使用大模型
    showBotAvatar: true,
    modelConfig: {
      modelProvider: "qwen", // 阿里百炼
      quickResponseModel: "qwen3-max-preview",
      apiKey: "sk-87aeea8c209d4f7a8bb5a0f92f42a717",
      logo: "🤖",
      welcomeMsg: "你好！我是AI助手，有什么可以帮助你的吗？",
    },
  },

  onLoad(options) {},
  onReady() {},
  onShow() {},
  onHide() {},
  onUnload() {},
});
