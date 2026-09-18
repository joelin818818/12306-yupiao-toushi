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
