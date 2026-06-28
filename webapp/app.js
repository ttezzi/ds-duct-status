/* DS 입상덕트 작업현황 — 단일 HTML 앱 v2 */
(function () {
  "use strict";
  const SEED = window.__SEED__;
  const CFG = window.__CONFIG__ || {};
  if (!SEED) { document.body.innerHTML = "<p style='padding:20px'>seed.js 없음. import_xlsx.py 를 실행하세요.</p>"; return; }

  const LAYERS = ["횡주", "입상", "바닥"];
  const STCOLOR = {}, STLABEL = {}, STLAYERS = {}, STSEL = {}, STAUTO = {};
  SEED.legend.forEach(l => { STCOLOR[l.key] = l.color; STLABEL[l.key] = l.label; STLAYERS[l.key] = l.layers || LAYERS; STSEL[l.key] = !!l.sel; STAUTO[l.key] = !!l.auto; });
  function escAttr(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
  const DUCT_DONE = new Set(["install_done", "predrill_duct", "today_install"]);
  const FLOOR_DONE = new Set(["drill_done", "predrill_floor", "today_drill"]);
  const WORK_EXCLUDE = new Set(["none", "no_beam"]);
  // 완료 상태 → 당일이면 보여줄 '금일' 색 키
  const TODAY_OF = { install_done: "today_install", drill_done: "today_drill" };
  // 전일대비 마커 대상(설치·간섭)
  const DIFF_STATUS = new Set(["install_done", "predrill_duct", "drill_done", "predrill_floor", "etc_interf", "scaffold_interf"]);
  function todayStr() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  const TODAY = todayStr();

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
    const pending = new Map();            // 미저장(저장 실패) 큐 — 새로고침에도 살아남음
    let backend = null;
    const PK = "ds_pending_v1";
    try { const o = JSON.parse(localStorage.getItem(PK) || "{}"); Object.keys(o).forEach(k => pending.set(k, o[k])); } catch (e) {}
    const persistPending = () => { const o = {}; pending.forEach((v, k) => o[k] = v); localStorage.setItem(PK, JSON.stringify(o)); };
    return {
      mode: "local",
      cell(k) {
        const o = over.get(k), s = seedCell[k];
        const status = (o && o.status != null) ? o.status : (s ? s.status : "none");
        const qd = (o && "qd" in o) ? o.qd : (o && "qty" in o) ? fmtNum(o.qty) : (s ? s.qd : null);
        const qty = (o && "qty" in o) ? o.qty : (s ? s.qty : null);
        const d = (o && "d" in o) ? o.d : (s ? s.d : null);
        return { status, qty, qd, d, seed: s };
      },
      note(k) { return notes.get(k) || ""; },
      onChange(cb) { subs.push(cb); },
      emit(k) { subs.forEach(f => f(k)); },
      _cell(k, v) { over.set(k, v); },
      _note(k, v) { if (v) notes.set(k, v); else notes.delete(k); },
      async setCell(k, patch, meta) {
        const old = this.cell(k).status;        // 변경 전 상태(이력용)
        const v = Object.assign({}, over.get(k) || {}, patch);
        if ("qty" in patch) v.qd = fmtNum(patch.qty);
        if ("status" in patch) v.d = TODAY;   // 변경일(전일대비·금일색 판정)
        over.set(k, v); this.emit(k);
        await this._save("c:" + k, { kind: "cell", k, v, meta, old });
      },
      async setNote(k, body, meta) {
        this._note(k, body); this.emit("note:" + k);
        await this._save("n:" + k, { kind: "note", k, body, meta });
      },
      // ── 미저장 큐(저장 실패·오프라인 보관 + 자동 재시도) ──
      _run(job) { return job.kind === "cell" ? backend.saveCell(job.k, job.v, job.meta, job.old) : backend.saveNote(job.k, job.body, job.meta); },
      async _save(qk, job) {
        if (!backend) return;
        pending.set(qk, job); persistPending(); markPending(job);
        try { await this._run(job); pending.delete(qk); persistPending(); markPending(job); }
        catch (e) { toast("저장 실패 — 미저장 보관, 재연결 시 자동 저장"); paintConn(); }
      },
      async flush() {
        if (!backend || !pending.size) return;
        const jobs = [...pending.entries()];
        for (const [qk, job] of jobs) { try { await this._run(job); pending.delete(qk); } catch (e) {} }
        persistPending(); jobs.forEach(([, job]) => markPending(job)); paintConn();
      },
      reapplyPending() { pending.forEach(job => { if (job.kind === "cell") over.set(job.k, job.v); else this._note(job.k, job.body); }); },
      pendingCount() { return pending.size; },
      isPending(k) { return pending.has("c:" + k); },
      photoList(pk) { try { return JSON.parse(notes.get(pk) || "[]"); } catch (e) { return []; } },
      async addPhoto(pk, file, meta) {
        if (!backend || !backend.uploadPhoto) { toast("사진 업로드 불가"); return; }
        const url = await backend.uploadPhoto(file, meta);
        const arr = this.photoList(pk); arr.push(url);
        await this.setNote(pk, JSON.stringify(arr), meta);
      },
      async delPhoto(pk, idx, meta) {
        const arr = this.photoList(pk); arr.splice(idx, 1);
        await this.setNote(pk, arr.length ? JSON.stringify(arr) : "", meta);
      },
      hasBackendPhoto() { return !!(backend && backend.uploadPhoto); },
      async loadLog(n) { return backend && backend.loadLog ? backend.loadLog(n) : []; },
      cloud() { return store.mode === "cloud"; },
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
      async uploadPhoto(file) { return await downscale(file); },   // 로컬: 압축 dataURL
    };
  }
  async function cloudBackend() {
    const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    const { data: cells, error } = await sb.from("cells").select("key,status,qty,qd,d"); if (error) throw error;
    (cells || []).forEach(r => store._cell(r.key, { status: r.status, qty: r.qty, qd: r.qd, d: r.d }));
    const { data: ns } = await sb.from("notes").select("key,body"); (ns || []).forEach(r => store._note(r.key, r.body));
    sb.channel("ds-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "cells" }, p => {
        const r = p.new; if (!r || !r.key) return;
        store._cell(r.key, { status: r.status, qty: r.qty, qd: r.qd, d: r.d }); store.emit(r.key);
        if (r.updated_by && (!USER || r.updated_by !== USER.name)) {   // 다른 사람이 바꾼 칸 알림(동시편집 인지)
          const a = String(r.key).split("|"), pp = partById[a[0]];
          toast(`✏️ ${r.updated_by}님이 ${(pp ? pp.part_no : a[0])}·${a[1] || ""} 변경`);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, p => { const r = p.new || p.old; if (r && r.key) { store._note(r.key, p.new ? p.new.body : ""); store.emit("note:" + r.key); } })
      .subscribe();
    return {
      async saveCell(k, v, meta, old) {
        const row = { key: k, status: v.status, qty: v.qty == null ? null : v.qty, qd: v.qd || null, d: v.d || null, updated_by: meta && meta.name, updated_at: new Date().toISOString() };
        const { error } = await sb.from("cells").upsert(row); if (error) throw error;
        if (old !== v.status)   // 실제 상태가 바뀐 경우만 이력 기록(불필요 노이즈 방지)
          sb.from("change_log").insert({ cell_key: k, old_status: old == null ? null : old, new_status: v.status, qty: row.qty, user_name: meta && meta.name, team: meta && meta.team }).then(() => {}, () => {});
      },
      async saveNote(k, body, meta) {
        if (body) { const { error } = await sb.from("notes").upsert({ key: k, body, updated_by: meta && meta.name, updated_at: new Date().toISOString() }); if (error) throw error; }
        else await sb.from("notes").delete().eq("key", k);
      },
      async uploadPhoto(file, meta) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = (meta && meta.name ? meta.name : "u") + "/" + Date.now() + "_" + Math.floor(Math.random() * 1e4) + "." + ext;
        const blob = await downscaleBlob(file);
        const { error } = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (error) throw error;
        return sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
      },
      async loadLog(limit) {
        const { data, error } = await sb.from("change_log")
          .select("cell_key,old_status,new_status,user_name,team,ts")
          .order("ts", { ascending: false }).limit(limit || 300);
        if (error) throw error; return data || [];
      },
    };
  }
  // 이미지 축소 → dataURL / Blob (업로드 용량 절감)
  function _draw(file, cb) {
    const img = new Image(), fr = new FileReader();
    fr.onload = () => { img.onload = () => {
      const max = 1280, s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas"); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); cb(cv);
    }; img.src = fr.result; };
    fr.readAsDataURL(file);
  }
  function downscale(file) { return new Promise(res => _draw(file, cv => res(cv.toDataURL("image/jpeg", 0.7)))); }
  function downscaleBlob(file) { return new Promise(res => _draw(file, cv => cv.toBlob(b => res(b), "image/jpeg", 0.72))); }

  let USER = JSON.parse(localStorage.getItem("ds_user") || "null");
  const meta = () => USER || {};

  // 저장모드 표시 + 미저장 대기 배지
  let connBase = { text: "로컬", cls: "conn local" };
  function paintConn() {
    const el = document.getElementById("connState"); if (!el) return;
    const n = store.pendingCount();
    el.className = connBase.cls + (n ? " has-pending" : "");
    el.textContent = connBase.text + (n ? " ⏳" + n : "");
    el.title = n ? n + "건 저장 대기 — 재연결 시 자동 저장" : "저장 모드";
  }
  function markPending(job) {
    if (job.kind === "cell") { const td = gridEl.querySelector(`td.c[data-key="${cssEsc(job.k)}"]`); if (td) td.classList.toggle("unsaved", store.isPending(job.k)); }
    paintConn();
  }

  /* ---------- 상태 ---------- */
  partsByZone["all"] = SEED.parts;
  // 구역 다중 토글(켠 것만 표시) — 기본 전부 ON, localStorage 지속
  let enabledZones;
  try { const z = JSON.parse(localStorage.getItem("ds_zones") || "null"); enabledZones = new Set(Array.isArray(z) && z.length ? z.filter(x => SEED.zones.includes(x)) : SEED.zones); }
  catch (e) { enabledZones = new Set(SEED.zones); }
  if (!enabledZones.size) enabledZones = new Set(SEED.zones);
  const saveZones = () => localStorage.setItem("ds_zones", JSON.stringify([...enabledZones]));
  let searchQ = "";
  let diffOn = false;               // 전일대비 표시
  let currentParts = [];
  const gridEl = document.getElementById("grid");
  const gw = document.getElementById("gridWrap");

  function matchPart(p, q) {
    const hay = [p.part_no, p.seong, p.size, p.yeolsu, p.zone, p.to].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  }

  function computeParts() {
    if (searchQ) return SEED.parts.filter(p => matchPart(p, searchQ));
    return SEED.parts.filter(p => enabledZones.has(p.zone));   // 켠 구역만(다중 토글)
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
      const th = document.createElement("th"); th.dataset.z = zoneIdx[p.zone]; th.dataset.part = p.id;
      th.title = `${p.part_no} · ${p.seong || ""}${p.size ? " · " + p.size : ""}${p.yeolsu ? " · " + p.yeolsu : ""}${p.to ? " · TO " + p.to : ""}`;
      th.innerHTML =
        `<span class="pn">${escAttr(p.part_no)}</span>` +
        `<span class="sz">${escAttr(p.size || "")}</span>` +
        `<span class="sg" title="${escAttr(p.seong || "")}">${escAttr(p.seong || "")}</span>` +
        `<button class="memo-btn lm-btn ${store.note("lm:" + p.id) ? "has-dot" : "empty"}" data-linememo="${escAttr(p.id)}" title="라인 메모">📝</button>`;
      pr.appendChild(th);
    });
    thead.appendChild(pr);
    tbl.appendChild(thead);

    const tbody = document.createElement("tbody");
    const zoneForMemo = () => "all";   // 층 메모는 구역 무관 전역(좌측 층 라벨 공통)

    // 상부접점
    tbody.appendChild(contactRow(parts, "upper", "상부접점"));

    // 층 × 레이어
    SEED.floors.forEach((floor, fi) => {
      const present = LAYERS.filter(L => parts.some(p => seedCell[keyOf(p.id, floor, L)]));
      present.forEach((layer, li) => {
        const tr = document.createElement("tr");
        tr.className = "lyr-" + (layer === "횡주" ? "h" : layer === "입상" ? "v" : "b");
        if (fi % 2 === 1) tr.classList.add("fb");   // 층 교대 밴드
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
          const td = document.createElement("td"); td.className = "c"; td.dataset.key = k; td.dataset.part = p.id;
          if (!sc) { td.classList.add("absent"); td.dataset.key = ""; tr.appendChild(td); return; }
          paintCell(td, k); tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    });

    // 타공현황(바닥 완료 카운트)
    const cr = document.createElement("tr"); cr.className = "count";
    cr.innerHTML = `<td class="rl floor" colspan="2">타공<br>현황</td>`;
    parts.forEach(p => { const td = document.createElement("td"); td.dataset.countPart = p.id; td.dataset.part = p.id; setCount(td, p.id); cr.appendChild(td); });
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
      const td = document.createElement("td"); td.className = "c contact-c"; td.dataset.part = p.id;
      const pre = kind === "upper" ? "uc:" : "dc:";
      td.dataset.contact = pre + p.id;
      paintContact(td, kind === "upper", p.id);
      tr.appendChild(td);
    });
    return tr;
  }
  // 접점 칸: 완료(초록)/미완료 + 텍스트
  function paintContact(td, upper, pid) {
    const v = store.note((upper ? "uc:" : "dc:") + pid);
    const done = store.note((upper ? "ucz:" : "dcz:") + pid) === "1";
    td.classList.toggle("c-done", done);
    td.textContent = v ? (v.length > 6 ? v.slice(0, 6) + "…" : v) : (done ? "✓" : "");
    td.title = v ? (done ? "[완료] " + v : v) : (done ? "완료" : "");
  }

  function effColor(c) {
    const st = c.status;
    if (st === "none") return "#fff";
    if (TODAY_OF[st] && c.d === TODAY) return STCOLOR[TODAY_OF[st]];   // 완료 + 당일 = 금일색
    return STCOLOR[st] || "#fff";
  }
  function paintCell(td, k) {
    const c = store.cell(k);
    let st = c.status; if (st === "no_beam") st = "none";   // 횡주간없음 → 해당없음으로 통일(흰색)
    td.className = "c"; td.dataset.key = k;
    td.style.background = effColor({ status: st, d: c.d });
    td.innerHTML = (st !== "none" && c.qd != null && c.qd !== "") ? `<span class="q">${c.qd}</span>` : "";
    const tm = store.note("wt:" + k);   // 작업팀(선택) → 툴팁
    td.title = tm ? "작업팀: " + tm : "";
    if (diffOn && c.d === TODAY && DIFF_STATUS.has(st)) td.classList.add("diffmark");
    if (store.isPending(k)) td.classList.add("unsaved");   // 저장 대기 표시
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

  // 범례 표(색·라벨)와 갯수를 한 칸에 통합 + 감추기. 진행바는 기설치/신규 구분.
  // 모바일에선 범례·갯수(해당없음 포함) 기본 접힘. 저장된 선택이 있으면 그걸 우선.
  let legendHidden = (function () { const v = localStorage.getItem("ds_legend_hidden"); return v == null ? window.matchMedia("(max-width:760px)").matches : v === "1"; })();
  const LEGEND_ORDER = ["not_installed", "install_done", "drill_done", "predrill_duct", "predrill_floor", "today_install", "today_drill", "etc_interf", "scaffold_interf", "none"];
  function buildStatusStrip(parts) {
    const strip = document.getElementById("statusStrip"); if (!strip) return;
    const cnt = {}; let dT = 0, fT = 0;
    parts.forEach(p => SEED.floors.forEach(f => LAYERS.forEach(L => {
      const k = keyOf(p.id, f, L); if (!seedCell[k]) return;
      const c = store.cell(k); let st = c.status; if (st === "no_beam") st = "none"; cnt[st] = (cnt[st] || 0) + 1;
      if (st === "install_done" && c.d === TODAY) cnt.today_install = (cnt.today_install || 0) + 1;
      if (st === "drill_done" && c.d === TODAY) cnt.today_drill = (cnt.today_drill || 0) + 1;
      if (WORK_EXCLUDE.has(st)) return;
      if (L === "바닥") fT++; else dT++;
    })));
    const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
    // 기설치(pre)와 금번 신규완료(new)를 진행바에서 색으로 구분
    const ductPre = cnt.predrill_duct || 0, ductNew = cnt.install_done || 0;
    const floorPre = cnt.predrill_floor || 0, floorNew = cnt.drill_done || 0;
    const prog = (label, cls, pre, nw, tot) =>
      `<div class="prog"><span class="pl">${label}</span>` +
      `<div class="prog-bar ${cls}" title="기설치 ${pre} · 신규 ${nw} / 전체 ${tot}"><i class="seg-pre" style="width:${pct(pre, tot)}%"></i><i class="seg-new" style="width:${pct(nw, tot)}%"></i></div>` +
      `<span class="prog-num">${pct(pre + nw, tot)}% <b>${pre + nw}</b>/${tot}<em> 기${pre}·신${nw}</em></span></div>`;
    const chip = key => {
      const n = cnt[key] || 0;
      const sw = key === "no_beam" ? `<span class="sw xbeam"></span>` : `<span class="sw" style="background:${key === "none" ? "#fff" : STCOLOR[key]}"></span>`;
      return `<span class="chip"><span class="sw-wrap">${sw}</span>${STLABEL[key]}${STAUTO[key] ? ` <em class="auto-tag">자동</em>` : ""}${key === "none" ? "" : ` <b>${n}</b>`}</span>`;
    };
    strip.innerHTML =
      `<button id="legendToggle" class="legend-toggle" title="범례·갯수 접기/펴기">${legendHidden ? "▸" : "▾"} 범례·갯수</button>` +
      prog("덕트설치", "duct", ductPre, ductNew, dT) +
      prog("바닥타공", "floor", floorPre, floorNew, fT) +
      `<span class="sep"></span>` +
      `<div class="chips ${legendHidden ? "hidden" : ""}">` + LEGEND_ORDER.map(chip).join("") + `</div>`;
    document.getElementById("legendToggle").onclick = () => {
      legendHidden = !legendHidden; localStorage.setItem("ds_legend_hidden", legendHidden ? "1" : "0");
      strip.querySelector(".chips").classList.toggle("hidden", legendHidden);
      document.getElementById("legendToggle").textContent = (legendHidden ? "▸" : "▾") + " 범례·갯수";
    };
  }

  function cssEsc(s) { return s.replace(/["\\]/g, "\\$&"); }
  function refreshCell(k) {
    const td = gridEl.querySelector(`td.c[data-key="${cssEsc(k)}"]`); if (td) paintCell(td, k);
    const part = k.split("|")[0];
    const ct = gridEl.querySelector(`td[data-count-part="${cssEsc(part)}"]`); if (ct) setCount(ct, part);
  }

  /* ---------- (라인+층) 통합 편집 ---------- */
  const editorModal = document.getElementById("editorModal");
  let edPart = null, edFloor = null;
  // 레이어별 편집 옵션 — '해당없음(none)'을 모든 레이어 공통 옵션으로 포함
  const optsFor = layer => SEED.legend.filter(l => (l.sel || l.key === "none") && (l.layers || LAYERS).includes(layer));
  const hasLayer = (pid, f, l) => !!seedCell[keyOf(pid, f, l)];

  function openEditor(pid, floor) {
    if (!USER) { openLogin(); return; }
    edPart = pid; edFloor = floor;
    const p = partById[pid];
    document.getElementById("edTitle").textContent = `${p.part_no} · ${floor}`;
    const bits = [p.zone]; if (p.seong) bits.push("성상 " + p.seong); if (p.size) bits.push("SIZE " + p.size); if (p.yeolsu) bits.push(p.yeolsu); if (p.to) bits.push("TO " + p.to);
    document.getElementById("edSub").textContent = bits.filter(Boolean).join("  ·  ");
    renderEditor();
    // 잔여작업 메모 + 사진
    const rmKey = "rm:" + pid + ":" + floor;
    const memoEl = document.getElementById("edMemo"); memoEl.value = store.note(rmKey);
    memoEl.onchange = () => store.setNote(rmKey, memoEl.value.trim(), meta());
    renderPhotos();
    document.getElementById("photoHint").textContent = store.cloud() ? "" : "(로컬 저장 · 공유하려면 Supabase 연결)";
    document.getElementById("edMeta").textContent = "";
    editorModal.classList.remove("hidden");
    gridEl.querySelectorAll("td.sel").forEach(e => e.classList.remove("sel"));
  }

  function renderEditor() {
    const wrap = document.getElementById("edLayers"); wrap.innerHTML = "";
    const defs = [
      { layer: "횡주" },
      { layer: "입상" },
      { layer: "바닥", title: "바닥 (타공)" },
    ];
    defs.forEach(def => {
      if (!hasLayer(edPart, edFloor, def.layer)) return;
      const k = keyOf(edPart, edFloor, def.layer);
      let cur = store.cell(k).status; if (cur === "no_beam") cur = "none";   // 횡주간없음 → 해당없음으로 통일
      const row = document.createElement("div"); row.className = "ed-row"; row.dataset.layer = def.layer;
      let body = `<div class="ed-rh"><span class="lname">${def.title || def.layer}</span></div>`;
      body += `<div class="ed-chips">` + optsFor(def.layer).map(l =>
        `<button class="chip ${cur === l.key ? "cur" : ""}" data-status="${l.key}"><span class="sw" style="background:${l.color}"></span>${l.label}</button>`).join("") + `</div>`;
      // 작업팀(선택) — 덕트설치·타공·횡주 누가 했는지
      body += `<div class="ed-team"><label>작업팀 <span class="opt">(선택)</span></label><input class="team-inp" value="${escAttr(store.note("wt:" + k))}" placeholder="예: ○○설비팀" /></div>`;
      row.innerHTML = body;
      // 상태칩
      row.querySelectorAll(".chip").forEach(b => b.onclick = () => setLayer(def.layer, b.dataset.status));
      // 작업팀 입력
      const ti = row.querySelector(".team-inp");
      if (ti) ti.onchange = () => store.setNote("wt:" + k, ti.value.trim(), meta());
      wrap.appendChild(row);
    });
    updatePreview();
  }

  function setLayer(layer, statusKey) {
    store.setCell(keyOf(edPart, edFloor, layer), { status: statusKey }, meta());
    renderEditor();
  }

  function updatePreview() {
    [["횡주", "pvH"], ["입상", "pvI"], ["바닥", "pvB"]].forEach(([L, id]) => {
      const el = document.getElementById(id); const wrap = el.parentElement;
      if (!hasLayer(edPart, edFloor, L)) { wrap.style.display = "none"; return; }
      wrap.style.display = "flex";
      const c = store.cell(keyOf(edPart, edFloor, L));
      const st = c.status === "no_beam" ? "none" : c.status;   // 횡주간없음 → 해당없음
      wrap.classList.remove("beam-none");
      wrap.style.background = effColor({ status: st, d: c.d });
      el.textContent = (L === "입상" && st !== "none" && c.qd != null) ? c.qd : "";
    });
  }

  /* 사진 */
  function renderPhotos() {
    const pk = "ph:" + edPart + ":" + edFloor;
    const wrap = document.getElementById("edPhotos"); wrap.innerHTML = "";
    store.photoList(pk).forEach((url, i) => {
      const d = document.createElement("div"); d.className = "ph";
      d.innerHTML = `<img src="${url}" alt="현장사진"><button class="del" aria-label="삭제">✕</button>`;
      d.querySelector("img").onclick = () => window.open(url, "_blank");
      d.querySelector(".del").onclick = async () => { await store.delPhoto(pk, i, meta()); renderPhotos(); };
      wrap.appendChild(d);
    });
  }
  const photoInput = document.getElementById("photoInput");
  document.getElementById("photoBtn").onclick = () => photoInput.click();
  async function uploadPhotos(fileList) {
    if (!edPart) return;
    const pk = "ph:" + edPart + ":" + edFloor;
    const files = [...fileList].filter(f => f && f.type && f.type.indexOf("image/") === 0);
    if (!files.length) { toast("이미지 파일만 가능합니다"); return; }
    for (const f of files) { try { toast("사진 업로드 중..."); await store.addPhoto(pk, f, meta()); } catch (e) { toast("업로드 실패: " + e.message); } }
    renderPhotos();
  }
  photoInput.onchange = () => { const fs = [...photoInput.files]; photoInput.value = ""; uploadPhotos(fs); };
  // 드래그&드롭
  const photoDrop = document.getElementById("photoDrop");
  ["dragenter", "dragover"].forEach(ev => photoDrop.addEventListener(ev, e => { e.preventDefault(); photoDrop.classList.add("dragging"); }));
  ["dragleave", "dragend"].forEach(ev => photoDrop.addEventListener(ev, e => { e.preventDefault(); photoDrop.classList.remove("dragging"); }));
  photoDrop.addEventListener("drop", e => { e.preventDefault(); photoDrop.classList.remove("dragging"); if (e.dataTransfer && e.dataTransfer.files.length) uploadPhotos(e.dataTransfer.files); });
  // 붙여넣기(Ctrl+V) — 편집모달 열려있을 때만
  document.addEventListener("paste", e => {
    if (!edPart || editorModal.classList.contains("hidden")) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const files = [];
    for (const it of items) { if (it.kind === "file") { const f = it.getAsFile(); if (f && f.type.indexOf("image/") === 0) files.push(f); } }
    if (files.length) { e.preventDefault(); uploadPhotos(files); }
  });

  /* ---------- 텍스트(메모/접점) ---------- */
  let textKey = null, textDoneKey = null, textDone = false;
  const textModal = document.getElementById("textModal");
  const textStatusEl = document.getElementById("textStatus");
  function paintTextSeg() { textStatusEl.querySelectorAll("[data-cstat]").forEach(b => b.classList.toggle("on", (b.dataset.cstat === "done") === textDone)); }
  textStatusEl.querySelectorAll("[data-cstat]").forEach(b => b.onclick = () => { textDone = b.dataset.cstat === "done"; paintTextSeg(); });
  function openText(key, title, opts) {
    if (!USER) { openLogin(); return; }
    textKey = key; document.getElementById("textTitle").textContent = title;
    document.getElementById("textArea").value = store.note(key);
    if (opts && opts.doneKey) { textDoneKey = opts.doneKey; textDone = store.note(opts.doneKey) === "1"; textStatusEl.classList.remove("hidden"); paintTextSeg(); }
    else { textDoneKey = null; textStatusEl.classList.add("hidden"); }
    textModal.classList.remove("hidden"); setTimeout(() => document.getElementById("textArea").focus(), 50);
  }
  document.getElementById("textSave").onclick = () => {
    store.setNote(textKey, document.getElementById("textArea").value.trim(), meta());
    if (textDoneKey) store.setNote(textDoneKey, textDone ? "1" : "", meta());
    closeModals();
  };
  document.getElementById("textDelete").onclick = () => {
    store.setNote(textKey, "", meta());
    if (textDoneKey) store.setNote(textDoneKey, "", meta());
    closeModals();
  };

  /* ---------- 로그인(공구·이름·비번) ---------- */
  // ※ 클라이언트 비번은 '화면 편집 잠금'일 뿐 — DB 자체 차단 아님(캐주얼 오편집 방지 + 작성자 기록용).
  const nameModal = document.getElementById("nameModal");
  const GONGGU = ["1공구", "2공구", "3공구", "4공구", "5공구"];
  const GONGGU_PW = { "1공구": "1111", "2공구": "2222", "3공구": "3333", "4공구": "4444", "5공구": "5555" };
  let loginGg = null;
  const rosterOf = g => { try { return JSON.parse(store.note("roster:" + g) || "[]"); } catch (e) { return []; } };
  function loginErr(m) { const e = document.getElementById("loginErr"); e.textContent = m || ""; e.classList.toggle("hidden", !m); }
  function setUserLabel() { document.getElementById("userLabel").textContent = USER ? `${USER.name}(${USER.team})` : "로그인"; }
  function renderLoginGonggu() {
    const wrap = document.getElementById("loginGonggu"); wrap.innerHTML = "";
    GONGGU.forEach(g => { const b = document.createElement("button"); b.type = "button"; b.className = "gg-btn" + (loginGg === g ? " sel" : ""); b.textContent = g;
      b.onclick = () => { loginGg = g; renderLoginGonggu(); renderLoginNames(); loginErr(""); }; wrap.appendChild(b); });
  }
  function renderLoginNames() {
    const wrap = document.getElementById("loginNames"); wrap.innerHTML = "";
    if (!loginGg) { wrap.innerHTML = `<span class="nc-hint">공구를 먼저 선택하세요</span>`; return; }
    const names = rosterOf(loginGg);
    if (!names.length) { wrap.innerHTML = `<span class="nc-hint">등록된 이름 없음 — 아래에 새로 입력</span>`; return; }
    names.forEach(nm => { const b = document.createElement("button"); b.type = "button"; b.className = "name-chip" + (document.getElementById("nameInput").value === nm ? " sel" : ""); b.textContent = nm;
      b.onclick = () => { document.getElementById("nameInput").value = nm; wrap.querySelectorAll(".name-chip").forEach(x => x.classList.remove("sel")); b.classList.add("sel"); }; wrap.appendChild(b); });
  }
  function openLogin() {
    loginGg = USER ? USER.team : null;
    document.getElementById("nameInput").value = USER ? USER.name : "";
    document.getElementById("pwInput").value = "";
    loginErr("");
    document.getElementById("logoutBtn").classList.toggle("hidden", !USER);
    renderLoginGonggu(); renderLoginNames();
    nameModal.classList.remove("hidden");
  }
  document.getElementById("nameSave").onclick = () => {
    const n = document.getElementById("nameInput").value.trim();
    const pw = document.getElementById("pwInput").value.trim();
    if (!loginGg) { loginErr("공구를 선택하세요"); return; }
    if (!n) { loginErr("이름을 선택하거나 새로 입력하세요"); document.getElementById("nameInput").focus(); return; }
    if (pw !== GONGGU_PW[loginGg]) { loginErr("비밀번호가 올바르지 않습니다"); document.getElementById("pwInput").focus(); return; }
    USER = { name: n, team: loginGg }; localStorage.setItem("ds_user", JSON.stringify(USER)); setUserLabel();
    const names = rosterOf(loginGg); if (names.indexOf(n) < 0) { names.push(n); store.setNote("roster:" + loginGg, JSON.stringify(names), USER); }
    closeModals();
  };
  document.getElementById("logoutBtn").onclick = () => { USER = null; localStorage.removeItem("ds_user"); setUserLabel(); closeModals(); };
  document.getElementById("userBtn").onclick = openLogin;

  const dashModal = document.getElementById("dashModal");
  const histModal = document.getElementById("histModal");
  function closeModals() {
    [editorModal, textModal, nameModal, dashModal, histModal].forEach(m => m.classList.add("hidden"));
    gridEl.querySelectorAll("td.sel").forEach(e => e.classList.remove("sel")); textKey = null; edPart = null;
  }
  document.querySelectorAll("[data-close]").forEach(b => b.onclick = closeModals);
  [editorModal, textModal, dashModal, histModal, nameModal].forEach(m => m.addEventListener("click", e => { if (e.target === m) closeModals(); }));
  // Esc 로 열린 모달 닫기(접근성)
  document.addEventListener("keydown", e => { if (e.key === "Escape" && [editorModal, textModal, nameModal, dashModal, histModal].some(m => !m.classList.contains("hidden"))) closeModals(); });

  /* ---------- 격자 클릭 ---------- */
  gridEl.addEventListener("click", e => {
    const lb = e.target.closest("[data-linememo]"); if (lb) { const pid = lb.dataset.linememo; openText("lm:" + pid, `${partById[pid].part_no} 라인 메모`); return; }
    const mb = e.target.closest("[data-memo]"); if (mb) { openText("fm:all:" + mb.dataset.memo, `${mb.dataset.memo} 층 메모`); return; }
    const ct = e.target.closest("[data-contact]"); if (ct) { const up = ct.dataset.contact.indexOf("uc:") === 0; const pid = ct.dataset.contact.split(":")[1]; openText(ct.dataset.contact, `${partById[pid].part_no} ${up ? "상부접점" : "하부접점"}`, { doneKey: (up ? "ucz:" : "dcz:") + pid }); return; }
    const td = e.target.closest("td.c"); if (td && td.dataset.key) { const [pid, floor] = td.dataset.key.split("|"); openEditor(pid, floor); }
  });

  /* ---------- hover 십자 강조(층 행 + 라인 열) — 엑셀 포커스셀 ---------- */
  gridEl.addEventListener("mouseover", e => {
    const td = e.target.closest("td.c[data-key]"); if (!td || !td.dataset.key) { return; }
    const [pid, floor] = td.dataset.key.split("|");
    if (gridEl.dataset.hl === floor && gridEl.dataset.hp === pid) return;
    hlFloor(floor); hlPart(pid);
  });
  gridEl.addEventListener("mouseleave", () => { hlFloor(null); hlPart(null); });
  function hlFloor(floor) {
    gridEl.dataset.hl = floor || "";
    gridEl.querySelectorAll("tr.hlfloor").forEach(r => r.classList.remove("hlfloor"));
    if (!floor) return;
    gridEl.querySelectorAll("tbody tr").forEach(tr => {
      const c = tr.querySelector("td.c[data-key]");
      if (c && c.dataset.key.split("|")[1] === floor) tr.classList.add("hlfloor");
    });
  }
  function hlPart(pid) {
    gridEl.dataset.hp = pid || "";
    gridEl.querySelectorAll(".hlpart").forEach(e => e.classList.remove("hlpart"));
    if (!pid) return;
    gridEl.querySelectorAll(`[data-part="${cssEsc(pid)}"]`).forEach(e => e.classList.add("hlpart"));
  }

  /* ---------- 구역 탭 ---------- */
  function buildZoneTabs() {
    const wrap = document.getElementById("zoneTabs"); wrap.innerHTML = "";
    SEED.zones.forEach(z => {
      const on = enabledZones.has(z);
      const b = document.createElement("button");
      b.textContent = z; b.dataset.z = zoneIdx[z];
      b.className = on ? "active" : "off";
      b.title = (on ? "끄기: " : "켜기: ") + z;
      b.onclick = () => { if (enabledZones.has(z)) enabledZones.delete(z); else enabledZones.add(z); saveZones(); buildZoneTabs(); renderGrid(); };
      wrap.appendChild(b);
    });
    // '전체' = 모든 구역 켜기
    const allOn = enabledZones.size === SEED.zones.length;
    const ab = document.createElement("button");
    ab.textContent = "전체"; ab.className = "zt-all" + (allOn ? " active" : ""); ab.title = "모든 구역 켜기";
    ab.onclick = () => { enabledZones = new Set(SEED.zones); saveZones(); buildZoneTabs(); renderGrid(); gw.scrollTo(0, 0); };
    wrap.appendChild(ab);
  }
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

  /* ---------- 전일대비 ---------- */
  const diffBtn = document.getElementById("diffBtn");
  diffBtn.onclick = () => {
    diffOn = !diffOn; diffBtn.classList.toggle("on", diffOn);
    renderGrid();
    toast(diffOn ? `오늘(${TODAY}) 변경된 설치·간섭 칸 표시` : "전일대비 표시 끔");
  };

  /* ---------- 대시보드 ---------- */
  function blankG() { return { pre: 0, nw: 0, today: 0, tot: 0 }; }
  function statsFor(parts) {
    const s = { duct: blankG(), floor: blankG(), etc: 0, scaffold: 0, notInst: 0, todayChg: 0 };
    parts.forEach(p => SEED.floors.forEach(f => LAYERS.forEach(L => {
      const k = keyOf(p.id, f, L); if (!seedCell[k]) return;
      const c = store.cell(k), st = c.status;
      if (st === "etc_interf") s.etc++; else if (st === "scaffold_interf") s.scaffold++;
      if (c.d === TODAY && DIFF_STATUS.has(st)) s.todayChg++;
      if (WORK_EXCLUDE.has(st)) return;
      const g = L === "바닥" ? s.floor : s.duct; g.tot++;
      if (st === "not_installed") s.notInst++;
      if (L === "바닥") { if (st === "predrill_floor") g.pre++; else if (st === "drill_done") { g.nw++; if (c.d === TODAY) g.today++; } }
      else { if (st === "predrill_duct") g.pre++; else if (st === "install_done") { g.nw++; if (c.d === TODAY) g.today++; } }
    })));
    return s;
  }
  function statsForFloor(floor) {
    const s = { duct: blankG(), floor: blankG() };
    SEED.parts.forEach(p => LAYERS.forEach(L => {
      const k = keyOf(p.id, floor, L); if (!seedCell[k]) return;
      const st = store.cell(k).status; if (WORK_EXCLUDE.has(st)) return;
      const g = L === "바닥" ? s.floor : s.duct; g.tot++;
      if (L === "바닥") { if (st === "predrill_floor") g.pre++; else if (st === "drill_done") g.nw++; }
      else { if (st === "predrill_duct") g.pre++; else if (st === "install_done") g.nw++; }
    }));
    return s;
  }
  const pctOf = (a, b) => b ? Math.round(a / b * 100) : 0;
  const miniBar = (g, cls) => `<div class="db-bar ${cls}"><i class="seg-pre" style="width:${pctOf(g.pre, g.tot)}%"></i><i class="seg-new" style="width:${pctOf(g.nw, g.tot)}%"></i></div>`;
  const rowCell = (g, cls) => `<div class="zc">${miniBar(g, cls)}<span class="zc-n">${pctOf(g.pre + g.nw, g.tot)}% <em>${g.pre + g.nw}/${g.tot}</em></span></div>`;
  function openDash() {
    const all = statsFor(SEED.parts);
    document.getElementById("dashScope").textContent = "전체 현장 · 기준 " + (SEED.updated || "");
    const card = (title, g, cls) => {
      const done = g.pre + g.nw;
      return `<div class="db-card"><div class="db-h">${title}</div>` +
        `<div class="db-big">${pctOf(done, g.tot)}<span>%</span></div>` + miniBar(g, cls) +
        `<div class="db-subn"><b>${done}</b> / ${g.tot} 칸</div>` +
        `<div class="db-split"><span class="pre">기설치 ${g.pre}</span><span class="new">신규완료 ${g.nw}</span><span class="today">금일 ${g.today}</span></div></div>`;
    };
    let html = `<div class="db-cards">` + card("덕트 설치", all.duct, "duct") + card("바닥 타공", all.floor, "floor") + `</div>`;
    html += `<div class="db-mini">` +
      `<div class="db-m"><span class="db-m-n">${all.notInst}</span><span class="db-m-l">미설치 칸</span></div>` +
      `<div class="db-m red"><span class="db-m-n">${all.etc}</span><span class="db-m-l">기타 간섭</span></div>` +
      `<div class="db-m pink"><span class="db-m-n">${all.scaffold}</span><span class="db-m-l">비계 간섭</span></div>` +
      `<div class="db-m amber"><span class="db-m-n">${all.todayChg}</span><span class="db-m-l">오늘 변경</span></div></div>`;
    html += `<div class="db-sec">구역별 진행률 <span class="db-legend"><i class="lp"></i>기설치 <i class="ln"></i>신규완료</span></div>`;
    html += `<table class="db-tbl"><thead><tr><th>구역</th><th>덕트설치</th><th>바닥타공</th></tr></thead><tbody>`;
    SEED.zones.forEach(z => { const s = statsFor(partsByZone[z]); html += `<tr><td class="zname">${z}</td><td>${rowCell(s.duct, "duct")}</td><td>${rowCell(s.floor, "floor")}</td></tr>`; });
    html += `</tbody></table>`;
    html += `<div class="db-sec">층별 진행률</div><table class="db-tbl"><thead><tr><th>층</th><th>덕트설치</th><th>바닥타공</th></tr></thead><tbody>`;
    SEED.floors.forEach(f => { const s = statsForFloor(f); html += `<tr><td class="zname">${f}</td><td>${rowCell(s.duct, "duct")}</td><td>${rowCell(s.floor, "floor")}</td></tr>`; });
    html += `</tbody></table>`;
    document.getElementById("dashBody").innerHTML = html;
    dashModal.classList.remove("hidden");
  }
  document.getElementById("dashBtn").onclick = openDash;

  /* ---------- 변경 이력 (일자별) ---------- */
  let histDate = "all";
  async function openHist() {
    if (!store.cloud()) { toast("변경 이력은 실시간(클라우드) 모드에서만 조회됩니다"); return; }
    const body = document.getElementById("histBody");
    body.innerHTML = `<div class="hist-loading">불러오는 중…</div>`;
    histModal.classList.remove("hidden");
    let rows = [];
    try { rows = await store.loadLog(500); }
    catch (e) { body.innerHTML = `<div class="hist-loading">조회 실패: ${escAttr(e.message)}</div>`; return; }
    renderHist(rows);
  }
  function renderHist(rows) {
    const body = document.getElementById("histBody");
    const dayOf = ts => String(ts || "").slice(0, 10);
    const chip = st => (st == null || st === "")
      ? `<span class="hchip none">—</span>`
      : `<span class="hchip"><span class="sw" style="background:${st === "none" ? "#fff" : (STCOLOR[st] || "#fff")}"></span>${escAttr(STLABEL[st] || st)}</span>`;
    const fmtTime = ts => { const d = new Date(ts); const p = n => String(n).padStart(2, "0"); return `${p(d.getHours())}:${p(d.getMinutes())}`; };
    const cellLabel = key => { const a = String(key).split("|"), p = partById[a[0]]; return `${p ? p.part_no : a[0]} · ${a[1] || ""} · ${a[2] || ""}`; };
    const rowHtml = r =>
      `<div class="hist-row"><span class="ht">${fmtTime(r.ts)}</span>` +
      `<span class="hu">${escAttr(r.user_name || "?")}${r.team ? `<em>(${escAttr(r.team)})</em>` : ""}</span>` +
      `<span class="hc">${escAttr(cellLabel(r.cell_key))}</span>` +
      `<span class="hs">${chip(r.old_status)}<i>→</i>${chip(r.new_status)}</span></div>`;
    const dates = [...new Set(rows.map(r => dayOf(r.ts)).filter(Boolean))].sort().reverse();
    if (histDate !== "all" && dates.indexOf(histDate) < 0) histDate = "all";
    const list = histDate === "all" ? rows : rows.filter(r => dayOf(r.ts) === histDate);
    const opts = `<option value="all">전체 (${rows.length})</option>` +
      dates.map(d => `<option value="${d}"${d === histDate ? " selected" : ""}>${d}${d === TODAY ? " (오늘)" : ""} · ${rows.filter(r => dayOf(r.ts) === d).length}건</option>`).join("");
    let html = `<div class="hist-bar"><label class="hist-datelbl">일자 <select id="histDate">${opts}</select></label><span class="hist-count">${list.length}건</span></div>`;
    if (!list.length) html += `<div class="hist-loading">이력이 없습니다.</div>`;
    else {
      const groups = {}; list.forEach(r => { const d = dayOf(r.ts) || "?"; (groups[d] = groups[d] || []).push(r); });
      html += Object.keys(groups).sort().reverse().map(d =>
        `<div class="hist-day"><span>${d}${d === TODAY ? " (오늘)" : ""}</span><b>${groups[d].length}건</b></div>` +
        `<div class="hist-list">` + groups[d].map(rowHtml).join("") + `</div>`).join("");
    }
    body.innerHTML = html;
    const sel = document.getElementById("histDate"); if (sel) sel.onchange = () => { histDate = sel.value; renderHist(rows); };
  }
  document.getElementById("histBtn").onclick = openHist;

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
  const editorOpen = () => edPart && !editorModal.classList.contains("hidden");
  store.onChange(k => {
    if (k.startsWith("note:")) {
      const nk = k.slice(5);
      if (nk.indexOf("uc:") === 0 || nk.indexOf("dc:") === 0 || nk.indexOf("ucz:") === 0 || nk.indexOf("dcz:") === 0) {
        const up = nk[0] === "u", pid = nk.slice(nk.indexOf(":") + 1);
        const el = gridEl.querySelector(`[data-contact="${cssEsc((up ? "uc:" : "dc:") + pid)}"]`);
        if (el) paintContact(el, up, pid);
      }
      else if (nk.indexOf("fm:") === 0) { const floor = nk.split(":")[2]; const el = gridEl.querySelector(`[data-memo="${cssEsc(floor)}"]`); if (el) el.className = "memo-btn " + (store.note(nk) ? "has-dot" : "empty"); }
      else if (nk.indexOf("lm:") === 0) { const pid = nk.slice(3); const el = gridEl.querySelector(`[data-linememo="${cssEsc(pid)}"]`); if (el) el.className = "memo-btn lm-btn " + (store.note(nk) ? "has-dot" : "empty"); }
      else if (nk.indexOf("ph:") === 0 && editorOpen() && nk === "ph:" + edPart + ":" + edFloor) renderPhotos();
    } else {
      refreshCell(k); buildStatusStrip(currentParts);
      if (editorOpen() && k.indexOf(edPart + "|" + edFloor + "|") === 0) updatePreview();
    }
  });

  /* ---------- 부트 ---------- */
  async function boot() {
    if (SEED.updated) document.getElementById("upd").textContent = "기준 " + SEED.updated;
    if (window.matchMedia("(max-width:760px)").matches) cellPx = 42;   // 모바일 기본 줌 크게
    buildZoneTabs(); setVars(); renderGrid();
    setUserLabel();
    if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase) {
      try {
        store.attach(await cloudBackend()); store.mode = "cloud";
        store.reapplyPending();            // 직전 세션의 미저장분 복원(서버값 덮어쓰기 방지)
        connBase = { text: "실시간", cls: "conn cloud" }; paintConn(); renderGrid();
        store.flush();                     // 미저장분 재전송
      }
      catch (e) { console.error(e); store.attach(localBackend()); connBase = { text: "로컬(연결실패)", cls: "conn err" }; paintConn(); toast("클라우드 연결 실패 → 로컬"); renderGrid(); }
    } else { store.attach(localBackend()); connBase = { text: "로컬", cls: "conn local" }; paintConn(); renderGrid(); }
    window.addEventListener("online", () => { toast("재연결 — 미저장분 저장 중"); store.flush(); });
    setInterval(() => store.flush(), 20000);   // 주기적 재시도
    if (!USER) openLogin();   // 시작 시 로그인 안내(닫으면 읽기 전용)
  }
  boot();
})();
