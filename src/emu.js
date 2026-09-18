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
