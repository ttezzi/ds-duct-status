/* DS 입상덕트 작업현황 — 단일 HTML 앱 v2 */
(function () {
  "use strict";
  const SEED = window.__SEED__;
  const CFG = window.__CONFIG__ || {};
  if (!SEED) { document.body.innerHTML = "<p style='padding:20px'>seed.js 없음. import_xlsx.py 를 실행하세요.</p>"; return; }

  const LAYERS = ["횡주", "입상", "바닥"];
  const STCOLOR = {}, STLABEL = {}, STLAYERS = {};
  SEED.legend.forEach(l => { STCOLOR[l.key] = l.color; STLABEL[l.key] = l.label; STLAYERS[l.key] = l.layers || LAYERS; });
  const DUCT_DONE = new Set(["install_done", "predrill_duct"]);
  const FLOOR_DONE = new Set(["install_done", "drill_done", "predrill_floor"]);
  const WORK_EXCLUDE = new Set(["none", "no_section", "no_beam"]);

  const keyOf = (p, f, l) => p + "|" + f + "|" + l;
  const seedCell = {}; SEED.cells.forEach(c => seedCell[keyOf(c.part, c.floor, c.layer)] = c);
  const partById = {}; SEED.parts.forEach(p => partById[p.id] = p);
  const partsByZone = {}; SEED.zones.forEach(z => partsByZone[z] = []);
  SEED.parts.forEach(p => partsByZone[p.zone].push(p));
  const zoneIdx = {}; SEED.zones.forEach((z, i) => zoneIdx[z] = i);

  function fmtNum(v) {
    if (v == null || v === "") return null;
    const n = Number(v); if (isNaN(n)) return String(v);
    return String(Math.round(n));   // 물량은 정수로 표기
  }

  /* ---------- Store ---------- */
  function makeStore() {
    const over = new Map(), notes = new Map(), subs = [];
    let backend = null;
    return {
      mode: "local",
      cell(k) {
        const o = over.get(k), s = seedCell[k];
        const status = (o && o.status != null) ? o.status : (s ? s.status : "none");
        const qd = (o && "qd" in o) ? o.qd : (o && "qty" in o) ? fmtNum(o.qty) : (s ? s.qd : null);
        const qty = (o && "qty" in o) ? o.qty : (s ? s.qty : null);
        return { status, qty, qd, seed: s };
      },
      note(k) { return notes.get(k) || ""; },
      onChange(cb) { subs.push(cb); },
      emit(k) { subs.forEach(f => f(k)); },
      _cell(k, v) { over.set(k, v); },
      _note(k, v) { if (v) notes.set(k, v); else notes.delete(k); },
      async setCell(k, patch, meta) {
        const v = Object.assign({}, over.get(k) || {}, patch);
        if ("qty" in patch) v.qd = fmtNum(patch.qty);
        over.set(k, v); this.emit(k);
        if (backend) try { await backend.saveCell(k, v, meta); } catch (e) { toast("저장 실패: " + e.message); }
      },
      async setNote(k, body, meta) {
        this._note(k, body); this.emit("note:" + k);
        if (backend) try { await backend.saveNote(k, body, meta); } catch (e) { toast("저장 실패: " + e.message); }
      },
      attach(b) { backend = b; },
    };
  }
  const store = makeStore();

  /* ---------- Backends ---------- */
  function localBackend() {
    const CK = "ds_cells_v2", NK = "ds_notes_v2"; let bc = null;
    try { bc = new BroadcastChannel("ds_sync"); } catch (e) {}
    try {
      const c = JSON.parse(localStorage.getItem(CK) || "{}"); Object.keys(c).forEach(k => store._cell(k, c[k]));
      const n = JSON.parse(localStorage.getItem(NK) || "{}"); Object.keys(n).forEach(k => store._note(k, n[k]));
    } catch (e) {}
    const pc = (k, v) => { const c = JSON.parse(localStorage.getItem(CK) || "{}"); c[k] = v; localStorage.setItem(CK, JSON.stringify(c)); };
    const pn = (k, b) => { const n = JSON.parse(localStorage.getItem(NK) || "{}"); if (b) n[k] = b; else delete n[k]; localStorage.setItem(NK, JSON.stringify(n)); };
    if (bc) bc.onmessage = e => { const d = e.data; if (d.t === "c") { store._cell(d.k, d.v); store.emit(d.k); } else { store._note(d.k, d.v); store.emit("note:" + d.k); } };
    return {
      saveCell(k, v) { pc(k, v); if (bc) bc.postMessage({ t: "c", k, v }); },
      saveNote(k, v) { pn(k, v); if (bc) bc.postMessage({ t: "n", k, v }); },
    };
  }
  async function cloudBackend() {
    const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    const { data: cells, error } = await sb.from("cells").select("key,status,qty,qd"); if (error) throw error;
    (cells || []).forEach(r => store._cell(r.key, { status: r.status, qty: r.qty, qd: r.qd }));
    const { data: ns } = await sb.from("notes").select("key,body"); (ns || []).forEach(r => store._note(r.key, r.body));
    sb.channel("ds-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "cells" }, p => { const r = p.new; if (r && r.key) { store._cell(r.key, { status: r.status, qty: r.qty, qd: r.qd }); store.emit(r.key); } })
      .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, p => { const r = p.new || p.old; if (r && r.key) { store._note(r.key, p.new ? p.new.body : ""); store.emit("note:" + r.key); } })
      .subscribe();
    return {
      async saveCell(k, v, meta) {
        const row = { key: k, status: v.status, qty: v.qty == null ? null : v.qty, qd: v.qd || null, updated_by: meta && meta.name, updated_at: new Date().toISOString() };
        const { error } = await sb.from("cells").upsert(row); if (error) throw error;
        sb.from("change_log").insert({ cell_key: k, new_status: v.status, qty: row.qty, user_name: meta && meta.name, team: meta && meta.team }).then(() => {}, () => {});
      },
      async saveNote(k, body, meta) {
        if (body) { const { error } = await sb.from("notes").upsert({ key: k, body, updated_by: meta && meta.name, updated_at: new Date().toISOString() }); if (error) throw error; }
        else await sb.from("notes").delete().eq("key", k);
      },
    };
  }

  let USER = JSON.parse(localStorage.getItem("ds_user") || "null");
  const meta = () => USER || {};

  /* ---------- 상태 ---------- */
  let currentZone = SEED.zones[0];
  let searchQ = "";
  let currentParts = [];
  const gridEl = document.getElementById("grid");
  const gw = document.getElementById("gridWrap");

  function matchPart(p, q) {
    const hay = [p.part_no, p.seong, p.size, p.yeolsu, p.zone, p.to].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  }

  function computeParts() {
    if (searchQ) return SEED.parts.filter(p => matchPart(p, searchQ));
    return partsByZone[currentZone] || [];
  }

  /* ---------- 렌더 ---------- */
  function renderGrid() {
    const parts = currentParts = computeParts();
    const tbl = document.createElement("table"); tbl.className = "elev";
    const thead = document.createElement("thead");

    // 구역행
    const zr = document.createElement("tr"); zr.className = "zone-row";
    zr.innerHTML = `<th class="corner c-floor">층</th><th class="corner c-layer">구분</th>`;
    let i = 0;
    while (i < parts.length) {
      let j = i; while (j < parts.length && parts[j].zone === parts[i].zone) j++;
      const th = document.createElement("th"); th.className = "zone-h"; th.colSpan = j - i;
      th.dataset.z = zoneIdx[parts[i].zone]; th.textContent = parts[i].zone; zr.appendChild(th); i = j;
    }
    thead.appendChild(zr);

    // 파트행 (덕트NO / 성상 / 열수 / 라인메모)
    const pr = document.createElement("tr"); pr.className = "part-row";
    pr.innerHTML = `<th class="corner c-floor">덕트</th><th class="corner c-layer">성상</th>`;
    parts.forEach(p => {
      const th = document.createElement("th"); th.dataset.z = zoneIdx[p.zone];
      th.title = `${p.part_no} · ${p.seong || ""}${p.size ? " · " + p.size : ""}${p.yeolsu ? " · " + p.yeolsu : ""}${p.to ? " · TO " + p.to : ""}`;
      const hasN = !!store.note("lm:" + p.id);
      th.innerHTML =
        `<span class="pn">${p.part_no}</span>` +
        `<span class="sg" title="${p.seong || ""}">${p.seong || ""}</span>` +
        `<span class="ys">${p.size || ""}</span>` +
        `<span class="lm ${hasN ? "has-dot" : ""}" data-linememo="${p.id}">📝</span>`;
      pr.appendChild(th);
    });
    thead.appendChild(pr);
    tbl.appendChild(thead);

    const tbody = document.createElement("tbody");
    const zoneForMemo = () => searchQ ? "검색" : currentZone;

    // 상부접점
    tbody.appendChild(contactRow(parts, "upper", "상부접점"));

    // 층 × 레이어
    SEED.floors.forEach(floor => {
      const present = LAYERS.filter(L => parts.some(p => seedCell[keyOf(p.id, floor, L)]));
      present.forEach((layer, li) => {
        const tr = document.createElement("tr");
        tr.className = "lyr-" + (layer === "횡주" ? "h" : layer === "입상" ? "v" : "b");
        if (li === 0) tr.classList.add("floor-top");
        const mid = li === present.indexOf("입상") || (present.indexOf("입상") < 0 && li === Math.floor((present.length - 1) / 2));
        const fl = document.createElement("td"); fl.className = "rl floor";
        if (mid) {
          const hasM = !!store.note("fm:" + zoneForMemo() + ":" + floor);
          fl.innerHTML = `<span class="fl-name">${floor}</span><button class="memo-btn ${hasM ? "has-dot" : "empty"}" data-memo="${floor}" title="층 메모">📝</button>`;
        }
        tr.appendChild(fl);
        const ll = document.createElement("td"); ll.className = "rl layer lyr-" + (layer === "횡주" ? "h" : layer === "입상" ? "v" : "b"); ll.textContent = layer; tr.appendChild(ll);
        parts.forEach(p => {
          const k = keyOf(p.id, floor, layer), sc = seedCell[k];
          const td = document.createElement("td"); td.className = "c"; td.dataset.key = k;
          if (!sc) { td.classList.add("absent"); td.dataset.key = ""; tr.appendChild(td); return; }
          paintCell(td, k); tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    });

    // 타공현황(바닥 완료 카운트)
    const cr = document.createElement("tr"); cr.className = "count";
    cr.innerHTML = `<td class="rl floor" colspan="2">타공<br>현황</td>`;
    parts.forEach(p => { const td = document.createElement("td"); td.dataset.countPart = p.id; setCount(td, p.id); cr.appendChild(td); });
    tbody.appendChild(cr);

    // 하부접점
    tbody.appendChild(contactRow(parts, "lower", "하부접점"));

    tbl.appendChild(tbody);
    gridEl.innerHTML = ""; gridEl.appendChild(tbl);
    buildStatusStrip(parts);
  }

  function contactRow(parts, kind, label) {
    const tr = document.createElement("tr"); tr.className = "contact " + (kind === "lower" ? "lower" : "upper");
    tr.innerHTML = `<td class="rl floor" colspan="2">${label}</td>`;
    parts.forEach(p => {
      const td = document.createElement("td"); td.className = "c contact-c";
      td.dataset.contact = (kind === "upper" ? "uc:" : "dc:") + p.id;
      const v = store.note((kind === "upper" ? "uc:" : "dc:") + p.id);
      td.textContent = v ? (v.length > 6 ? v.slice(0, 6) + "…" : v) : "";
      if (v) td.title = v;
      tr.appendChild(td);
    });
    return tr;
  }

  function paintCell(td, k) {
    const c = store.cell(k), st = c.status;
    td.className = "c"; td.dataset.key = k;
    if (st === "no_beam") { td.classList.add("nobeam"); td.innerHTML = ""; return; }
    td.style.background = (st === "none") ? "#fff" : (STCOLOR[st] || "#fff");
    td.innerHTML = (c.qd != null && c.qd !== "") ? `<span class="q">${c.qd}</span>` : "";
  }

  function floorDoneCount(partId) {
    let done = 0, total = 0;
    SEED.floors.forEach(f => {
      const k = keyOf(partId, f, "바닥"); if (!seedCell[k]) return;
      const st = store.cell(k).status; if (WORK_EXCLUDE.has(st)) return;
      total++; if (FLOOR_DONE.has(st)) done++;
    });
    return [done, total];
  }
  function setCount(td, partId) {
    const [d, t] = floorDoneCount(partId);
    td.textContent = t ? d + "/" + t : "·";
    td.className = ""; if (t && d === t) td.className = "full"; else if (t && d === 0) td.className = "lo";
  }

  function buildStatusStrip(parts) {
    const strip = document.getElementById("statusStrip"); if (!strip) return;
    const cnt = {}; let dT = 0, dD = 0, fT = 0, fD = 0;
    parts.forEach(p => SEED.floors.forEach(f => LAYERS.forEach(L => {
      const k = keyOf(p.id, f, L); if (!seedCell[k]) return;
      const st = store.cell(k).status; cnt[st] = (cnt[st] || 0) + 1;
      if (WORK_EXCLUDE.has(st)) return;
      if (L === "바닥") { fT++; if (FLOOR_DONE.has(st)) fD++; }
      else { dT++; if (DUCT_DONE.has(st)) dD++; }
    })));
    const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
    const chip = key => cnt[key] ? `<span class="chip"><span class="sw" style="background:${key === "none" ? "#fff" : STCOLOR[key]}"></span>${STLABEL[key]} <b>${cnt[key]}</b></span>` : "";
    strip.innerHTML =
      `<div class="prog"><span class="pl">덕트설치</span><div class="prog-bar duct"><i style="width:${pct(dD, dT)}%"></i></div><span class="prog-num">${pct(dD, dT)}% (${dD}/${dT})</span></div>` +
      `<div class="prog"><span class="pl">바닥타공</span><div class="prog-bar floor"><i style="width:${pct(fD, fT)}%"></i></div><span class="prog-num">${pct(fD, fT)}% (${fD}/${fT})</span></div>` +
      `<span class="sep"></span>` +
      ["install_done", "predrill_duct", "predrill_floor", "drill_done", "today_install", "today_drill", "not_installed", "etc_interf", "scaffold_interf"].map(chip).join("");
  }

  function cssEsc(s) { return s.replace(/["\\]/g, "\\$&"); }
  function refreshCell(k) {
    const td = gridEl.querySelector(`td.c[data-key="${cssEsc(k)}"]`); if (td) paintCell(td, k);
    const part = k.split("|")[0];
    const ct = gridEl.querySelector(`td[data-count-part="${cssEsc(part)}"]`); if (ct) setCount(ct, part);
  }

  /* ---------- 팔레트 ---------- */
  let selKey = null;
  const paletteModal = document.getElementById("paletteModal"), qtyInput = document.getElementById("qtyInput");
  function openPalette(k) {
    if (!USER) { openName(); return; }
    selKey = k;
    const c = store.cell(k), [pid, floor, layer] = k.split("|"), p = partById[pid];
    document.getElementById("paletteTitle").textContent = `${p ? p.part_no : ""} · ${floor} · ${layer}`;
    const bits = [];
    if (p) { if (p.zone) bits.push(p.zone); if (p.seong) bits.push("성상 " + p.seong); if (p.size) bits.push("SIZE " + p.size); if (p.yeolsu) bits.push(p.yeolsu); if (p.to) bits.push("TO " + p.to); }
    document.getElementById("paletteSub").textContent = bits.join("  ·  ");
    const list = document.getElementById("paletteList"); list.innerHTML = "";
    SEED.legend.filter(l => (l.layers || LAYERS).includes(layer)).forEach(l => {
      const opt = document.createElement("div"); opt.className = "opt" + (c.status === l.key ? " cur" : "");
      const isX = l.key === "no_beam";
      opt.innerHTML = `<span class="sw" style="background:${l.key === "none" ? "#fff" : l.color}"></span><span>${l.label}</span>`;
      opt.onclick = () => applyStatus(l.key); list.appendChild(opt);
    });
    qtyInput.value = (c.qd != null ? c.qd : "");
    paletteModal.classList.remove("hidden");
    gridEl.querySelectorAll("td.sel").forEach(e => e.classList.remove("sel"));
    const td = gridEl.querySelector(`td.c[data-key="${cssEsc(k)}"]`); if (td) td.classList.add("sel");
  }
  function applyStatus(statusKey) {
    if (!selKey) return;
    const patch = { status: statusKey };
    const qv = qtyInput.value.trim();
    patch.qty = qv === "" ? null : (isNaN(Number(qv)) ? qv : Number(qv));
    store.setCell(selKey, patch, meta()); closeModals();
  }
  qtyInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const cur = store.cell(selKey).status; applyStatus(cur); } });

  /* ---------- 텍스트(메모/접점) ---------- */
  let textKey = null;
  const textModal = document.getElementById("textModal");
  function openText(key, title) {
    if (!USER) { openName(); return; }
    textKey = key; document.getElementById("textTitle").textContent = title;
    document.getElementById("textArea").value = store.note(key);
    textModal.classList.remove("hidden"); setTimeout(() => document.getElementById("textArea").focus(), 50);
  }
  document.getElementById("textSave").onclick = () => { store.setNote(textKey, document.getElementById("textArea").value.trim(), meta()); closeModals(); };
  document.getElementById("textDelete").onclick = () => { store.setNote(textKey, "", meta()); closeModals(); };

  /* ---------- 이름/팀 ---------- */
  const nameModal = document.getElementById("nameModal");
  function openName() { nameModal.classList.remove("hidden"); }
  document.getElementById("nameSave").onclick = () => {
    const n = document.getElementById("nameInput").value.trim(), t = document.getElementById("teamInput").value.trim();
    if (!n) { document.getElementById("nameInput").focus(); return; }
    USER = { name: n, team: t }; localStorage.setItem("ds_user", JSON.stringify(USER));
    document.getElementById("userLabel").textContent = t ? `${n}(${t})` : n; closeModals();
  };
  document.getElementById("userBtn").onclick = () => { if (USER) { document.getElementById("nameInput").value = USER.name; document.getElementById("teamInput").value = USER.team || ""; } openName(); };

  function closeModals() {
    [paletteModal, textModal, nameModal].forEach(m => m.classList.add("hidden"));
    gridEl.querySelectorAll("td.sel").forEach(e => e.classList.remove("sel")); selKey = null; textKey = null;
  }
  document.querySelectorAll("[data-close]").forEach(b => b.onclick = closeModals);
  [paletteModal, textModal].forEach(m => m.addEventListener("click", e => { if (e.target === m) closeModals(); }));

  /* ---------- 격자 클릭 ---------- */
  gridEl.addEventListener("click", e => {
    const lm = e.target.closest("[data-linememo]"); if (lm) { const p = partById[lm.dataset.linememo]; openText("lm:" + lm.dataset.linememo, `${p.part_no} 라인 메모`); return; }
    const mb = e.target.closest("[data-memo]"); if (mb) { openText("fm:" + (searchQ ? "검색" : currentZone) + ":" + mb.dataset.memo, `${searchQ ? "" : currentZone + " "}${mb.dataset.memo} 층 메모`); return; }
    const ct = e.target.closest("[data-contact]"); if (ct) { const kind = ct.dataset.contact.startsWith("uc") ? "상부접점" : "하부접점"; const pid = ct.dataset.contact.split(":")[1]; openText(ct.dataset.contact, `${partById[pid].part_no} ${kind}`); return; }
    const td = e.target.closest("td.c"); if (td && td.dataset.key) openPalette(td.dataset.key);
  });

  /* ---------- 구역 탭 ---------- */
  function buildZoneTabs() {
    const wrap = document.getElementById("zoneTabs"); wrap.innerHTML = "";
    SEED.zones.concat(["all"]).forEach(z => {
      const b = document.createElement("button");
      b.textContent = z === "all" ? "전체" : z; if (z !== "all") b.dataset.z = zoneIdx[z];
      b.className = (!searchQ && z === currentZone) ? "active" : "";
      b.onclick = () => { searchQ = ""; document.getElementById("searchInput").value = ""; document.getElementById("searchClear").classList.add("hidden"); currentZone = z === "all" ? "all" : z; if (z === "all") renderAll(); else { buildZoneTabs(); renderGrid(); } gw.scrollTo(0, 0); };
      wrap.appendChild(b);
    });
  }
  // '전체' 는 모든 구역 파트
  function renderAll() { currentZone = "all"; partsByZone["all"] = SEED.parts; buildZoneTabs(); renderGrid(); }
  partsByZone["all"] = SEED.parts;

  /* ---------- 검색 ---------- */
  const searchInput = document.getElementById("searchInput"), searchClear = document.getElementById("searchClear");
  let searchT = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchT);
    searchT = setTimeout(() => {
      searchQ = searchInput.value.trim().toLowerCase();
      searchClear.classList.toggle("hidden", !searchQ);
      buildZoneTabs(); renderGrid();
      if (searchQ) toast(`'${searchInput.value.trim()}' 검색: ${currentParts.length}개 라인`);
    }, 200);
  });
  searchClear.onclick = () => { searchInput.value = ""; searchQ = ""; searchClear.classList.add("hidden"); buildZoneTabs(); renderGrid(); };

  /* ---------- 범례 ---------- */
  function buildLegend() {
    const bar = document.getElementById("legendBar"); bar.innerHTML = "";
    SEED.legend.forEach(l => {
      const d = document.createElement("div"); d.className = "lg";
      const sw = l.key === "no_beam" ? `<span class="sw xbeam"></span>` : `<span class="sw" style="background:${l.key === "none" ? "#fff" : l.color}"></span>`;
      d.innerHTML = sw + l.label; bar.appendChild(d);
    });
  }

  /* ---------- 줌(포인터 중심) ---------- */
  let cellPx = 30;
  const clamp = v => Math.max(13, Math.min(70, Math.round(v)));
  function setVars() {
    document.documentElement.style.setProperty("--cell", cellPx + "px");
    document.documentElement.style.setProperty("--thin", Math.max(12, Math.round(cellPx * 0.62)) + "px");
    document.getElementById("zoomReset").textContent = Math.round(cellPx / 30 * 100) + "%";
  }
  function zoomAt(px, cx, cy) {
    const r = gw.getBoundingClientRect();
    const ox = cx == null ? r.width / 2 : cx - r.left, oy = cy == null ? r.height / 2 : cy - r.top;
    const old = cellPx, contentX = gw.scrollLeft + ox, contentY = gw.scrollTop + oy;
    cellPx = clamp(px); setVars();
    const ratio = cellPx / old;
    gw.scrollLeft = contentX * ratio - ox; gw.scrollTop = contentY * ratio - oy;
  }
  document.getElementById("zoomIn").onclick = () => zoomAt(cellPx + 5);
  document.getElementById("zoomOut").onclick = () => zoomAt(cellPx - 5);
  document.getElementById("zoomReset").onclick = () => zoomAt(30);
  gw.addEventListener("wheel", e => { if (e.ctrlKey) { e.preventDefault(); zoomAt(cellPx + (e.deltaY < 0 ? 4 : -4), e.clientX, e.clientY); } }, { passive: false });
  // 핀치
  const pts = new Map(); let pinchD = 0, pinchBase = 30, pinchCx = 0, pinchCy = 0;
  gw.addEventListener("pointerdown", e => pts.set(e.pointerId, e));
  gw.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchD === 0) { pinchD = d; pinchBase = cellPx; pinchCx = (a.clientX + b.clientX) / 2; pinchCy = (a.clientY + b.clientY) / 2; }
      else zoomAt(pinchBase * d / pinchD, pinchCx, pinchCy);
    }
  });
  const clr = e => { pts.delete(e.pointerId); if (pts.size < 2) pinchD = 0; };
  gw.addEventListener("pointerup", clr); gw.addEventListener("pointercancel", clr);

  /* ---------- 토스트 ---------- */
  let tipT = null;
  function toast(m) { const t = document.getElementById("infoTip"); t.textContent = m; t.classList.remove("hidden"); clearTimeout(tipT); tipT = setTimeout(() => t.classList.add("hidden"), 2400); }

  /* ---------- 엑셀 내보내기 ---------- */
  document.getElementById("exportBtn").onclick = exportXlsx;
  async function exportXlsx() {
    if (!window.ExcelJS) { toast("내보내기 모듈 로딩 중..."); return; }
    toast("엑셀 생성 중...");
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("DS 설치현황");
    const P = SEED.parts;
    ws.addRow(["구역", "", ""].concat(P.map(p => p.zone)));
    ws.addRow(["덕트NO", "", ""].concat(P.map(p => p.part_no)));
    ws.addRow(["성상", "", ""].concat(P.map(p => p.seong || "")));
    ws.addRow(["SIZE", "", ""].concat(P.map(p => p.size || "")));
    ws.addRow(["열수", "", ""].concat(P.map(p => p.yeolsu || "")));
    const argb = h => "FF" + (h || "FFFFFF").replace("#", "");
    SEED.floors.forEach(floor => LAYERS.forEach(layer => {
      if (!P.some(p => seedCell[keyOf(p.id, floor, layer)])) return;
      const row = ws.addRow(["", floor, layer].concat(P.map(p => { const k = keyOf(p.id, floor, layer), sc = seedCell[k]; if (!sc) return ""; const c = store.cell(k); return c.qd != null ? c.qd : ""; })));
      P.forEach((p, idx) => {
        const k = keyOf(p.id, floor, layer), sc = seedCell[k]; if (!sc) return;
        const st = store.cell(k).status; if (st === "none" || st === "no_beam") return;
        row.getCell(4 + idx).fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(STCOLOR[st]) } };
      });
    }));
    ws.addRow(["타공현황", "", ""].concat(P.map(p => { const [d, t] = floorDoneCount(p.id); return t ? d + "/" + t : ""; })));
    ws.columns.forEach((c, i) => c.width = i < 3 ? 9 : 5);
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = "DS설치현황_" + new Date().toISOString().slice(0, 10) + ".xlsx"; a.click(); URL.revokeObjectURL(a.href);
  }

  /* ---------- 변경 구독 ---------- */
  store.onChange(k => {
    if (k.startsWith("note:")) {
      const nk = k.slice(5);
      if (nk.startsWith("lm:")) { const el = gridEl.querySelector(`[data-linememo="${cssEsc(nk.slice(3))}"]`); if (el) el.className = "lm " + (store.note(nk) ? "has-dot" : ""); }
      else if (nk.startsWith("uc:") || nk.startsWith("dc:")) { const el = gridEl.querySelector(`[data-contact="${cssEsc(nk)}"]`); if (el) { const v = store.note(nk); el.textContent = v ? (v.length > 6 ? v.slice(0, 6) + "…" : v) : ""; el.title = v || ""; } }
      else if (nk.startsWith("fm:")) { const floor = nk.split(":")[2]; const el = gridEl.querySelector(`[data-memo="${cssEsc(floor)}"]`); if (el) el.className = "memo-btn " + (store.note(nk) ? "has-dot" : "empty"); }
    } else { refreshCell(k); buildStatusStrip(currentParts); }
  });

  /* ---------- 부트 ---------- */
  async function boot() {
    if (SEED.updated) document.getElementById("upd").textContent = "기준 " + SEED.updated;
    buildZoneTabs(); buildLegend(); setVars(); renderGrid();
    if (USER) document.getElementById("userLabel").textContent = USER.team ? `${USER.name}(${USER.team})` : USER.name;
    const conn = document.getElementById("connState");
    if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase) {
      try { store.attach(await cloudBackend()); store.mode = "cloud"; conn.textContent = "실시간"; conn.className = "conn cloud"; renderGrid(); }
      catch (e) { console.error(e); store.attach(localBackend()); conn.textContent = "로컬(연결실패)"; conn.className = "conn err"; toast("클라우드 연결 실패 → 로컬"); renderGrid(); }
    } else { store.attach(localBackend()); conn.textContent = "로컬"; conn.className = "conn local"; renderGrid(); }
    if (!USER) openName();
  }
  boot();
})();
