# LinkBridge 微信小程序前端

校园即时通讯系统前端，基于微信小程序和 TDesign 组件库开发。

## 功能特性

- 用户注册/登录
- 一对一实时聊天
- 文本/图片/文件消息
- WebSocket 实时消息推送
- 会话管理（归档/搜索）
- 用户搜索

## 项目结构

```
LinkBridge/
├── pages/linkbridge/          # 产品页面
│   ├── login/                 # 登录页
│   ├── register/              # 注册页
│   ├── dashboard/             # 首页（消息列表）
│   ├── chat/                  # 聊天页
│   ├── archive/               # 历史归档
│   ├── search/                # 搜索
│   └── settings/              # 设置
├── components/linkbridge-tabbar/  # 自定义底部导航
├── utils/linkbridge/api.js        # API 客户端（含 WebSocket）
├── miniprogram_npm/           # TDesign 组件库
└── pages/*/                   # TDesign Demo（参考用）
```

## 开发

1. 打开微信开发者工具
2. 导入本项目目录
3. 在"详情 > 本地设置"中勾选"不校验合法域名"
4. 确保后端服务运行在 `localhost:8080`
5. 编译运行

## 配置

修改 `utils/linkbridge/api.js` 中的服务器地址：

```javascript
const BASE_URL = 'http://localhost:8080';  // HTTP API
const WS_URL = 'ws://localhost:8080';      // WebSocket
```

## 技术栈

- 微信小程序
- TDesign Mini Program
- WebSocket 实时通信
- wx.uploadFile 文件上传

## 后端仓库

[LinkBridgeBackend](https://github.com/jstar0/LinkBridgeBackend)

## 许可证

MIT
