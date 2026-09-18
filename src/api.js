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
