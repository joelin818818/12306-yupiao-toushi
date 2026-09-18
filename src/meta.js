// ==UserScript==
// @name         12306余票透视
// @name:zh-CN   12306余票透视
// @namespace    https://github.com/<your-github-owner>/12306-yupiao-toushi
// @version      1.0.0
// @description  在 12306 余票查询页增强展示：车次局属、席位图鉴、票价折扣、动车组型号。整合 galaxy-sea/12306-seat-viewer 与 Arnie97/moerail-tools 之精华，数据接口优先复用 12306 官方接口。
// @description:zh-CN  在 12306 余票查询页增强展示：车次局属、席位图鉴、票价折扣、动车组型号。整合 galaxy-sea/12306-seat-viewer 与 Arnie97/moerail-tools 之精华，数据接口优先复用 12306 官方接口。
// @author       <你的名字>
// @license      MIT
// @homepageURL  https://github.com/<your-github-owner>/12306-yupiao-toushi
// @supportURL   https://github.com/<your-github-owner>/12306-yupiao-toushi/issues
// @icon         https://www.12306.cn/index/images/logo.png
// @match        https://kyfw.12306.cn/otn/leftTicket/init*
// @match        https://kyfw.12306.cn/otn/leftTicketPrice/init*
// @match        https://kyfw.12306.cn/otn/leftTicketPrice/initPublicPrice*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      moerail.ml
// ==/UserScript==
