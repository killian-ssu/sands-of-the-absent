# 沙海遗城 · Sands of the Absent

一段穿过沙漠遗迹的第三人称探索解谜旅程。提起提灯、放入聚光座、转动光镜，将光送到晶体；沿着沙路探索风蚀神庙、碑下旧城与峡谷绿洲。

**[直接试玩](https://killian-ssu.github.io/sands-of-the-absent/)**

建议使用电脑浏览器、键盘和鼠标游玩。首次打开需要下载场景素材，请等待加载完成。地图中的画面品质可切换为「流畅」。当前原型未适配手机触控。

| 操作 | 按键 |
| --- | --- |
| 行走 / 奔跑 | WASD / Shift |
| 跳跃 / 互动 | Space / E |
| 环顾 / 缩放 | 按住画面拖动 / 滚轮 |
| 地图、目标入口、画质与声音 | M |
| 摄影 / 保存画面 | P / C |

存档仅保存在当前浏览器，不需要账号。游戏本身不上传存档、录屏或调试记录。若迷路或卡住，可从地图选择「回到当前目标入口」。

## 本地运行

需要 Node.js 22 或更新版本。

```sh
npm ci
npm run build
npm start
```

打开终端提示的本地地址。`npm run check` 检查核心玩法和导航；`npm run build` 生成 `dist/`，可部署到静态网站。推送 `main` 后，GitHub Actions 将自动更新 GitHub Pages。

## 项目与素材

这是可试玩的视觉与探索解谜原型，基于 Three.js。场景包含水面倒影、沙尘、动态光路、角色动画与原创合成音效。

第三方模型、材质与程序库的来源和许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。角色素材随完整游戏交付，原作者为 Quaternius / Kay Lousberg；本仓库不是素材包。第三方内容不因仓库公开而改变许可。
