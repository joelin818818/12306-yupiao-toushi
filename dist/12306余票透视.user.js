'use strict';
(function () {
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

// config.js — 功能开关与本地持久化（GM_setValue / GM_getValue）
// 默认全部开启；动车组型号依赖第三方数据 moerail.ml，失败可静默降级。
const CONFIG = (() => {
  const DEFAULTS = {
    bureau: true, // 局属徽标
    seat: true,   // 席位图鉴悬浮
    price: true,  // 票价 / 折扣角标
    emu: true,    // 动车组型号
    exact: false, // 确切余票数量（需登录 12306，实验性）
  };

  function get(key) {
    try {
      const v = GM_getValue('sv_cfg_' + key);
      return v === undefined ? DEFAULTS[key] : v;
    } catch (e) {
      return DEFAULTS[key];
    }
  }

  function set(key, value) {
    try {
      GM_setValue('sv_cfg_' + key, value);
    } catch (e) {
      /* 忽略存储异常 */
    }
  }

  return { get, set, DEFAULTS, keys: Object.keys(DEFAULTS) };
})();

// api.js — 12306 官方接口封装（局属 / 席位图鉴 / 车型）
// 数据接口复用自 galaxy-sea/12306-seat-viewer（Apache-2.0, 作者 魏昌进 / wcj.plus）。
// 接口均为 12306 官方开放接口，无需任何第三方服务，最为稳健。
const API = (() => {
  const metaCache = new Map();
  const metaRequests = new Map();
  const seatCache = new Map();
  const seatRequests = new Map();

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
    const resp = await fetch(url, {
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
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error('bureau request failed');
    const data = await resp.json();
    return {
      bureauName: data?.data?.bureau_code_name || null,
      bureauCode: data?.data?.bureau_code || null,
    };
  }

  function fetchTrainMeta(trainCode, rawTrainCode) {
    if (!trainCode) return Promise.resolve(null);
    const queryDate = getRunningDay();
    if (!queryDate) return Promise.resolve(null);
    const bureauTrainCode = rawTrainCode || trainCode;
    const key = queryDate + '|' + trainCode;
    if (metaCache.has(key)) return Promise.resolve(metaCache.get(key));
    if (metaRequests.has(key)) return metaRequests.get(key);

    const request = fetchDeptMeta(trainCode)
      .then(async (meta) => (meta?.bureauName ? meta : fetchBureauMeta(bureauTrainCode)))
      .catch(() => fetchBureauMeta(bureauTrainCode))
      .then((meta) => {
        metaCache.set(key, meta);
        return meta;
      })
      .catch(() => {
        metaCache.set(key, null);
        return null;
      })
      .finally(() => metaRequests.delete(key));

    metaRequests.set(key, request);
    return request;
  }

  // 席位图鉴
  function fetchSeatPics(trainCode, runningDay) {
    if (!trainCode || !runningDay) return Promise.resolve(null);
    const key = trainCode + '|' + runningDay;
    if (seatCache.has(key)) return Promise.resolve(seatCache.get(key));
    if (seatRequests.has(key)) return seatRequests.get(key);
    const url =
      'https://kyfw.12306.cn/wxxcx/openplatform-inner/miniprogram/wifiapps/appFrontEnd/v2/lounge/open-smooth-common/trainStyleBatch/getCarDetail?carCode=&trainCode=' +
      encodeURIComponent(trainCode) +
      '&runningDay=' +
      encodeURIComponent(runningDay) +
      '&reqType=form';
    const request = fetch(url, { method: 'GET' })
      .then(async (resp) => {
        if (!resp.ok) throw new Error('seat request failed');
        const data = await resp.json();
        const pics = data?.content?.data?.coachDetailPicList || null;
        seatCache.set(key, pics);
        return pics;
      })
      .catch(() => {
        seatCache.set(key, null);
        return null;
      })
      .finally(() => seatRequests.delete(key));
    seatRequests.set(key, request);
    return request;
  }

  // 确切余票数量：复用 moerail-tools/tickets.py 的订单初始化流程（需登录）
  // 仅登录态（同浏览器 12306 Cookie）可用；该操作会进入下单初始化，不提交订单。
  const SEAT_NAME = {
    swz_num: '商务座', rz_num: '软座', yz_num: '硬座',
    gr_num: '高软', rw_num: '软卧', yw_num: '硬卧',
    zy_num: '一等座', ze_num: '二等座', dw_num: '动车卧',
    wz_num: '无座', qt_num: '其他',
  };

  function fetchExactTickets(secretStr) {
    if (!secretStr) return Promise.resolve(null);
    const body =
      'secretStr=' + encodeURIComponent(secretStr) + '&tour_flag=dc&_json_att=';
    return fetch('https://kyfw.12306.cn/otn/leftTicket/submitOrderRequest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data || (data.status !== true && data.result_code !== 0)) {
          throw new Error((data && (data.messages || data.message)) || '提交订单初始化失败');
        }
        return fetch('https://kyfw.12306.cn/otn/confirmPassenger/initDc?_input_charset=utf-8', {
          method: 'GET',
          credentials: 'include',
        });
      })
      .then((r) => r.text())
      .then((html) => {
        const m = html.match(/ticketInfoForPassengerForm=(.*?);/);
        if (!m) throw new Error('未解析到余票详情');
        const json = JSON.parse(m[1].replace(/'/g, '"'));
        const dto = json.queryLeftNewDetailDTO || {};
        const list = [];
        for (const k in dto) {
          if (k.endsWith('_num')) {
            const v = dto[k];
            if (v === '' || v == null) continue;
            list.push({ seat: SEAT_NAME[k] || k.replace('_num', ''), count: v });
          }
        }
        return list;
      });
  }

  return { getRunningDay, fetchTrainMeta, fetchSeatPics, fetchExactTickets };
})();

// emu.js — 动车组型号识别
// 识别逻辑与数据接口复用自 Arnie97/moerail-tools（MIT, 作者 Arnie97）。
// 数据来源 moerail.ml/models.json 为第三方服务，本模块做本地缓存 + 失败静默降级，
// 即使服务不可用也不影响其它功能。
const EMU = (() => {
  let models = null;
  let patterns = {};
  const cacheKey = 'sv_emu_models';

  function loadModels() {
    if (models) return Promise.resolve(models);
    // 优先使用本地缓存
    try {
      const cached = GM_getValue(cacheKey);
      if (cached) {
        models = cached;
        patterns = models[':'] || {};
        delete models[':'];
        return Promise.resolve(models);
      }
    } catch (e) {
      /* ignore */
    }
    return fetch('https://moerail.ml/models.json')
      .then((r) => r.json())
      .then((json) => {
        models = json;
        patterns = models[':'] || {};
        delete models[':'];
        try {
          GM_setValue(cacheKey, json);
        } catch (e) {
          /* ignore */
        }
        return models;
      })
      .catch(() => {
        models = models || {};
        return models;
      });
  }

  // 高速/动车/城际/特殊列车才尝试识别
  function getTrainModel(code) {
    if (!code || 'GDCS'.indexOf(code[0]) === -1) return null;
    if (!models) return null;
    for (const key in models) {
      const codes = models[key] || [];
      for (let i = codes.length - 1; i >= 0; i--) {
        if (code === codes[i]) return { name: key, exact: true };
      }
    }
    for (const key in patterns) {
      if (code.match(patterns[key])) return { name: key, exact: false };
    }
    return null;
  }

  // 城际列车（天津 C2x）按席别推断车型
  function getIntercityModel(code, coachClassId) {
    if (code.match(/C2[0-6]/)) {
      if (coachClassId && coachClassId.match(/^SWZ_/)) return { name: 'CR400AF/BF型', exact: false };
      if (coachClassId && coachClassId.match(/^TZ_/)) return { name: 'CRH3C型', exact: false };
    }
    return null;
  }

  function init() {
    return loadModels();
  }

  return { init, getTrainModel, getIntercityModel };
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

  // 路局中文名 -> 单字简称
  const bureauMap = {
    哈尔滨: '哈', 哈尔滨局: '哈',
    沈阳: '沈', 沈阳局: '沈',
    北京: '京', 北京局: '京',
    呼和浩特: '呼', 呼和浩特局: '呼',
    太原: '太', 太原局: '太',
    上海: '上', 上海局: '上',
    济南: '济', 济南局: '济',
    南昌: '南', 南昌局: '南',
    广州: '广', 广州局: '广',
    南宁: '宁', 南宁局: '宁',
    武汉: '武', 武汉局: '武',
    郑州: '郑', 郑州局: '郑',
    成都: '成', 成都局: '成',
    昆明: '昆', 昆明局: '昆',
    青藏: '青',
    兰州: '兰', 兰州局: '兰',
    乌鲁木齐: '乌', 乌鲁木齐局: '乌',
    西安: '西', 西安局: '西',
  };

  // 提取车次行的预订 secretStr（12306 版本相关，best-effort）
  function getSecretStr(tr) {
    const links = tr.querySelectorAll('a');
    for (const el of links) {
      const oc = el.getAttribute('onclick') || '';
      const m =
        oc.match(/(?:secretStr|secret_str)\W*[:=]\W*['"]([^'"]+)['"]/) ||
        oc.match(/getTicketFunc\([^)]*['"]([^'"]{20,})['"]/);
      if (m) return decodeURIComponent(m[1]);
    }
    const m2 = (tr.outerHTML || '').match(/secretStr\W*[:=]\W*['"]([^'"]+)['"]/);
    if (m2) return decodeURIComponent(m2[1]);
    return null;
  }

  return { getTrainAnchor, getRawTrainCode, getTrainCode, findRows, getCoachClassId, getSecretStr, bureauMap };
})();

// ui.js — 界面渲染：悬浮提示、局属/车型徽标、票价角标、设置面板
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
.sv-seats { display: grid; grid-template-columns: repeat(3, minmax(288px, 1fr)); gap: 8px; margin-top: 4px; }
.sv-seats.cols-1 { grid-template-columns: repeat(1, minmax(288px, 1fr)); max-width: 336px; }
.sv-seats.cols-2 { grid-template-columns: repeat(2, minmax(288px, 1fr)); max-width: 672px; }
.sv-seats.cols-3 { grid-template-columns: repeat(3, minmax(288px, 1fr)); max-width: 1008px; }
.sv-seat { margin: 0; text-align: center; color: #e2e8f0; font-size: 12px; }
.sv-seat img { width: 100%; max-height: 288px; object-fit: contain; border-radius: 8px; background: #0f172a; }
.t-list .train-type .train-type-item.item-ju { border: 1px solid #c084fc; color: #7c3aed; }
.t-list .train-type .train-type-item.item-emu { border: 1px solid #38bdf8; color: #0ea5e9; }
.sv-price { margin-top: 2px; color: #fb7403; font-size: 12px; font-weight: 400; line-height: 1.2; white-space: nowrap; }

.sv-settings-btn {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: 38px; height: 38px; border-radius: 50%;
  background: #0f172a; color: #fff; border: 1px solid #334155;
  cursor: pointer; font-size: 18px; line-height: 36px; text-align: center;
  box-shadow: 0 4px 12px rgba(0,0,0,.3);
}
.sv-settings-panel {
  position: fixed; right: 16px; bottom: 62px; z-index: 2147483647;
  background: #0f172a; color: #f8fafc; border-radius: 10px; padding: 12px 14px;
  font: 13px/1.6 "Segoe UI", "PingFang SC", sans-serif; width: 200px;
  box-shadow: 0 10px 30px rgba(0,0,0,.35); display: none;
}
.sv-settings-panel h4 { margin: 0 0 8px; font-size: 13px; color: #94a3b8; font-weight: 600; }
.sv-settings-panel label { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 2px 0; }
.sv-settings-panel small { display:block; margin-top:8px; color:#64748b; font-size:11px; }

.sv-exact-btn {
  margin-left: 6px; padding: 1px 6px; font-size: 11px; line-height: 1.4;
  background: #1d4ed8; color: #fff; border: none; border-radius: 4px; cursor: pointer;
}
.sv-exact-btn:hover { background: #2563eb; }
.sv-exact-box {
  position: fixed; right: 16px; top: 16px; z-index: 2147483647;
  background: #0f172a; color: #f8fafc; border-radius: 10px; padding: 12px 14px;
  font: 13px/1.6 "Segoe UI", "PingFang SC", sans-serif; width: 220px;
  box-shadow: 0 10px 30px rgba(0,0,0,.35); display: none;
}
.sv-exact-head { font-weight: 600; margin-bottom: 6px; color: #38bdf8; }
.sv-exact-row { display: flex; justify-content: space-between; padding: 1px 0; }
.sv-exact-row b { color: #fb7403; }
.sv-exact-tip { margin-top: 8px; color: #64748b; font-size: 11px; }
`);
  }

  function createTooltip() {
    const tip = document.createElement('div');
    tip.className = 'seat-viewer-tooltip';
    tip.style.display = 'none';
    document.body.appendChild(tip);
    return tip;
  }

  function renderTooltip(trainCode, meta, seatPics, emu) {
    const safeTrain = escapeHtml(trainCode);
    const metaParts = [
      `<span class="sv-meta-item"><strong>车次:</strong> ${safeTrain}</span>`,
    ];
    if (emu) {
      metaParts.push(`<span class="sv-meta-item" style="color:#38bdf8;"><strong>车型:</strong> ${escapeHtml(emu.name)}</span>`);
    }
    if (meta?.bureauName || meta?.deptName) {
      const bureauText = [meta.bureauName, meta.deptName].filter(Boolean).join('-');
      metaParts.push(`<span class="sv-meta-item"><strong>局属:</strong> ${escapeHtml(bureauText)}</span>`);
    }
    if (meta?.perHourSpeed) {
      metaParts.push(`<span class="sv-meta-item"><strong>时速:</strong> ${escapeHtml(meta.perHourSpeed)} </span>`);
    }
    if (meta?.carType) {
      const styleText = meta.trainStyle ? `：${escapeHtml(meta.trainStyle)}` : '';
      metaParts.push(`<span class="sv-meta-item"> ${escapeHtml(meta.carType)}${styleText}</span>`);
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

  function applyBureauBadge(tr, meta) {
    if (!meta?.bureauName) return;
    const container = tr.querySelector('.train-type');
    if (!container) return;
    const shortName = DOM.bureauMap[meta.bureauName] || meta.bureauName;
    let badge = container.querySelector("[data-sv-bureau='1']");
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'train-type-item item-ju';
      badge.dataset.svBureau = '1';
      container.appendChild(badge);
    }
    badge.textContent = shortName;
    badge.title = meta.bureauName;
  }

  function applyEMUBadge(tr, emu, code) {
    if (!emu) return;
    const container = tr.querySelector('.train-type');
    if (!container) return;
    let badge = container.querySelector("[data-sv-emu='1']");
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'train-type-item item-emu';
      badge.dataset.svEmu = '1';
      container.appendChild(badge);
    }
    badge.textContent = emu.name;
    badge.title = '动车组型号（数据：moerail.ml）';
    if (emu.exact) {
      const img = document.createElement('img');
      img.style.cssText =
        'display:none;position:absolute;z-index:120;width:640px;padding:4px;background:#fff;border:2px solid #ddd;border-radius:4px;';
      img.src = 'https://moerail.ml/img/' + code + '.png';
      badge.appendChild(img);
      badge.style.position = 'relative';
      badge.addEventListener('mouseenter', () => (img.style.display = 'block'));
      badge.addEventListener('mouseleave', () => (img.style.display = 'none'));
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

  // 设置面板
  function buildSettings() {
    const btn = document.createElement('div');
    btn.className = 'sv-settings-btn';
    btn.textContent = '⚙';
    btn.title = '12306余票透视 · 设置';

    const panel = document.createElement('div');
    panel.className = 'sv-settings-panel';
    panel.innerHTML = '<h4>显示选项</h4>';
    const labels = {
      bureau: '车次局属徽标',
      seat: '席位图鉴悬浮',
      price: '票价 / 折扣角标',
      emu: '动车组型号',
      exact: '确切余票数量',
    };
    CONFIG.keys.forEach((k) => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = CONFIG.get(k);
      cb.addEventListener('change', () => CONFIG.set(k, cb.checked));
      label.appendChild(cb);
      label.appendChild(document.createTextNode(labels[k] || k));
      panel.appendChild(label);
    });
    const tip = document.createElement('small');
    tip.textContent = '数据接口复用 12306 官方及 moerail.ml，详见项目 README。';
    panel.appendChild(tip);

    btn.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });
    document.body.appendChild(btn);
    document.body.appendChild(panel);
  }

  function showExact(trainCode, list) {
    let box = document.getElementById('sv-exact-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'sv-exact-box';
      box.className = 'sv-exact-box';
      document.body.appendChild(box);
    }
    if (!list || !list.length) {
      box.innerHTML = `<div class="sv-exact-head">${escapeHtml(trainCode)}</div>暂无确切余票数据（需登录 12306 且为可预订车次）`;
    } else {
      const rows = list
        .map((i) => `<div class="sv-exact-row"><span>${escapeHtml(i.seat)}</span><b>${escapeHtml(String(i.count))}</b></div>`)
        .join('');
      box.innerHTML = `<div class="sv-exact-head">${escapeHtml(trainCode)} 确切余票</div>${rows}<div class="sv-exact-tip">数据来自 12306 订单初始化接口，仅登录后可见</div>`;
    }
    box.style.display = 'block';
    clearTimeout(showExact._t);
    showExact._t = setTimeout(() => {
      box.style.display = 'none';
    }, 6000);
  }

  return {
    addStyles,
    createTooltip,
    renderTooltip,
    applyBureauBadge,
    applyEMUBadge,
    syncPrices,
    buildSettings,
    showExact,
  };
})();

// main.js — 主控：事件绑定、观察器、悬浮交互与模块编排
(() => {
  UI.addStyles();
  const tooltip = UI.createTooltip();

  let currentHover = null;
  let currentTooltipPoint = null;

  const metaCache = new Map();
  const seatCache = new Map();

  function ensureAnchorStyle(tr) {
    const anchor =
      tr.querySelector('[id^="train_num_"] > div.train > div > a') ||
      tr.querySelector('.train > div > a');
    if (!anchor) return;
    const style = anchor.getAttribute('style') || '';
    const needsHeight = !/height\s*:/.test(style);
    const needsLineHeight = !/line-height\s*:/.test(style);
    if (!needsHeight && !needsLineHeight) return;
    const merged = `${style}${needsHeight ? 'height: 18px;' : ''}${needsLineHeight ? 'line-height: 18px;' : ''}`;
    anchor.setAttribute('style', merged.trim());
  }

  function getMetaCacheKey(trainCode) {
    const d = API.getRunningDay();
    return d && trainCode ? `${d}|${trainCode}` : null;
  }

  // 确切余票：在车次行首格注入「余票详情」按钮（需登录，点击才触发）
  function addExactButton(tr) {
    if (tr.dataset.svExactBtn === '1') return;
    const cell = tr.querySelector('td');
    if (!cell) return;
    tr.dataset.svExactBtn = '1';
    const btn = document.createElement('button');
    btn.className = 'sv-exact-btn';
    btn.textContent = '余票详情';
    btn.title = '点击查询各席别确切余票（需登录 12306）';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = DOM.getTrainCode(tr);
      const secret = DOM.getSecretStr(tr);
      if (!secret) {
        UI.showExact(code, null);
        return;
      }
      UI.showExact(code, []);
      API.fetchExactTickets(secret)
        .then((list) => UI.showExact(code, list))
        .catch(() => UI.showExact(code, null));
    });
    cell.appendChild(btn);
  }

  function handleEnter(event) {
    const tr = event.currentTarget;
    currentHover = tr;
    currentTooltipPoint = { clientY: event.clientY };
    ensureAnchorStyle(tr);

    if (!CONFIG.get('seat') && !CONFIG.get('bureau') && !CONFIG.get('emu')) {
      return;
    }

    const trainCode = DOM.getTrainCode(tr);
    const rawTrainCode = DOM.getRawTrainCode(tr);
    const runningDay = API.getRunningDay();

    const metaKey = getMetaCacheKey(trainCode);
    const metaCached = metaKey && metaCache.has(metaKey) ? metaCache.get(metaKey) : undefined;
    const seatKey = runningDay ? `${trainCode}|${runningDay}` : null;
    const seatCached = seatKey && seatCache.has(seatKey) ? seatCache.get(seatKey) : undefined;

    let emu = null;
    if (CONFIG.get('emu')) {
      emu = EMU.getTrainModel(trainCode) || EMU.getIntercityModel(trainCode, DOM.getCoachClassId(tr));
    }

    if (CONFIG.get('bureau') && metaCached) UI.applyBureauBadge(tr, metaCached);
    if (CONFIG.get('emu') && emu) UI.applyEMUBadge(tr, emu, trainCode);

    if (CONFIG.get('seat')) {
      tooltip.innerHTML = UI.renderTooltip(trainCode, metaCached || undefined, seatCached || undefined, emu || undefined);
      tooltip.style.visibility = 'hidden';
      tooltip.style.display = 'block';
      scheduleTooltipPosition(tr);
    }

    if (CONFIG.get('bureau') && metaCached === undefined) {
      API.fetchTrainMeta(trainCode, rawTrainCode).then((meta) => {
        if (metaKey) metaCache.set(metaKey, meta);
        UI.applyBureauBadge(tr, meta);
        if (currentHover === tr && CONFIG.get('seat')) {
          tooltip.innerHTML = UI.renderTooltip(
            trainCode,
            meta || undefined,
            seatKey ? seatCache.get(seatKey) || undefined : undefined,
            (EMU.getTrainModel(trainCode) || EMU.getIntercityModel(trainCode, DOM.getCoachClassId(tr))) || undefined
          );
          scheduleTooltipPosition(tr);
        }
      });
    }

    if (CONFIG.get('seat') && runningDay && seatCached === undefined) {
      API.fetchSeatPics(trainCode, runningDay).then((pics) => {
        if (seatKey) seatCache.set(seatKey, pics);
        if (currentHover === tr) {
          const meta = metaKey && metaCache.has(metaKey) ? metaCache.get(metaKey) : undefined;
          const e = CONFIG.get('emu')
            ? EMU.getTrainModel(trainCode) || EMU.getIntercityModel(trainCode, DOM.getCoachClassId(tr))
            : null;
          tooltip.innerHTML = UI.renderTooltip(trainCode, meta || undefined, pics || undefined, e || undefined);
          scheduleTooltipPosition(tr);
        }
      });
    }
  }

  function handleLeave() {
    tooltip.style.display = 'none';
    tooltip.style.visibility = 'hidden';
    currentHover = null;
    currentTooltipPoint = null;
  }

  function handleMove(event) {
    const tr = event.currentTarget;
    if (currentHover !== tr || tooltip.style.display !== 'block') return;
    currentTooltipPoint = { clientY: event.clientY };
    scheduleTooltipPosition(tr);
  }

  function setTooltipPosition(point) {
    const offsetY = 30;
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
      if (CONFIG.get('bureau')) {
        observeVisibleRow(tr);
      }
      if (CONFIG.get('exact')) {
        addExactButton(tr);
      }
      if (tr.dataset.svBound !== '1') {
        tr.dataset.svBound = '1';
        tr.addEventListener('mouseenter', handleEnter, { passive: true });
        tr.addEventListener('mouseleave', handleLeave, { passive: true });
        tr.addEventListener('mousemove', handleMove, { passive: true });
      }
    });
  }

  // 局属徽标：进入视口才请求，省流量
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
  function applyVisibleBureauBadge(tr) {
    const trainCode = DOM.getTrainCode(tr);
    const rawTrainCode = DOM.getRawTrainCode(tr);
    if (!trainCode) return;
    const key = getMetaCacheKey(trainCode);
    if (key && metaCache.has(key)) {
      UI.applyBureauBadge(tr, metaCache.get(key));
      return;
    }
    API.fetchTrainMeta(trainCode, rawTrainCode).then((meta) => {
      if (key) metaCache.set(key, meta);
      UI.applyBureauBadge(tr, meta);
    });
  }

  function findRows(tbody) {
    return DOM.findRows(tbody);
  }

  function init() {
    const dateInput = document.getElementById('train_date');
    const tbody = document.getElementById('queryLeftTable');
    if (!dateInput || !tbody) return;
    if (!dateInput.value?.trim()) return;

    if (CONFIG.get('price')) UI.syncPrices(tbody);

    const rows = findRows(tbody);
    if (!rows.length) return;
    bindRows(rows);
    if (CONFIG.get('bureau')) scanVisibleBureauRows();
  }

  function scanVisibleBureauRows() {
    const tbody = document.getElementById('queryLeftTable');
    if (!tbody) return;
    findRows(tbody).forEach((tr) => {
      if (!isNearViewport(tr)) return;
      if (tr.querySelector("[data-sv-bureau='1']")) return;
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
    window.addEventListener('resize', scheduleVisibleBureauScan, { passive: true });
  }

  function start() {
    init();
    observeTable();
    observeRoot();
    observeScroll();
  }

  // 动车组型号数据异步加载（失败不影响其它功能）
  if (CONFIG.get('emu')) {
    EMU.init().catch(() => {});
  }

  UI.buildSettings();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();


})();
