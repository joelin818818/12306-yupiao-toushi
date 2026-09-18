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
