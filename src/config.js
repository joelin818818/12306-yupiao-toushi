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
