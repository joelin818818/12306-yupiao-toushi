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
