/* 부팅 스모크 테스트 (Node, 의존성 없음)
   최소 DOM 스텁으로 app.js IIFE를 로컬모드로 실제 실행 → 런타임 에러(참조/TDZ/순서) 없는지 확인.
   실행:  node webapp/test/boot_smoke.js        (또는)  node test/boot_smoke.js  from webapp/
   통과 시 exit 0 / "RESULT: PASS", 실패 시 exit 1.
   ※ 단위 테스트가 아니라 '부팅이 깨지지 않는다'를 보증하는 스모크. seed 재생성·리팩터 후 회귀 방지용. */
const path = require("path");

// 범용 element 프록시(어떤 속성/호출에도 자기 자신 반환)
let EL;
const handler = {
  get(t, prop) {
    if (prop === "classList") return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    if (prop === "dataset") return (t.__ds || (t.__ds = {}));
    if (prop === "style") return EL;
    if (prop === "parentElement") return EL;
    if (prop === "files") return [];
    if (prop === "value") return "";
    if (prop === "textContent" || prop === "innerHTML") return "";
    if (prop === "length") return 0;
    if (prop === Symbol.iterator) return function* () {};
    if (prop === "forEach") return () => {};
    if (prop === Symbol.toPrimitive) return () => "";
    return EL;
  },
  set() { return true; },
  apply() { return EL; },
};
EL = new Proxy(function () {}, handler);

// 최소 SEED (앱 구조만 만족)
const colors = {
  not_installed: "#BFBFBF", install_done: "#66FFFF", drill_done: "#66FFFF",
  predrill_duct: "#00B0F0", predrill_floor: "#00B0F0", today_install: "#0070C0",
  today_drill: "#FFFF00", etc_interf: "#FF0000", scaffold_interf: "#FF8F8F",
  none: "#FFFFFF", no_beam: "#FFFFFF",
};
const legend = Object.keys(colors).map(k => ({
  key: k, color: colors[k], label: k,
  layers: (k === "today_drill" || k === "drill_done" || k === "predrill_floor") ? ["바닥"] : ["횡주", "입상", "바닥"],
  sel: !["today_install", "today_drill"].includes(k), auto: ["today_install", "today_drill"].includes(k),
}));
const cells = [];
[["횡주", "none"], ["입상", "install_done"], ["바닥", "drill_done"]].forEach(([layer, status]) =>
  cells.push({ part: "C", floor: "1F", layer, status, qty: 46.04, qd: "46", d: null }));
const SEED = {
  updated: "2026-06", zones: ["북DS(FA,SA)"], floors: ["1F"],
  parts: [{ id: "C", zone: "북DS(FA,SA)", part_no: "P1", seong: "FA", size: "100", yeolsu: "1열", to: "" }],
  legend, cells,
};

global.window = { __SEED__: SEED, __CONFIG__: {}, supabase: undefined, matchMedia: () => ({ matches: false }), addEventListener: () => {}, open: () => {} };
global.document = EL;
global.localStorage = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.BroadcastChannel = function () { throw new Error("no bc env"); };
global.setInterval = () => 0;

let failed = false;
process.on("unhandledRejection", e => { console.error("UNHANDLED REJECTION:", e); failed = true; });
process.on("uncaughtException", e => { console.error("UNCAUGHT:", e); failed = true; });

const appPath = process.argv[2] || path.join(__dirname, "..", "app.js");
try {
  require(appPath);
  console.log("BOOT_OK pending=", global.localStorage.getItem("ds_pending_v1"));
} catch (e) { console.error("BOOT_THREW:", e); failed = true; }

setTimeout(() => { console.log(failed ? "RESULT: FAIL" : "RESULT: PASS"); process.exit(failed ? 1 : 0); }, 200);
