# 12306余票全信息增强

> 安装：[GreasyFork](https://greasyfork.org/zh-CN/scripts/596275)（自动更新） · [GitHub 仓库](https://github.com/joelin818818/12306-yupiao-toushi)

在 12306 余票查询页增强展示：**车次局属、席位图鉴、票价折扣、车次等级与车型**。所有功能默认开启，无设置面板。

功能整合自 [galaxy-sea/12306-seat-viewer](https://github.com/galaxy-sea/12306-seat-viewer)；数据接口复用 12306 官方接口。

## 功能

| 功能 | 说明 | 数据来源 |
| --- | --- | --- |
| 车次局属 | 车次类型旁标注路局简称（如「南」「上」「广」） | 12306 官方接口 |
| 席位图鉴 | 悬停车次行，弹出各席别座位实拍图 | 12306 官方接口 |
| 票价 / 折扣 | 各席别余票格下方显示票价并标注折扣（如 `¥553 8.5`） | 12306 页面解析 |
| 车型列 | 历时后新增「车型」列：展示 12306 官方车型（如 `CR400BF-S`，蓝色）；无数据或请求中显示灰色 `—`（不展示按车次推断的等级分类） | 12306 官方接口 |

## 安装

- 安装油猴扩展（Tampermonkey / Violentmonkey）。
- **推荐**：在 [GreasyFork](https://greasyfork.org/zh-CN/scripts/596275) 安装，可自动更新。
- 或：直接安装本仓库 `dist/12306余票全信息增强.user.js`。
- 打开 [12306 余票查询页](https://kyfw.12306.cn/otn/leftTicket/init) 生效。

脚本仅向 `kyfw.12306.cn`（同域官方接口）发起请求，不上传任何个人数据。

## 更新

脚本通过 GitHub Webhook 与 GreasyFork 自动同步：每次 push 到 `main` 且 `src/meta.js` 的 `@version` 递增时，GreasyFork 上的脚本会自动更新，已安装用户随扩展检查周期获得新版本。

## 开发

```
src/
  meta.js    油猴脚本元数据头（@name / @match / @grant 等）
  api.js     12306 官方接口封装（局属 / 车型 / 席位图鉴）
  dom.js     DOM 选择 / 车次号解析 / 路局映射 / 城际车型推断
  ui.js      界面渲染：悬浮提示、徽标、票价角标、等级列
  main.js    主控：事件绑定、观察器、悬浮交互与编排
build.js    Node 构建脚本（无第三方依赖）
dist/       构建产物：可直接安装的 12306余票全信息增强.user.js
```

构建：

```bash
npm run build   # 等价于 node build.js
```


