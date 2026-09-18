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
