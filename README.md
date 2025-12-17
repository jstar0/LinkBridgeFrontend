# LinkBridge 微信小程序前端

基于 TDesign 组件库的即时通讯小程序。

## 项目结构

```
LinkBridge/
├── pages/linkbridge/          # 产品页面
│   ├── dashboard/             # 首页（消息列表）
│   ├── chat/                  # 聊天页
│   ├── archive/               # 历史归档
│   ├── search/                # 搜索
│   └── settings/              # 设置
├── components/linkbridge-tabbar/  # 自定义底部导航
├── utils/linkbridge/store.js      # 本地数据管理
├── miniprogram_npm/           # TDesign 组件库
└── pages/*/                   # TDesign Demo（参考用）
```

## 开发

1. 打开微信开发者工具
2. 导入本项目目录
3. 编译运行

## 技术栈

- 微信小程序
- TDesign Mini Program
- 本地 Storage 数据持久化
