'use strict';
(function () {
// ==UserScript==
// @name         12306余票全信息增强：局属·车型车号·席位图鉴·票价折扣
// @namespace    https://github.com/joelin818818/12306-yupiao-toushi
// @version      1.2.7.3
// @description  12306 余票全信息增强：车次局属（路局，如成都局）、车型与车号（含和谐号/复兴号类别）、席位图鉴（右侧停靠浮窗、多图完整展示）、票价折扣；左侧信息面板 + Excel 式行高亮，数据接口复用 12306 官方。
// @author       LBCN
// @license      MIT
// @homepageURL  https://github.com/joelin818818/12306-yupiao-toushi
// @supportURL   https://github.com/joelin818818/12306-yupiao-toushi/issues
// @updateURL    https://update.greasyfork.org/scripts/596275/12306余票全信息增强.user.js
// @downloadURL  https://update.greasyfork.org/scripts/596275/12306余票全信息增强.user.js
// @icon         https://www.12306.cn/index/images/logo.png
// @match        https://kyfw.12306.cn/otn/leftTicket/init*
// @match        https://kyfw.12306.cn/otn/leftTicketPrice/init*
// @match        https://kyfw.12306.cn/otn/leftTicketPrice/initPublicPrice*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

// api.js — 12306 官方接口封装（局属 / 席位图鉴 / 车型）
// 数据接口复用自 galaxy-sea/12306-seat-viewer（Apache-2.0, 作者 魏昌进 / wcj.plus）。
// 接口均为 12306 官方开放接口，无需任何第三方服务，最为稳健。
const API = (() => {
  const metaCache = new Map();
  const metaRequests = new Map();
  const seatCache = new Map();
  const seatRequests = new Map();

  // 带超时的 fetch：防止个别请求挂起导致自动获取队列永久卡死
  function fetchWithTimeout(url, options = {}, timeout = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  }

  // 取页面查询日期，格式 YYYYMMDD
  function getRunningDay() {
    const raw = document.getElementById('train_date')?.value?.trim();
    if (!raw) return null;
    const m = raw.match(/\d{4}-\d{2}-\d{2}/);
    if (!m) return null;
    return m[0].replace(/-/g, '');
  }

  // 局属 + 车型：部门接口（信息最全，首选）
  async function fetchDeptMeta(trainCode) {
    const url =
      'https://kyfw.12306.cn/wxxcx/openplatform-inner/miniprogram/wifiapps/appFrontEnd/v2/lounge/open-smooth-common/qrCode/getDeptByTrainCode?trainCode=' +
      encodeURIComponent(trainCode) +
      '&reqType=form';
    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: '',
    });
    if (!resp.ok) throw new Error('dept request failed');
    const data = await resp.json();
    const d = data?.content?.data;
    return {
      bureauName: d?.bureauName || null,
      deptName: d?.deptName || null,
      carType: d?.carInfo?.carType || null,
      trainStyle: d?.carInfo?.trainStyle || null,
      perHourSpeed: d?.carInfo?.perHourSpeed ?? null,
    };
  }

  // 局属：大屏接口（部门接口失败时的兜底）
  async function fetchBureauMeta(bureauTrainCode) {
    const queryDate = getRunningDay();
    const url =
      'https://kyfw.12306.cn/wxxcx/wechat/bigScreen/queryTrainBureau?queryDate=' +
      encodeURIComponent(queryDate) +
      '&trainCode=' +
      encodeURIComponent(bureauTrainCode);
    const resp = await fetchWithTimeout(url, { method: 'GET' });
    if (!resp.ok) throw new Error('bureau request failed');
    const data = await resp.json();
    return {
      bureauName: data?.data?.bureau_code_name || null,
      bureauCode: data?.data?.bureau_code || null,
    };
  }

  // 车型详情 + 席位图鉴 同源接口：响应 content.data 同时含 trainStyle/carType 与 coachDetailPicList。
  // 抽成单一 fetcher 并做内存 + 在途去重，避免「车型」与「席位图」两次重复请求同一 URL。
  const carDetailCache = new Map();
  const carDetailReqs = new Map();
  function getCarDetail(trainCode, runningDay) {
    if (!trainCode || !runningDay) return Promise.resolve(null);
    const key = runningDay + '|' + trainCode;
    if (carDetailCache.has(key)) return Promise.resolve(carDetailCache.get(key));
    if (carDetailReqs.has(key)) return carDetailReqs.get(key);
    const url =
      'https://kyfw.12306.cn/wxxcx/openplatform-inner/miniprogram/wifiapps/appFrontEnd/v2/lounge/open-smooth-common/trainStyleBatch/getCarDetail?carCode=&trainCode=' +
      encodeURIComponent(trainCode) +
      '&runningDay=' +
      encodeURIComponent(runningDay) +
      '&reqType=form';
    const req = fetchWithTimeout(url, { method: 'GET' })
      .then(async (resp) => {
        if (!resp.ok) throw new Error('car detail request failed');
        const data = await resp.json();
        return data?.content?.data || null;
      })
      .catch(() => null)
      .finally(() => carDetailReqs.delete(key));
    carDetailReqs.set(key, req);
    req.then((d) => carDetailCache.set(key, d)).catch(() => {}); // 失败也缓存 null，避免反复重试
    return req;
  }

  // 车型详情：从共享 getCarDetail 取 trainStyle/carType（部门接口失败时兜底）
  async function fetchCarDetailMeta(trainCode, runningDay) {
    const d = await getCarDetail(trainCode, runningDay);
    if (!d) return null;
    return {
      carType: d.carType || null,
      trainStyle: d.trainStyle || null,
      perHourSpeed: null,
    };
  }

  // —— 持久化缓存（localStorage）：按 日期|车次 存，跨查询/刷新复用，免去重复网络请求 ——
  const META_TTL = 7 * 24 * 3600 * 1000; // 7 天
  const META_PREFIX = 'sv_meta_v1_';
  function metaPersistentKey(date, code) {
    return META_PREFIX + date + '|' + code;
  }
  function readStoredMeta(trainCode) {
    const date = getRunningDay();
    if (!date || !trainCode) return null;
    try {
      const raw = localStorage.getItem(metaPersistentKey(date, trainCode));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj.ts !== 'number') return null;
      if (Date.now() - obj.ts > META_TTL) return null;
      return obj.meta || null;
    } catch (e) {
      return null;
    }
  }
  function writeStoredMeta(trainCode, meta) {
    if (!meta) return;
    const date = getRunningDay();
    if (!date || !trainCode) return;
    try {
      localStorage.setItem(metaPersistentKey(date, trainCode), JSON.stringify({ ts: Date.now(), meta }));
    } catch (e) {
      /* 容量超限忽略 */
    }
  }

  function fetchTrainMeta(trainCode, rawTrainCode) {
    if (!trainCode) return Promise.resolve(null);
    const queryDate = getRunningDay();
    if (!queryDate) return Promise.resolve(null);
    const bureauTrainCode = rawTrainCode || trainCode;
    const key = queryDate + '|' + trainCode;
    if (metaCache.has(key)) return Promise.resolve(metaCache.get(key));
    if (metaRequests.has(key)) return metaRequests.get(key);

    // 部门接口与车型详情接口并行：两者都能给出 trainStyle/carType，合并去重；
    // 局属若仍缺失，再补大屏接口。并行相比原串行三连显著缩短首查延迟。
    const request = (async () => {
      const [dept, detail] = await Promise.all([
        fetchDeptMeta(trainCode).catch(() => null),
        fetchCarDetailMeta(trainCode, queryDate).catch(() => null),
      ]);
      const meta = {};
      if (dept) {
        meta.bureauName = dept.bureauName || null;
        meta.deptName = dept.deptName || null;
        meta.carType = dept.carType || null;
        meta.trainStyle = dept.trainStyle || null;
        meta.perHourSpeed = dept.perHourSpeed ?? null;
      }
      if (detail) {
        meta.carType = meta.carType || detail.carType || null;
        meta.trainStyle = meta.trainStyle || detail.trainStyle || null;
        meta.perHourSpeed = meta.perHourSpeed ?? detail.perHourSpeed ?? null;
      }
      if (!meta.bureauName) {
        try {
          const b = await fetchBureauMeta(bureauTrainCode);
          meta.bureauName = meta.bureauName || b.bureauName || null;
          meta.bureauCode = b.bureauCode || null;
        } catch (e) {
          /* 忽略 */
        }
      }
      writeStoredMeta(trainCode, meta);
      metaCache.set(key, meta);
      return meta;
    })().finally(() => metaRequests.delete(key));

    metaRequests.set(key, request);
    return request;
  }

  // 席位图鉴：复用共享 getCarDetail 的同一响应（同一次请求已含 coachDetailPicList）
  function fetchSeatPics(trainCode, runningDay) {
    if (!trainCode || !runningDay) return Promise.resolve(null);
    const key = trainCode + '|' + runningDay;
    if (seatCache.has(key)) return Promise.resolve(seatCache.get(key));
    if (seatRequests.has(key)) return seatRequests.get(key);
    const request = getCarDetail(trainCode, runningDay).then((d) => {
      const pics = d?.coachDetailPicList || null;
      seatCache.set(key, pics);
      return pics;
    });
    seatRequests.set(key, request);
    return request;
  }

  return { getRunningDay, fetchTrainMeta, fetchSeatPics, readStoredMeta };
})();

// dom.js — DOM 选择 / 车次号解析（复用 galaxy-sea/12306-seat-viewer 逻辑）
const DOM = (() => {
  function getTrainAnchor(tr) {
    return (
      tr.querySelector('[id^="train_num_"] > div.train > div > a') ||
      tr.querySelector('.train > div > a')
    );
  }

  function getRawTrainCode(tr) {
    const a = getTrainAnchor(tr);
    return a?.textContent?.trim() || '';
  }

  // 车次号可能藏在 onclick 的 open(...) 编码串里，需解析
  function getTrainCode(tr) {
    const anchor = getTrainAnchor(tr);
    if (!anchor) return '';
    const rawText = getRawTrainCode(tr);
    const onclick = anchor.getAttribute('onclick') || '';
    if (!onclick || onclick.includes(rawText)) return rawText;

    // onclick 形如 myStopStation.open('58','5e0000G4420G','NGH','HGH','20251126','3');
    const m = onclick.match(/open\(\s*'[^']*'\s*,\s*'([^']*)'/);
    const encoded = m?.[1];
    if (!encoded || encoded.length < 3) return rawText;

    const withoutTail = encoded.slice(0, -2); // 去掉末尾随机两字符
    for (let i = withoutTail.length - 1; i >= 0; i -= 1) {
      if (/[A-Za-z]/.test(withoutTail[i])) {
        return withoutTail.slice(i);
      }
    }
    return rawText;
  }

  function findRows(tbody) {
    return Array.from(tbody.querySelectorAll('tr')).filter((tr) => {
      if (tr.id?.startsWith('price_')) return false;
      const hasCells = tr.querySelectorAll('td').length > 0;
      const text = tr.innerText.trim();
      return hasCells && text.length > 0;
    });
  }

  // 席别单元格 id 前缀（用于城际车型推断）
  function getCoachClassId(tr) {
    const tds = tr.querySelectorAll('td');
    for (const td of tds) {
      const id = td.id || '';
      if (/^(SWZ|TZ)_/.test(id)) return id;
    }
    return null;
  }

  // 城际列车（天津 C2x）按席别推断车型
  function getIntercityModel(code, coachClassId) {
    if (/^C2[0-6]/.test(code)) {
      if (coachClassId && /^SWZ_/.test(coachClassId)) return 'CR400AF/BF型';
      if (coachClassId && /^TZ_/.test(coachClassId)) return 'CRH3C型';
    }
    return null;
  }

  // 18 个路局的完整城市名（徽标展示用）
  const BUREAU_CITY = [
    '哈尔滨', '沈阳', '北京', '呼和浩特', '太原', '上海', '济南',
    '南昌', '广州', '南宁', '武汉', '郑州', '成都', '昆明',
    '青藏', '兰州', '乌鲁木齐', '西安',
  ];
  // 从 API 返回的原始路局名（如「中国铁路北京局集团有限公司」）提取完整城市名
  function bureauCityName(raw) {
    if (!raw) return null;
    for (const c of BUREAU_CITY) if (raw.indexOf(c) !== -1) return c;
    return raw; // 兜底：未知格式时直接展示原值
  }

  // 面板展示用的短标签：城市名 + 「局」（如 成都局）；无法识别时退回原值
  function bureauShortLabel(raw) {
    if (!raw) return null;
    const city = bureauCityName(raw);
    return BUREAU_CITY.indexOf(city) !== -1 ? `${city}局` : city;
  }

  // 车次等级（普速按车次首字母推断；动车组由 main 结合车型数据显示）
  const trainClassMap = {
    G: '高速', D: '动车', C: '城际', Z: '直特', T: '特快',
    K: '快速', Y: '旅游', L: '临客', S: '市郊',
  };
  function getTrainClass(code) {
    if (!code) return '';
    const first = code[0].toUpperCase();
    if (trainClassMap[first]) return trainClassMap[first];
    if (/[0-9]/.test(first)) return code.length >= 4 ? '普快' : '普客';
    return '';
  }

  // 车次号所在单元格（用于在其后插入「等级」列）
  function getTrainCell(tr) {
    const anchor = getTrainAnchor(tr);
    if (anchor) {
      const td = anchor.closest('td');
      if (td) return td;
    }
    return Array.from(tr.querySelectorAll('td')).find((c) => c.id?.startsWith('train_num_')) || null;
  }

  return {
    getTrainAnchor, getRawTrainCode, getTrainCode, findRows, getCoachClassId,
    bureauCityName, bureauShortLabel, getTrainClass, getTrainCell, getIntercityModel,
  };
})();

// ui.js — 界面渲染：悬浮提示、左侧车次信息面板（局属+车型）、票价角标
const UI = (() => {
  const SEAT_PIC_PREFIX = 'https://wifi.12306.cn/resourcecenter/cateringimages/';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function addStyles() {
    GM_addStyle(`
.seat-viewer-tooltip {
  position: fixed;
  z-index: 2147483647;
  max-width: 1080px;
  width: fit-content;
  padding: 10px 12px;
  background: rgba(15, 23, 42, 0.92);
  color: #f8fafc;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  font-family: "Segoe UI", "PingFang SC", sans-serif;
  font-size: 13px;
  line-height: 1.5;
  pointer-events: none;
  transition: opacity 120ms ease;
}
.sv-meta { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 6px; align-items: center; }
.sv-meta-item { white-space: nowrap; }
.sv-seats { display: grid; grid-template-columns: repeat(3, minmax(288px, 1fr)); gap: 8px; margin-top: 4px; align-items: start; }
.sv-seats.cols-1 { grid-template-columns: repeat(1, minmax(288px, 1fr)); max-width: 336px; }
.sv-seats.cols-2 { grid-template-columns: repeat(2, minmax(288px, 1fr)); max-width: 672px; }
.sv-seats.cols-3 { grid-template-columns: repeat(3, minmax(288px, 1fr)); max-width: 1008px; }
.sv-seat { margin: 0; text-align: center; color: #e2e8f0; font-size: 12px; }
.sv-seat img { width: 100%; max-height: 288px; object-fit: contain; border-radius: 8px; background: #0f172a; }
.sv-price { margin-top: 2px; color: #fb7403; font-size: 12px; font-weight: 400; line-height: 1.2; white-space: nowrap; }
/* 右侧停靠模式：固定宽度（不随图片加载抖动）；不限高、不内部滚动，多张图一次性完整展示 */
.seat-viewer-tooltip.sv-dock {
  width: 320px;
  max-width: 320px;
  box-sizing: border-box;
  padding: 8px 10px;
}
.sv-dock .sv-seats { grid-template-columns: minmax(0, 1fr) !important; max-width: none !important; gap: 6px !important; }
.sv-dock .sv-seat img { display: block; } /* 不强制宽高比：按图片原生比例显示，避免 object-fit 留黑边 */
.sv-dock .sv-seat figcaption { font-size: 11px; line-height: 1.4; margin-top: 2px; }
.sv-dock .sv-seat figcaption { font-size: 11px; }
/* 左侧车次信息面板：与官方表格结构完全解耦，绝不影响官方布局 */
/* 经停弹窗打开期间官方样式会给页面文本挂下划线，面板/悬浮窗文字强制去除（分隔线在 .sv-side-row 上，不受影响） */
.sv-side-panel, .sv-side-panel div, .seat-viewer-tooltip, .seat-viewer-tooltip div {
  text-decoration: none !important;
}
.sv-side-bureau, .sv-side-model { border-bottom: none !important; }
.sv-side-panel { position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 50; pointer-events: none; }
.sv-side-row {
  position: absolute;
  pointer-events: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 2px 6px;
  font-family: "Segoe UI", "PingFang SC", sans-serif;
  font-size: 11px;
  line-height: 14px;
  border-right: 2px solid #cbd5e1;
  border-bottom: 1px solid #dbe3ec;
  cursor: pointer;
  color: #334155;
}
.sv-side-row:last-child { border-bottom: none; }
.sv-side-row:hover, .sv-side-row.sv-active { background: #eff6ff; }
/* 官方表格行悬停淡蓝底色（Excel 式行高亮，方便左右对照） */
#queryLeftTable tr[id^="ticket_"]:hover td { background-color: #f0f7ff !important; }
.sv-side-bureau, .sv-side-model { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sv-side-bureau { color: #7c3aed; }
.sv-side-model { color: #0ea5e9; }
.sv-side-row .sv-empty { color: #94a3b8; }
`);
  }

  // —— 浮窗停靠开关（恢复预案）——
  // true  = 停靠页面右侧空白、竖向排列（当前默认）；
  // false = 恢复原「页面居中悬浮」样式，仅需改这一个值，其余逻辑完全复用。
  const DOCK_TOOLTIP_RIGHT = true;

  function createTooltip() {
    const tip = document.createElement('div');
    tip.className = 'seat-viewer-tooltip';
    if (DOCK_TOOLTIP_RIGHT) tip.classList.add('sv-dock');
    tip.style.display = 'none';
    document.body.appendChild(tip);
    return tip;
  }

  function renderTooltip(trainCode, meta, seatPics) {
    const safeTrain = escapeHtml(trainCode);
    const metaParts = [
      `<span class="sv-meta-item"><strong>车次:</strong> ${safeTrain}</span>`,
    ];
    // 车型：trainStyle 为具体型号（CRH380BL），carType 为类别（和谐号/复兴号）
    const modelText = [meta?.trainStyle, meta?.carType].filter(Boolean).join(' ');
    if (modelText) {
      metaParts.push(`<span class="sv-meta-item" style="color:#38bdf8;"><strong>车型:</strong> ${escapeHtml(modelText)}</span>`);
    }
    if (meta?.bureauName || meta?.deptName) {
      const bureauText = [meta.bureauName, meta.deptName].filter(Boolean).join('-');
      metaParts.push(`<span class="sv-meta-item"><strong>局属:</strong> ${escapeHtml(bureauText)}</span>`);
    }
    if (meta?.perHourSpeed) {
      metaParts.push(`<span class="sv-meta-item"><strong>时速:</strong> ${escapeHtml(meta.perHourSpeed)} </span>`);
    }

    const parts = [`<div class="sv-meta">${metaParts.join('')}</div>`];

    if (seatPics && seatPics.length) {
      const cols = Math.min(3, seatPics.length);
      const images = seatPics
        .slice()
        .sort((a, b) => (a?.picOrder || 0) - (b?.picOrder || 0))
        .map((pic) => {
          const url = pic?.pictureUrl?.startsWith('http')
            ? pic.pictureUrl
            : `${SEAT_PIC_PREFIX}${pic?.pictureUrl || ''}`;
          const rawName = pic?.pictureName || '座位';
          const name = escapeHtml((rawName.split('#')[0] || rawName));
          return `<figure class="sv-seat"><img src="${escapeHtml(url)}" alt="${name}"><figcaption>${name}</figcaption></figure>`;
        })
        .join('');
      parts.push(`<div class="sv-seats cols-${cols}">${images}</div>`);
    }

    return parts.join('');
  }

  /* ===== 左侧车次信息面板 =====
     独立浮动列表，逐行对齐右侧余票表的车次行；显示局属 + 车型，
     悬停显示与车次行相同的悬浮窗。官方表格 DOM 完全不动。 */
  const PANEL_GAP = 8;
  const PANEL_WIDTH = 118;
  const rowEls = new Map(); // tr -> panel row element
  let panelEl = null;
  let panelHandlers = null;

  function setSidePanelHandlers(handlers) {
    panelHandlers = handlers;
  }

  function ensureSidePanel() {
    if (!panelEl || !panelEl.isConnected) {
      if (panelEl) panelEl.remove();
      panelEl = document.createElement('div');
      panelEl.className = 'sv-side-panel';
      document.body.appendChild(panelEl);
    }
    return panelEl;
  }

  function createSideRow(tr) {
    const el = document.createElement('div');
    el.className = 'sv-side-row';
    el.dataset.svPanel = '1';
    // 无数据的行整行隐藏，避免出现空白占位横线；拿到数据后才显示
    el.style.visibility = 'hidden';
    const bureau = document.createElement('div');
    bureau.className = 'sv-side-bureau sv-empty';
    bureau.textContent = '—';
    const model = document.createElement('div');
    model.className = 'sv-side-model sv-empty';
    model.textContent = '—';
    el.appendChild(bureau);
    el.appendChild(model);
    el.addEventListener('mouseenter', (e) => panelHandlers?.onEnter?.(tr, e.clientY));
    el.addEventListener('mouseleave', () => panelHandlers?.onLeave?.());
    return el;
  }

  // 行对齐：面板行 top/height 直接取对应 tr 的文档坐标，滚动/行高变化都准确
  function syncSidePanel(rows) {
    if (!rows.length) {
      rowEls.forEach((el) => el.remove());
      rowEls.clear();
      return;
    }
    const panel = ensureSidePanel();
    const firstRect = rows[0].getBoundingClientRect();
    const left = Math.max(2, firstRect.left + window.scrollX - PANEL_WIDTH - PANEL_GAP);
    const alive = new Set();
    rows.forEach((tr) => {
      let el = rowEls.get(tr);
      if (!el) {
        el = createSideRow(tr);
        rowEls.set(tr, el);
        panel.appendChild(el);
      }
      alive.add(el);
      const r = tr.getBoundingClientRect();
      const top = Math.round(r.top + window.scrollY);
      const height = Math.round(r.height);
      if (el.style.top !== `${top}px`) el.style.top = `${top}px`;
      if (el.style.height !== `${height}px`) el.style.height = `${height}px`;
      if (el.style.left !== `${left}px`) el.style.left = `${left}px`;
      if (el.style.width !== `${PANEL_WIDTH}px`) el.style.width = `${PANEL_WIDTH}px`;
    });
    rowEls.forEach((el, tr) => {
      if (!alive.has(el) || !tr.isConnected) {
        el.remove();
        rowEls.delete(tr);
      }
    });
  }

  // 悬停表格行时，左侧面板对应行同步高亮（传 null 清除）
  function highlightPanelRow(tr) {
    rowEls.forEach((el, key) => {
      el.classList.toggle('sv-active', key === tr);
    });
  }

  function updateSidePanelRow(tr, meta) {
    const el = rowEls.get(tr);
    if (!el) return;
    const bureau = el.querySelector('.sv-side-bureau');
    const model = el.querySelector('.sv-side-model');
    const bureauShort = meta?.bureauName ? DOM.bureauShortLabel(meta.bureauName) : null;
    if (bureauShort) {
      if (bureau.textContent !== bureauShort) bureau.textContent = bureauShort;
      bureau.title = meta.bureauName;
      bureau.classList.remove('sv-empty');
    } else {
      if (bureau.textContent !== '—') bureau.textContent = '—';
      bureau.title = '';
      bureau.classList.add('sv-empty');
    }
    // 与悬浮窗一致：型号 + 官方返回的中文类别（和谐号/复兴号），均来自已有 meta，无额外请求
    const modelText = [meta?.trainStyle, meta?.carType].filter(Boolean).join(' ') || null;
    if (modelText) {
      if (model.textContent !== modelText) model.textContent = modelText;
      model.title = `车型：${modelText}（12306 官方数据）`;
      model.classList.remove('sv-empty');
    } else {
      if (model.textContent !== '—') model.textContent = '—';
      model.title = '';
      model.classList.add('sv-empty');
    }
    // 至少有一项数据才显示该行，否则整行隐藏（避免空白占位横线）
    const visible = !!(bureauShort || modelText);
    if (el.style.visibility !== (visible ? 'visible' : 'hidden')) {
      el.style.visibility = visible ? 'visible' : 'hidden';
    }
  }

  // 票价 / 折扣角标
  const seatTypeMap = { SWZ: '9', ZY: 'M', ZE: 'O', WZ: 'W' };
  function getPriceFromTicketCell(cell) {
    const label = cell.getAttribute('aria-label') || '';
    const m = label.match(/票价\s*([0-9]+(?:\.[0-9]+)?)\s*元/);
    return m ? `¥${m[1]}` : '';
  }
  function getSeatTypeCode(cell) {
    const seatKey = cell.id?.split('_')[0] || '';
    return seatTypeMap[seatKey] || '';
  }
  function getDiscountMap(row) {
    const raw = row.getAttribute('seat_discount_info') || '';
    const discounts = new Map();
    raw.replace(/([A-Z0-9])(\d{4})/g, (_, seatTypeCode, discountCode) => {
      const v = Number(discountCode) / 10;
      if (v > 0) {
        discounts.set(seatTypeCode, Number.isInteger(v) ? `${v}` : v.toFixed(1));
      }
      return '';
    });
    return discounts;
  }
  function setPriceBadge(cell, priceText, discountText) {
    let badge = cell.querySelector(':scope > .sv-price');
    if (!priceText || !priceText.includes('¥')) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'sv-price';
      cell.appendChild(badge);
    }
    const html = discountText
      ? `${escapeHtml(priceText)} <span style="color:grey;">${escapeHtml(discountText)}</span>`
      : escapeHtml(priceText);
    if (badge.innerHTML !== html) badge.innerHTML = html;
  }
  function syncPrices(tbody) {
    tbody.querySelectorAll('tr[id^="ticket_"]').forEach((row) => {
      const discountMap = getDiscountMap(row);
      Array.from(row.children)
        .filter((c) => c.tagName === 'TD')
        .forEach((cell) => {
          setPriceBadge(cell, getPriceFromTicketCell(cell), discountMap.get(getSeatTypeCode(cell)) || '');
        });
    });
  }

  return {
    addStyles,
    createTooltip,
    renderTooltip,
    DOCK_TOOLTIP_RIGHT,
    setSidePanelHandlers,
    highlightPanelRow,
    syncSidePanel,
    updateSidePanelRow,
    syncPrices,
  };
})();

// main.js — 主控：事件绑定、观察器、悬浮交互与模块编排
// 所有功能默认开启（无设置面板）；车型取 12306 官方接口，按可视范围串行请求。
(() => {
  UI.addStyles();
  const tooltip = UI.createTooltip();

  let currentHover = null;
  let currentTooltipPoint = null;

  const metaCache = new Map();
  const seatCache = new Map();

  function getMetaCacheKey(trainCode) {
    const d = API.getRunningDay();
    return d && trainCode ? `${d}|${trainCode}` : null;
  }

  function renderRowTooltip(tr, meta, pics) {
    tooltip.innerHTML = UI.renderTooltip(DOM.getTrainCode(tr), meta, pics);
    scheduleTooltipPosition(tr);
  }

  // 官方数据里是否带具体车型
  function hasModelMeta(meta) {
    return !!(meta && (meta.trainStyle || meta.carType));
  }

  // 是否需要（重新）拉取：无缓存 → 拉；有缓存但缺车型且该行重试未超限 → 重拉
  function shouldFetchMeta(tr, cached) {
    if (cached === undefined) return true;
    if (hasModelMeta(cached)) return false;
    const retries = Number(tr.dataset.svMetaRetry || 0);
    if (retries >= 2) return false;
    tr.dataset.svMetaRetry = String(retries + 1);
    return true;
  }

  // 官方未返回车型时安排一次自动重试（无悬停也刷新），每行最多 2 次
  function scheduleModelRetry(tr, meta) {
    if (hasModelMeta(meta)) return;
    if (Number(tr.dataset.svMetaRetry || 0) >= 2) return;
    if (!tr.isConnected) return;
    setTimeout(() => {
      if (tr.isConnected && !hasModelMeta(getCachedMeta(tr))) {
        delete tr.dataset.svQueued;
        applyVisibleBureauBadge(tr);
      }
    }, 3000);
  }

  function getCachedMeta(tr) {
    const key = getMetaCacheKey(DOM.getTrainCode(tr));
    return key && metaCache.has(key) ? metaCache.get(key) : undefined;
  }

  // 车次行与左侧面板行共用：显示悬浮窗、缓存命中即刷、按需请求
  function showRowInfo(tr, clientY) {
    currentHover = tr;
    currentTooltipPoint = { clientY };
    UI.highlightPanelRow(tr);

    const trainCode = DOM.getTrainCode(tr);
    const rawTrainCode = DOM.getRawTrainCode(tr);
    const runningDay = API.getRunningDay();

    const metaKey = getMetaCacheKey(trainCode);
    const metaCached = metaKey && metaCache.has(metaKey) ? metaCache.get(metaKey) : undefined;
    const seatKey = runningDay ? `${trainCode}|${runningDay}` : null;
    const seatCached = seatKey && seatCache.has(seatKey) ? seatCache.get(seatKey) : undefined;

    if (metaCached !== undefined) applyRowMeta(tr, metaCached);

    if (metaCached || seatCached) {
      tooltip.innerHTML = UI.renderTooltip(trainCode, metaCached || undefined, seatCached || undefined);
      tooltip.style.visibility = 'hidden';
      tooltip.style.display = 'block';
      scheduleTooltipPosition(tr);
    }

    if (shouldFetchMeta(tr, metaCached)) {
      if (metaKey) metaCache.delete(metaKey);
      API.fetchTrainMeta(trainCode, rawTrainCode).then((meta) => {
        if (metaKey) metaCache.set(metaKey, meta);
        applyRowMeta(tr, meta);
        scheduleModelRetry(tr, meta);
        if (currentHover === tr) {
          renderRowTooltip(tr, meta, seatKey ? seatCache.get(seatKey) || undefined : undefined);
        }
      });
    }

    if (runningDay && seatCached === undefined) {
      API.fetchSeatPics(trainCode, runningDay).then((pics) => {
        if (seatKey) seatCache.set(seatKey, pics);
        if (currentHover === tr) {
          const meta = metaKey && metaCache.has(metaKey) ? metaCache.get(metaKey) : undefined;
          renderRowTooltip(tr, meta || undefined, pics || undefined);
        }
      });
    }
  }

  function handleEnter(event) {
    showRowInfo(event.currentTarget, event.clientY);
  }

  function handleLeave() {
    tooltip.style.display = 'none';
    tooltip.style.visibility = 'hidden';
    currentHover = null;
    currentTooltipPoint = null;
    UI.highlightPanelRow(null);
  }

  function handleMove(event) {
    const tr = event.currentTarget;
    if (currentHover !== tr || tooltip.style.display !== 'block') return;
    currentTooltipPoint = { clientY: event.clientY };
    scheduleTooltipPosition(tr);
  }

  function setTooltipPosition(point) {
    const offsetY = 30;
    if (UI.DOCK_TOOLTIP_RIGHT) {
      // 停靠模式：水平贴视口右缘，垂直页面居中并夹在视口内（恢复原样式只需关掉该开关）
      const top = Math.max(
        8,
        (window.innerHeight - tooltip.offsetHeight) / 2
      );
      tooltip.style.left = `${window.innerWidth - tooltip.offsetWidth - 10}px`;
      tooltip.style.top = `${top}px`;
      return;
    }
    const maxLeft = window.innerWidth - tooltip.offsetWidth - 8;
    const maxTop = window.innerHeight - tooltip.offsetHeight - offsetY;
    const centeredLeft = (window.innerWidth - tooltip.offsetWidth) / 2;
    const left = Math.max(8, Math.min(maxLeft, centeredLeft));
    const belowTop = point.clientY + offsetY;
    const aboveTop = point.clientY - tooltip.offsetHeight - offsetY;
    const top = belowTop <= maxTop ? belowTop : Math.max(8, aboveTop);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function scheduleTooltipPosition(tr) {
    requestAnimationFrame(() => {
      if (currentHover !== tr || !currentTooltipPoint) return;
      setTooltipPosition(currentTooltipPoint);
      tooltip.style.visibility = 'visible';
    });
  }

  function bindRows(rows) {
    rows.forEach((tr) => {
      observeVisibleRow(tr);
      if (tr.dataset.svBound !== '1') {
        tr.dataset.svBound = '1';
        tr.addEventListener('mouseenter', handleEnter, { passive: true });
        tr.addEventListener('mouseleave', handleLeave, { passive: true });
        tr.addEventListener('mousemove', handleMove, { passive: true });
      }
    });
  }

  // 局属徽标 + 官方车型：进入视口才请求，省流量也避免高频
  function isNearViewport(el) {
    const margin = 120;
    const rect = el.getBoundingClientRect();
    return rect.bottom >= -margin && rect.top <= window.innerHeight + margin;
  }
  function observeVisibleRow(tr) {
    if (tr.dataset.svBureauObserved === '1') return;
    tr.dataset.svBureauObserved = '1';
    if (isNearViewport(tr)) {
      applyVisibleBureauBadge(tr);
      return;
    }
    if (!('IntersectionObserver' in window)) {
      applyVisibleBureauBadge(tr);
      return;
    }
    if (!observeVisibleRow.observer) {
      observeVisibleRow.observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            observeVisibleRow.observer.unobserve(entry.target);
            applyVisibleBureauBadge(entry.target);
          });
        },
        { root: null, rootMargin: '120px 0px', threshold: 0.01 }
      );
    }
    observeVisibleRow.observer.observe(tr);
  }
  // 串行队列：批量请求间隔 150ms，避免同时打出十几个请求被 12306 限流
  function createSerialQueue(gap) {
    let chain = Promise.resolve();
    return function enqueue(task) {
      const run = chain.then(() => task());
      chain = run.then(
        () => new Promise((resolve) => setTimeout(resolve, gap)),
        () => {}
      );
      return run;
    };
  }
  const enqueueMeta = createSerialQueue(150);

  function applyVisibleBureauBadge(tr) {
    const trainCode = DOM.getTrainCode(tr);
    const rawTrainCode = DOM.getRawTrainCode(tr);
    if (!trainCode) return;
    const key = getMetaCacheKey(trainCode);
    // 持久缓存命中且含车型：即时填蓝字、免请求（重复查询/刷新秒出）
    const stored = API.readStoredMeta(trainCode);
    if (stored && (stored.trainStyle || stored.carType)) {
      if (key) metaCache.set(key, stored);
      applyRowMeta(tr, stored);
      return;
    }
    const cached = key && metaCache.has(key) ? metaCache.get(key) : undefined;
    if (!shouldFetchMeta(tr, cached)) {
      applyRowMeta(tr, cached || null);
      return;
    }
    if (key) metaCache.delete(key); // 旧缓存缺车型，清掉重新拉
    tr.dataset.svQueued = '1';
    enqueueMeta(() => API.fetchTrainMeta(trainCode, rawTrainCode)).then((meta) => {
      delete tr.dataset.svQueued;
      if (key) metaCache.set(key, meta);
      applyRowMeta(tr, meta);
      scheduleModelRetry(tr, meta);
    }, () => {
      delete tr.dataset.svQueued;
    });
  }
  function applyRowMeta(tr, meta) {
    UI.updateSidePanelRow(tr, meta);
  }

  function init() {
    const dateInput = document.getElementById('train_date');
    const tbody = document.getElementById('queryLeftTable');
    if (!dateInput || !tbody) return;
    if (!dateInput.value?.trim()) return;

    UI.syncPrices(tbody);

    const rows = DOM.findRows(tbody);
    UI.syncSidePanel(rows);
    if (!rows.length) return;
    bindRows(rows);
    scanVisibleBureauRows();
  }

  function scanVisibleBureauRows() {
    const tbody = document.getElementById('queryLeftTable');
    if (!tbody) return;
    DOM.findRows(tbody).forEach((tr) => {
      if (!isNearViewport(tr)) return;
      // 官方车型已就绪或请求已在队列 → 无需处理
      if (hasModelMeta(getCachedMeta(tr))) return;
      if (tr.dataset.svQueued === '1') return;
      applyVisibleBureauBadge(tr);
    });
  }
  const scheduleVisibleBureauScan = (() => {
    let timer = null;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        scanVisibleBureauRows();
        timer = null;
      }, 80);
    };
  })();

  const scheduleInit = (() => {
    let timer = null;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        init();
        timer = null;
      }, 60);
    };
  })();

  function observeTable() {
    const tbody = document.getElementById('queryLeftTable');
    if (!tbody) return;
    if (observeTable.currentTbody === tbody) return;
    if (observeTable.observer && observeTable.currentTbody) {
      observeTable.observer.disconnect();
    }
    if (observeVisibleRow.observer) {
      observeVisibleRow.observer.disconnect();
      observeVisibleRow.observer = null;
    }
    observeTable.currentTbody = tbody;
    observeTable.observer = new MutationObserver(() => scheduleInit());
    observeTable.observer.observe(tbody, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      childList: true,
      subtree: true,
    });
  }

  function observeRoot() {
    if (observeRoot.observer) return;
    observeRoot.observer = new MutationObserver(() => {
      observeTable();
      scheduleInit();
    });
    observeRoot.observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function observeScroll() {
    if (observeScroll.bound) return;
    observeScroll.bound = true;
    window.addEventListener('scroll', scheduleVisibleBureauScan, { passive: true, capture: true });
    // 窗口缩放改变表格文档位置，面板需重新对齐
    window.addEventListener('resize', scheduleInit, { passive: true });
  }

  function start() {
    UI.setSidePanelHandlers({
      onEnter: (tr, clientY) => showRowInfo(tr, clientY),
      onLeave: handleLeave,
    });
    init();
    observeTable();
    observeRoot();
    observeScroll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

/* 致谢：本脚本的车型 / 席位图功能思路整合自 galaxy-sea/12306-seat-viewer（Apache-2.0），
   数据接口复用 12306 官方页面自身接口，仅作个人查询增强，不代抢、不高频。署名见 NOTICE / LICENSE。 */


})();
