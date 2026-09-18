# 12306余票透视

> 在 12306 余票查询页增强展示：**车次局属、席位图鉴、票价折扣、动车组型号**。
> 整合 [galaxy-sea/12306-seat-viewer](https://github.com/galaxy-sea/12306-seat-viewer) 与 [Arnie97/moerail-tools](https://github.com/Arnie97/moerail-tools) 之精华，数据接口优先复用 12306 官方接口。

---

## ✨ 功能

| 功能 | 说明 | 数据来源 |
| --- | --- | --- |
| **车次局属** | 在车次类型旁标注路局简称（如「南」「上」「广」），避免花高铁的钱坐到体验差的局段 | 12306 官方接口 |
| **席位图鉴** | 鼠标悬停车次行，弹出该车次各席别的座位实拍图 | 12306 官方接口 |
| **票价 / 折扣** | 在各席别余票格下方显示票价，并标注折扣（如 `¥553 8.5`） | 12306 页面解析 |
| **动车组型号** | 标注车次动车组型号（复兴号/和谐号等），精确匹配车型可悬停查看车型图 | moerail.ml（第三方，可降级） |
| **确切余票数量** | 登录 12306 后，点击车次行「余票详情」查看各席别确切余票张数（实验性，默认关闭） | 12306 订单初始化接口（需登录） |

右下角「⚙」可逐项开关以上功能，设置通过 `GM_setValue` 本地保存。

---

## 🔗 致谢与开源声明

本项目在遵循各自许可证的前提下，整理并复用了以下优秀项目的逻辑与数据接口，特此致谢：

- **[galaxy-sea/12306-seat-viewer](https://github.com/galaxy-sea/12306-seat-viewer)**（作者：魏昌进 / wcj.plus，Apache-2.0）
  - 油猴脚本：[GreasyFork #584065](https://greasyfork.org/zh-CN/scripts/584065)
  - 复用：12306 官方接口（局属 / 车型 / 席位图鉴）封装、车次号 DOM 解析逻辑。
- **[Arnie97/moerail-tools](https://github.com/Arnie97/moerail-tools)**（作者：Arnie97，MIT）
  - 复用：动车组型号识别逻辑；车型数据源自 [moerail.ml](https://moerail.ml)（作者 Arnie97）。
  - 交路数据原始整理致谢：新浪微博用户 **「CRH380AL动车组」**。

> 设计取舍（去其糟粕、取其精华）：优先复用 12306 官方接口（无第三方依赖、最稳健）；
> 对 moerail.ml 等第三方数据做**本地缓存 + 失败静默降级**，即使服务不可用也不影响其它功能。
> 详见 [`NOTICE.md`](./NOTICE.md) 与 [`LICENSE`](./LICENSE)。

---

## 📦 安装

1. 安装浏览器扩展：[Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey）。
2. 获取脚本：
   - **方式一（推荐，始终最新）**：安装 `dist/12306余票透视.user.js`。
   - **方式二（GreasyFork，待发布）**：发布后从 GreasyFork 安装。
3. 打开 [12306 余票查询页](https://kyfw.12306.cn/otn/leftTicket/init) 即可生效。

> 脚本仅向 `kyfw.12306.cn`（同域官方接口）与 `moerail.ml`（车型数据）发起请求，不收集、不上传任何个人数据。

---

## 🛠 开发

源码以模块化方式组织，便于维护与二次开发：

```
src/
  meta.js    油猴脚本元数据头（@name / @match / @grant 等）
  config.js  功能开关与本地持久化（GM_setValue / GM_getValue）
  api.js     12306 官方接口封装（局属 / 车型 / 席位图鉴）*
  emu.js     动车组型号识别（复用 moerail-tools 逻辑，带降级）*
  dom.js     DOM 选择 / 车次号解析 / 路局映射*
  ui.js      界面渲染：悬浮提示、徽标、票价角标、设置面板
  main.js    主控：事件绑定、观察器、悬浮交互与编排
build.js    Node 构建脚本（无第三方依赖）
dist/       构建产物：可直接安装的 12306余票透视.user.js
```

> 标 `*` 的模块其逻辑/接口复用自上述开源项目，版权归原作者所有。

构建：

```bash
npm run build   # 等价于 node build.js
```

---

## 📄 许可证

本项目以 **MIT** 许可证发布；复用的第三方代码遵循其原许可证（galaxy-sea 为 Apache-2.0，Arnie97 为 MIT）。
详见 [`LICENSE`](./LICENSE) 与 [`NOTICE.md`](./NOTICE.md)。
