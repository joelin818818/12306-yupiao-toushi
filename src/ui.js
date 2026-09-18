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
