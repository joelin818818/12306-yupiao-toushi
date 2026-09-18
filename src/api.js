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
