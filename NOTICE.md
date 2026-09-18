# 第三方署名与致谢（NOTICE）

本项目（**12306余票透视**）在遵循各自许可证的前提下，整理并复用了以下开源项目的逻辑与数据接口，特此致谢原作者：

| 项目 | 作者 | 许可 | 链接 | 复用内容 |
| --- | --- | --- | --- | --- |
| 12306-seat-viewer | 魏昌进 (ChangJin Wei / wcj.plus) | Apache-2.0 | [GitHub](https://github.com/galaxy-sea/12306-seat-viewer) · [GreasyFork](https://greasyfork.org/zh-CN/scripts/584065) | 12306 官方接口（局属/车型/席位图鉴）封装与车次号 DOM 解析逻辑 |
| moerail-tools | Arnie97 | MIT | [GitHub](https://github.com/Arnie97/moerail-tools) | 动车组型号识别逻辑；车型数据源自 [moerail.ml](https://moerail.ml) |

特别致谢：动车组交路数据最初由新浪微博用户 **「CRH380AL动车组」** 长期整理，详见 moerail-tools 仓库说明。

> 本项目的集成思路为「去其糟粕、取其精华」：优先复用 12306 官方接口（无第三方依赖、最稳健），
> 对 moerail.ml 等第三方数据做本地缓存与失败静默降级处理，避免单点故障影响整体功能。
