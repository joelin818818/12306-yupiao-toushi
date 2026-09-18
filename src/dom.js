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
