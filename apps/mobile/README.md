# Spanish mobile client

Flutter 客户端与 Next.js Web 共享产品信息架构和服务端契约，但不共享 UI 源码。

## 固定工具链

- Flutter `3.47.1`
- Dart `3.13.1`

本机可以通过 FVM 读取 `.fvmrc`，也可以直接使用相同版本的 Flutter SDK。当前 Windows 开发环境使用：

```powershell
D:\tools\flutter-3.47.1\flutter\bin\flutter.bat analyze
D:\tools\flutter-3.47.1\flutter\bin\flutter.bat test
```

## 当前范围

- 学习、探索、对话、我的四栏壳层。
- 手机使用底部导航，宽屏使用侧边导航。
- 静态学习首页与加载、空、失败、离线状态组件。
- 平台能力内部接口和测试 fake，不接真实插件。
- 已生成 iOS、Android、Windows、macOS 平台目录。

Windows 上的静态分析和 Widget 测试通过不代表 iOS 已完成 Xcode 编译、签名或真机验证。
