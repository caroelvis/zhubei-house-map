(() => {
  "use strict";
  const LF = window.L;
  const DATA = window.ZB_DATA;
  const LUX = 4000; // 非豪宅限貸門檻（萬）
  const AGE_ANY = 46;

  const $ = (id) => document.getElementById(id);
  const el = {
    list: $("list"), count: $("count-pill"), sortBy: $("sort-by"), view: $("view-mode"),
    area: $("area-filter"), type: $("type-filter"), pMin: $("price-min"), pMax: $("price-max"), pOut: $("price-out"),
    maMin: $("ma-min"), maOut: $("ma-out"), ageMax: $("age-max"), ageOut: $("age-out"), q: $("q"),
    under: $("under4000"), se: $("se-only"), hideFlag: $("hide-flag"), lines: $("show-lines"), reset: $("reset"),
    showR: $("show-resale"), showP: $("show-presale"), showX: $("show-extra"), preNote: $("pre-note"),
  };

  const units = DATA.units.map((u) => ({ ...u, ppm: u.price && u.ma ? u.price / u.ma : null }));
  const comms = new Map(DATA.communities.map((c) => [c.key, { ...c, units: units.filter((u) => u.g === c.key) }]));
  // 預售圖層：projects（2026 清單＋坤德知之＋參考案）、extras（樂居其他新案，預設隱藏）
  const PRE = (DATA.presale && DATA.presale.projects) || [];
  const PEXT = (DATA.presale && DATA.presale.extras) || [];
  const pres = new Map([...PRE, ...PEXT].map((p) => [p.key, p]));
  const isP = (k) => pres.has(k);
  const state = { visible: [], byComm: new Map(), pVisible: [], pSet: new Set(), activeKey: null, markers: new Map(), map: null, linesLayer: null };

  // ---------- formatting ----------
  const nf = (n, d = 0) => (n == null ? "—" : Number(n).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const ping = (n) => (n == null ? "—" : Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 2 }));
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const priceCls = (p) => (p < LUX ? "green" : "orange");
  function rangeTxt(list) {
    const ps = list.map((u) => u.price);
    const lo = Math.min(...ps), hi = Math.max(...ps);
    return lo === hi ? `${nf(lo)}萬` : `${nf(lo)}–${nf(hi)}萬`;
  }
  function colorOf(list) {
    const lo = list.some((u) => u.price < LUX), hi = list.some((u) => u.price >= LUX);
    return lo && hi ? "mixed" : lo ? "green" : "orange";
  }
  const shortName = (n) => String(n).split("/")[0];
  function flagBadges(flags) {
    return (flags || []).map((f) => `<span class="badge ${f === "資料存疑" ? "badge-doubt" : "badge-office"}" title="${
      f === "辦公室" ? "刊登標題為辦公室，非住宅" : f === "疑似非住宅" ? "住辦混合／住店，可能非純住宅" : "主建物／型態等數字疑有誤（見備註）"}">${esc(f)}</span>`).join("");
  }
  const commFlags = (list) => [...new Set(list.flatMap((u) => u.flags))];

  // ---------- filtering & sorting ----------
  function readFilters() {
    let lo = +el.pMin.value, hi = +el.pMax.value;
    if (lo > hi) [lo, hi] = [hi, lo];
    return {
      area: el.area.value, type: el.type.value, lo, hi, ma: +el.maMin.value, age: +el.ageMax.value,
      q: el.q.value.trim().toLowerCase(), under: el.under.checked, se: el.se.checked, hideFlag: el.hideFlag.checked,
      // 滑桿在最左／最右端 = 不設限（待售資料本身都在 3,000–4,500 萬、主+附≥32 坪內，對待售無影響）
      loOpen: lo <= +el.pMin.min, hiOpen: hi >= +el.pMax.max, maOpen: +el.maMin.value <= +el.maMin.min,
      showR: !el.showR || el.showR.checked, showP: !el.showP || el.showP.checked, showX: !!(el.showX && el.showX.checked),
    };
  }
  // 預售篩選：總價以區間重疊判斷、未知不篩；主+附只在已知（估算上限或坤德知之室內）時套用；屋齡、資料旗標不適用
  function passP(p, f) {
    if (p.cat === "X" ? !f.showX : !f.showP) return false;
    if (f.area !== "all" && p.area !== f.area) return false;
    if (f.type !== "all" && p.type !== f.type) return false;
    if (p.tMin != null) {
      const lo = f.loOpen ? -Infinity : f.lo, hi = f.hiOpen ? Infinity : f.hi;
      if (p.tMax < lo || p.tMin > hi) return false;
    }
    if (!f.maOpen && p.maEst != null && p.maEst < f.ma) return false;
    if (f.under && p.tMin != null && p.tMin >= LUX) return false;
    if (f.se && !p.seIn) return false;
    if (f.q && !`${p.name} ${p.alias || ""} ${p.address} ${p.developer || ""} ${p.zone} ${p.area} 預售`.toLowerCase().includes(f.q)) return false;
    return true;
  }
  function pass(u, f) {
    if (f.area !== "all" && u.area !== f.area) return false;
    if (f.type !== "all" && u.type !== f.type) return false;
    if (u.price < f.lo || u.price > f.hi) return false;
    if ((u.ma ?? 0) < f.ma) return false;
    if (f.age < AGE_ANY && (u.age == null || u.age > f.age)) return false;
    if (f.under && u.price >= LUX) return false;
    if (f.se && !u.se) return false;
    if (f.hideFlag && u.flags.length) return false;
    if (f.q && !`${u.community} ${u.road} ${u.title} ${u.area}`.toLowerCase().includes(f.q)) return false;
    return true;
  }
  function sortSpec() {
    const [field, dir] = el.sortBy.value.split("-");
    return { field, mult: dir === "asc" ? 1 : -1 };
  }
  function cmpUnits(a, b) {
    const { field, mult } = sortSpec();
    const av = a[field], bv = b[field];
    if (av == null && bv == null) return a.price - b.price;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * mult || a.price - b.price;
  }

  function applyFilters() {
    const f = readFilters();
    el.pOut.textContent = `${nf(f.lo)}–${nf(f.hi)}`;
    el.maOut.textContent = el.maMin.value;
    el.ageOut.textContent = f.age >= AGE_ANY ? "不限" : `${f.age} 年`;
    state.visible = f.showR ? units.filter((u) => pass(u, f)).sort(cmpUnits) : [];
    state.pVisible = [...pres.values()].filter((p) => passP(p, f));
    state.pSet = new Set(state.pVisible.map((p) => p.key));
    state.byComm = new Map();
    state.visible.forEach((u) => {
      if (!state.byComm.has(u.g)) state.byComm.set(u.g, []);
      state.byComm.get(u.g).push(u);
    });
    const withCoord = [...state.byComm.keys()].filter((k) => comms.get(k).lat != null).length;
    const nP = state.pVisible.filter((p) => p.cat !== "X").length, nX = state.pVisible.length - nP;
    el.count.textContent = `待售 ${state.byComm.size} 社區／${state.visible.length} 筆（共 ${comms.size} 社區、${units.length} 筆）· 預售 ${nP} 案（共 ${PRE.length}）${f.showX ? ` · 樂居其他新案 ${nX}／${PEXT.length}` : ""} · 地圖標記 ${withCoord + state.pVisible.length}`;
    if (el.preNote) {
      const unk = state.pVisible.filter((p) => p.tMin == null).length;
      const parts = [];
      if (f.showP || f.showX) {
        parts.push(`預售：總價以區間重疊判斷${f.loOpen || f.hiOpen ? "，滑桿在端點視為不設限" : ""}`);
        if (unk) parts.push(`${unk} 案總價未知，不套用總價篩選`);
        parts.push(f.maOpen ? "主+附下限在最小值時不篩預售" : "主+附只篩有估算值者");
      }
      el.preNote.textContent = parts.join("；");
    }
    syncMarkers();
    renderList();
  }

  // ---------- markers ----------
  function iconFor(c, list, active, mode = "full") {
    const cls = [ "ptag", colorOf(list), active ? "active" : "", commFlags(list).length ? "flagged" : "" ].join(" ");
    if (mode === "dot") {
      return LF.divIcon({
        className: "tag-icon", iconSize: [0, 0], iconAnchor: [0, 0],
        html: `<div class="pdot ${colorOf(list)}${active ? " active" : ""}" title="${esc(c.name)} ${rangeTxt(list)}">${list.length > 1 ? list.length : ""}</div>`,
      });
    }
    const showName = mode === "full";
    return LF.divIcon({
      className: "tag-icon", iconSize: [0, 0], iconAnchor: [0, 0],
      html: `<div class="${cls}" title="${esc(c.name)}">${showName ? `<span class="pn">${esc(shortName(c.name))}</span>` : ""}<span class="pp${showName ? "" : " solo"}">${rangeTxt(list)}${list.length > 1 ? `<span class="pc">${list.length}</span>` : ""}</span></div>`,
    });
  }
  // 依縮放等級估算標籤大小，重疊者改為小圓點（滑鼠移上可見名稱），避免互相遮蓋
  function labelBox(c, list, mode) {
    const nameW = mode === "full" ? Math.min(170, [...shortName(c.name)].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 12.5 : 7), 0)) + 18 : 0;
    const priceW = rangeTxt(list).length * 7.4 + 18 + (list.length > 1 ? 18 : 0);
    return { w: nameW + priceW, h: 28 };
  }
  function declutter() {
    const z = state.map.getZoom();
    const mode = z >= 15 ? "full" : "price";
    const keys = [...state.markers.keys()].filter((k) => state.byComm.has(k) || state.pSet.has(k));
    const prio = (k) => (k === state.activeKey ? 0 : isP(k) && pres.get(k).star ? 1 : isP(k) && pres.get(k).cat !== "X" ? 2 : !isP(k) ? 3 : 4);
    keys.sort((a, b) => prio(a) - prio(b) || (isP(a) || isP(b) ? 0 : state.byComm.get(b).length - state.byComm.get(a).length || Math.min(...state.byComm.get(a).map((u) => u.price)) - Math.min(...state.byComm.get(b).map((u) => u.price))));
    const placed = [];
    const modes = new Map();
    keys.forEach((k) => {
      const c = isP(k) ? pres.get(k) : comms.get(k), list = state.byComm.get(k);
      const p = state.map.latLngToLayerPoint([c.lat, c.lng]);
      const { w, h } = isP(k) ? labelBoxP(c, mode) : labelBox(c, list, mode);
      const r = { x1: p.x - w / 2 - 2, x2: p.x + w / 2 + 2, y1: p.y - h - 9, y2: p.y + 1 };
      const hit = placed.some((q) => r.x1 < q.x2 && r.x2 > q.x1 && r.y1 < q.y2 && r.y2 > q.y1);
      if (!hit || k === state.activeKey || (isP(k) && c.star)) { placed.push(r); modes.set(k, mode); }
      else modes.set(k, "dot");
    });
    state.modes = modes;
  }
  // ---------- 預售標記 ----------
  const r1 = (n) => (n == null ? "—" : Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 1 }));
  const rng = (a, b, unit = "", fmt = r1) => (a == null ? null : a === b || b == null ? `${fmt(a)}${unit}` : `${fmt(a)}–${fmt(b)}${unit}`);
  const kindShort = (k) => (k === "實登" ? "" : k === "開價" || k === "樂居開價" ? "開價 " : k === "推估" ? "推估 " : k ? "樂居 " : "");
  const pCls = (p) => (p.star ? "pre-star" : p.cat === "X" ? "pre-x" : p.uKind === "實登" ? "pre-lvr" : "pre-ask");
  function pLabel(p, short = false) {
    const u = rng(p.uMin, p.uMax, "萬/坪");
    const t = rng(p.tMin, p.tMax, "萬", nf);
    const parts = [];
    if (u) parts.push(kindShort(p.uKind) + u);
    if (t && (!short || !u)) parts.push((u && p.tKind === p.uKind ? "" : kindShort(p.tKind)) + "總" + t);
    return parts.length ? parts.join(" · ") : "未開價";
  }
  const pTag = (p) => (p.cat === "X" ? "新案" : p.star ? "★預售" : "預售");
  function iconForP(p, active, mode = "full") {
    const cls = ["ptag", "pre", pCls(p), active ? "active" : ""].join(" ");
    if (mode === "dot") {
      return LF.divIcon({ className: "tag-icon", iconSize: [0, 0], iconAnchor: [0, 0],
        html: `<div class="pdot pre ${pCls(p)}${active ? " active" : ""}" title="${esc(pTag(p))} ${esc(p.name)} ${esc(pLabel(p))}">${p.star ? "★" : "預"}</div>` });
    }
    const showName = mode === "full" || p.star;
    return LF.divIcon({ className: "tag-icon", iconSize: [0, 0], iconAnchor: [0, 0],
      html: `<div class="${cls}" title="${esc(pTag(p))} ${esc(p.name)}"><span class="pk">${esc(pTag(p))}</span>${showName ? `<span class="pn">${esc(p.name)}</span>` : ""}<span class="pp">${esc(pLabel(p, !showName))}</span></div>` });
  }
  function labelBoxP(p, mode) {
    const w = (str) => [...str].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 12.5 : 7), 0);
    const showName = mode === "full" || p.star;
    return { w: w(pTag(p)) + 14 + (showName ? Math.min(170, w(p.name)) + 16 : 0) + w(pLabel(p, !showName)) * 0.95 + 16, h: 28 };
  }
  const luxTxt = { all: "全部≥4,000萬", typical: "多數≥4,000萬", some: "部分戶別≥4,000萬", none: "<4,000萬", unknown: "總價未知" };
  function luxBadge(p) {
    if (p.lux === "all" || p.lux === "typical") return `<span class="badge badge-lux" title="新竹縣總價≥4,000萬為高價住宅：貸款上限3成、無寬限期">豪宅限貸·${luxTxt[p.lux]}</span>`;
    if (p.lux === "some") return `<span class="badge badge-lux-some" title="新竹縣總價≥4,000萬為高價住宅：貸款上限3成、無寬限期">部分戶≥4,000萬</span>`;
    return "";
  }
  function main30Badge(p) {
    if (p.main30Flag === "yes") return '<span class="badge badge-main30">主建物>30坪</span>';
    if (p.main30Flag === "maybe") return '<span class="badge badge-main30 maybe">可能主建物>30坪</span>';
    return "";
  }
  const linkTxt = (p) => (p.linkKind === "樂居社區頁" ? "樂居" : "591");
  function popupHtmlP(p) {
    const isLeju = p.linkKind === "樂居社區頁";
    const per = p.period ? `${p.period[0]} ～ ${p.period[1]}` : "";
    const exc = Object.entries(p.excluded || {}).map(([k, v]) => `${k}${v}`).join("、");
    const row = (k, v) => (v == null || v === "" ? "" : `<tr><th>${k}</th><td>${v}</td></tr>`);
    const uTxt = p.uMin == null ? "未公開" : `${rng(p.uMin, p.uMax, " 萬/坪")}${p.uMed != null ? `（中位 ${r1(p.uMed)}）` : ""} <span class="kind k-${esc(p.uKind)}">${esc(p.uKind)}</span>`;
    const tTxt = p.tMin == null ? "未公開" : `${rng(p.tMin, p.tMax, " 萬", nf)}${p.tMed != null ? `（中位 ${nf(p.tMed)}）` : ""} <span class="kind k-${esc(p.tKind)}">${esc(p.tKind)}</span>${p.cat !== "X" ? "（含車位）" : ""}`;
    const pingTxt = p.pingMin != null ? `權狀（不含車位）${rng(p.pingMin, p.pingMax, " 坪")}${p.pingMed != null ? `，中位 ${r1(p.pingMed)}` : ""}` : "";
    const park = p.parkMin != null ? rng(p.parkMin, p.parkMax, " 萬", nf) : p.parkText || "";
    const nTxt = p.cat === "X" ? (p.n ? `樂居顯示 ${p.n} 筆交易` : "") : p.n ? `${p.n} 筆有效（原始 ${p.nTotal} 筆${exc ? `，排除 ${exc}` : ""}）· 交易日 ${per}` : "尚無實價登錄";
    const unitsTbl = p.units ? `<table class="units ptable-units"><thead><tr><th>戶型</th><th>權狀</th><th>主建物</th><th>陽台</th><th>室內</th><th>推估總價</th></tr></thead><tbody>${p.units.map((x) => `<tr title="${esc(x.estNote)}"><td>${x.u}</td><td>${ping(x.own)}</td><td class="${x.main > 30 ? "hi" : ""}">${ping(x.main)}</td><td>${ping(x.bal)}</td><td>≈${ping(x.inner)}</td><td>${esc(x.est)}</td></tr>`).join("")}</tbody></table><div class="hidden-note">室內 = 主建物 + 陽台；表中數字皆為推估（滑鼠移到列上看算法）</div>` : "";
    const se = p.seIn ? `<span class="tag tag-se">莊敬南路以東、光明六路以南${p.seEdge ? "（臨界）" : ""}</span>` : "";
    return `
      <div class="pop-title">${p.star ? '<span class="star">★</span>' : ""}${esc(p.name)}${p.alias ? `<span class="alias">${esc(p.alias)}</span>` : ""}</div>
      <div class="pop-sub">
        <span class="badge badge-pre ${pCls(p)}">${esc(pTag(p))}</span><span class="tag">${esc(p.catLabel)}</span>
        <span class="tag tag-area">${esc(p.area)}</span>${se}${luxBadge(p)}${main30Badge(p)}
      </div>
      <a class="btn-leju${isLeju ? "" : " btn-591"}" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">${isLeju ? "在樂居開啟（社區頁）" : `樂居查無此案 · 改開 ${esc(p.linkKind)}`} ↗</a>
      <div class="pop-scroll">
      <table class="pinfo"><tbody>
        ${row("建商", esc(p.developer || p.lejuDev || "—"))}
        ${row("位置", esc(`${p.address}${p.zone && p.zone !== p.area ? `（${p.zone}）` : ""}`))}
        ${row("規模", esc(p.floorsUnits))}
        ${row("單價", uTxt)}
        ${row("總價", tTxt)}
        ${row("車位", esc(park))}
        ${row("格局", esc(p.rooms))}
        ${row("坪數", esc(pingTxt))}
        ${row("主+附估算", p.maEst != null && !p.units ? `上限約 ${r1(p.maEst)} 坪（權狀×(1−公設比${p.publicRatio != null ? Math.round(p.publicRatio * 1000) / 10 + "%" : ""})，含陽台）` : "")}
        ${row("成交", esc(nTxt))}
        ${row("完工", esc(p.done || "未知"))}
        ${row("開賣", esc(p.launch))}
        ${row("主建物>30坪", esc(p.main30))}
        ${row("4,000萬門檻", `${esc(luxTxt[p.lux] || "")}${p.luxNote ? "：" + esc(p.luxNote) : ""}${p.lux === "all" || p.lux === "typical" || p.lux === "some" ? '<div class="lux-note">新竹縣總價 ≥ 4,000 萬屬高價住宅：貸款最多 3 成、無寬限期</div>' : ""}`)}
        ${row("備註", esc(p.notes))}
      </tbody></table>
      ${unitsTbl}
      </div>
      <div class="hidden-note">單價：萬/坪（權狀、不含車位${p.cat === "X" ? "；樂居其他新案為樂居頁標題之價格，算法可能不同" : ""}）· 座標：${esc(p.loc)} · 連結：${esc(p.linkKind)}${p.sources && p.sources.length ? ` · 其他來源：${p.sources.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${i + 1}</a>`).join(" ")}` : ""}</div>`;
  }

  function popupHtml(c) {
    const list = state.byComm.get(c.key) || [];
    const hiddenN = c.units.length - list.length;
    const area = [...new Set(c.units.map((u) => u.area))].join("、");
    const seN = c.units.filter((u) => u.se).length;
    const edge = c.units.some((u) => u.se && /臨界/.test(u.seJudge));
    const rows = list.map((u) => `
      <tr class="unit-row" data-url="${esc(u.url)}" title="${esc(u.title)}">
        <td><a class="p-${priceCls(u.price)}" href="${esc(u.url)}" target="_blank" rel="noopener noreferrer">${nf(u.price)}萬</a></td>
        <td>${ping(u.ma)}</td><td>${ping(u.main)}</td><td>${ping(u.own)}</td>
        <td>${esc(u.floor || "—")}</td><td>${u.rooms ?? "—"}</td><td>${u.age == null ? "—" : nf(u.age, 1)}</td>
        <td>${u.ppm == null ? "—" : nf(u.ppm, 1)}</td>
        <td class="flagcell">${flagBadges(u.flags)}</td>
      </tr>`).join("");
    const isComm = c.lejuKind === "社區頁";
    return `
      <div class="pop-title">${esc(c.name)}</div>
      <div class="pop-sub">
        <span class="tag tag-area">${esc(area)}</span>
        ${seN ? `<span class="tag tag-se">莊敬南路以東、光明六路以南${edge ? "（臨界）" : ""}</span>` : ""}
        <span>${list.length ? rangeTxt(list) : ""} · ${list.length} 筆</span>
        ${flagBadges(commFlags(c.units))}
      </div>
      <a class="btn-leju" href="${esc(c.lejuUrl)}" target="_blank" rel="noopener noreferrer">在樂居開啟${isComm ? "（社區頁）" : "（最低價物件）"} ↗</a>
      ${isComm ? `<div class="pop-alt">或直接看 <a href="${esc(c.cheapestUrl)}" target="_blank" rel="noopener noreferrer">最低總價物件 ↗</a>；點下表任一列開啟該物件</div>` : `<div class="pop-alt">點下表任一列開啟該物件</div>`}
      <div class="pop-scroll">
      <table class="units">
        <thead><tr><th>總價</th><th>主+附</th><th>主建物</th><th>權狀</th><th>樓層</th><th>房</th><th>屋齡</th><th>單坪</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${hiddenN > 0 ? `<div class="hidden-note">另有 ${hiddenN} 筆被目前篩選條件隱藏</div>` : ""}
      <div class="hidden-note">坪數單位：坪；單坪 = 總價 ÷ 主+附（萬/坪，含車位價）</div>`;
  }

  function buildMarkers() {
    comms.forEach((c) => {
      if (c.lat == null) return;
      const m = LF.marker([c.lat, c.lng], { icon: iconFor(c, c.units, false), title: c.name, riseOnHover: true, riseOffset: 5000 });
      m.bindPopup(() => popupHtml(c), { maxWidth: 560, minWidth: 380, autoPanPadding: [30, 30] });
      m.on("click", () => select(c.key, { fromMap: true }));
      m.on("popupclose", () => { if (state.activeKey === c.key) { state.activeKey = null; refreshIcons(); highlightList(); } });
      state.markers.set(c.key, m);
    });
    pres.forEach((p) => {
      const m = LF.marker([p.lat, p.lng], { icon: iconForP(p, false), title: p.name, riseOnHover: true, riseOffset: 5000 });
      m.bindPopup(() => popupHtmlP(p), { maxWidth: 520, minWidth: 360, autoPanPadding: [30, 30] });
      m.on("click", () => select(p.key, { fromMap: true }));
      m.on("popupclose", () => { if (state.activeKey === p.key) { state.activeKey = null; refreshIcons(); highlightList(); } });
      state.markers.set(p.key, m);
    });
    const pts = [...comms.values()].filter((c) => c.lat != null).map((c) => [c.lat, c.lng]).concat(PRE.map((p) => [p.lat, p.lng]));
    if (pts.length) state.map.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
  }
  function refreshIcons() {
    if (!state.markers.size) return;
    declutter();
    state.markers.forEach((m, k) => {
      if (isP(k)) {
        if (!state.pSet.has(k)) return;
        const p = pres.get(k), mode = state.modes.get(k) || "full";
        m.setIcon(iconForP(p, k === state.activeKey, mode));
        m.setZIndexOffset(k === state.activeKey ? 20000 : p.star ? 15000 : mode === "dot" ? -1000 : 500);
        return;
      }
      const list = state.byComm.get(k);
      if (!list) return;
      const mode = state.modes.get(k) || "full";
      m.setIcon(iconFor(comms.get(k), list, k === state.activeKey, mode));
      m.setZIndexOffset(k === state.activeKey ? 20000 : mode === "dot" ? -1000 : 0);
    });
  }
  function syncMarkers() {
    state.markers.forEach((m, k) => {
      const show = isP(k) ? state.pSet.has(k) : state.byComm.has(k);
      if (show && !state.map.hasLayer(m)) m.addTo(state.map);
      if (!show && state.map.hasLayer(m)) { m.closePopup(); state.map.removeLayer(m); }
      if (show && m.isPopupOpen() && !isP(k)) m.setPopupContent(popupHtml(comms.get(k)));
    });
    refreshIcons();
  }

  // ---------- list ----------
  function commCard(c, list) {
    const area = [...new Set(list.map((u) => u.area))].join("、");
    const se = list.some((u) => u.se), edge = list.some((u) => u.se && /臨界/.test(u.seJudge));
    const rows = list.map((u) => `
      <tr class="unit-row" data-url="${esc(u.url)}" title="${esc(u.title)}">
        <td><a class="p-${priceCls(u.price)}" href="${esc(u.url)}" target="_blank" rel="noopener noreferrer" data-stop>${nf(u.price)}萬</a></td>
        <td>${ping(u.ma)}</td><td>${ping(u.main)}</td><td>${ping(u.own)}</td><td>${esc(u.floor || "—")}</td>
        <td>${u.rooms ?? "—"}</td><td>${u.age == null ? "—" : nf(u.age, 1)}</td><td>${u.ppm == null ? "—" : nf(u.ppm, 1)}</td>
      </tr>`).join("");
    return `
      <article class="ccard${state.activeKey === c.key ? " active" : ""}" data-key="${esc(c.key)}" tabindex="0">
        <div class="ccard-head">
          <h2 class="cname"><a href="${esc(c.lejuUrl)}" target="_blank" rel="noopener noreferrer" data-stop title="在樂居開啟${esc(c.lejuKind)}">${esc(c.name)}<span class="ext">↗樂居</span></a></h2>
          <span class="crange ${colorOf(list)}">${rangeTxt(list)}</span>
        </div>
        <div class="cmeta">
          <span class="tag tag-area">${esc(area)}</span>
          <span class="tag">${list.length} 筆${c.units.length > list.length ? `／共 ${c.units.length}` : ""}</span>
          ${se ? `<span class="tag tag-se">東南側${edge ? "·臨界" : ""}</span>` : ""}
          ${c.lat == null ? '<span class="badge badge-nocoord">無座標</span>' : ""}
          ${flagBadges(commFlags(list))}
        </div>
        <table class="units">
          <thead><tr><th>總價</th><th>主+附</th><th>主建物</th><th>權狀</th><th>樓層</th><th>房</th><th>屋齡</th><th>單坪</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </article>`;
  }
  function unitCard(u) {
    const c = comms.get(u.g);
    return `
      <article class="ucard${state.activeKey === u.g ? " active" : ""}" data-key="${esc(u.g)}" tabindex="0">
        <div class="ucard-top">
          <h2 class="cname"><a href="${esc(c.lejuUrl)}" target="_blank" rel="noopener noreferrer" data-stop title="在樂居開啟${esc(c.lejuKind)}">${esc(u.community)}<span class="ext">↗樂居</span></a></h2>
          <a class="uprice ${priceCls(u.price)}" href="${esc(u.url)}" target="_blank" rel="noopener noreferrer" data-stop>${nf(u.price)}萬 ↗</a>
        </div>
        <div class="cmeta">
          <span class="tag tag-area">${esc(u.area)}</span><span class="tag">${esc(u.type)}</span>
          <span class="tag">${esc(u.layout || "格局未提供")}</span><span class="tag">${esc(u.floor)}</span>
          ${u.se ? `<span class="tag tag-se">東南側${/臨界/.test(u.seJudge) ? "·臨界" : ""}</span>` : ""}
          ${u.lat == null ? '<span class="badge badge-nocoord">無座標</span>' : ""}
          ${flagBadges(u.flags)}
        </div>
        <div class="ugrid">
          <div><span>主+附</span><b>${ping(u.ma)} 坪</b></div>
          <div><span>主建物</span><b>${ping(u.main)} 坪</b></div>
          <div><span>權狀</span><b>${ping(u.own)} 坪</b></div>
          <div><span>屋齡</span><b>${u.age == null ? "—" : nf(u.age, 1) + " 年"}</b></div>
          <div><span>單坪(主+附)</span><b>${u.ppm == null ? "—" : nf(u.ppm, 1) + " 萬"}</b></div>
          <div><span>附屬</span><b>${ping(u.annex)} 坪</b></div>
          <div><span>公設</span><b>${ping(u.common)}</b></div>
          <div><span>車位</span><b>${esc(u.parkType || "—")}</b></div>
        </div>
        <div class="utitle" title="${esc(u.note)}">${esc(u.title)}</div>
      </article>`;
  }
  function presaleCard(p) {
    const u = rng(p.uMin, p.uMax, "萬/坪");
    const t = rng(p.tMin, p.tMax, "萬", nf);
    return `
      <article class="ccard pcard ${pCls(p)}${state.activeKey === p.key ? " active" : ""}" data-key="${esc(p.key)}" tabindex="0">
        <div class="ccard-head">
          <h2 class="cname"><a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer" data-stop title="開啟${esc(p.linkKind)}">${p.star ? '<span class="star">★</span>' : ""}${esc(p.name)}<span class="ext">↗${linkTxt(p)}</span></a></h2>
          <span class="crange pre">${u ? `${esc(kindShort(p.uKind))}${u}` : t ? `${esc(kindShort(p.tKind))}${t}` : "未開價"}</span>
        </div>
        <div class="cmeta">
          <span class="badge badge-pre ${pCls(p)}">${esc(pTag(p))}</span>
          <span class="tag">${esc(p.catLabel)}</span>
          <span class="tag tag-area">${esc(p.area)}</span>
          ${p.seIn ? `<span class="tag tag-se">東南側${p.seEdge ? "·臨界" : ""}</span>` : ""}
          ${luxBadge(p)}${main30Badge(p)}
          ${p.linkKind !== "樂居社區頁" ? `<span class="badge badge-nocoord" title="樂居查無此案頁面">連 591</span>` : ""}
        </div>
        <div class="ugrid pgrid">
          <div><span>總價${p.tKind && p.tKind !== "實登" ? `(${esc(p.tKind)})` : ""}</span><b>${t || "—"}</b></div>
          <div><span>單價${p.uMed != null ? "中位" : ""}</span><b>${p.uMed != null ? r1(p.uMed) + " 萬" : u || "—"}</b></div>
          <div><span>坪數(權狀)</span><b>${rng(p.pingMin, p.pingMax, " 坪") || "—"}</b></div>
          <div><span>${p.cat === "X" ? "樂居交易" : "實登筆數"}</span><b>${p.n || 0}</b></div>
        </div>
        <div class="utitle">${esc([p.developer, p.rooms, p.done ? "完工 " + p.done : ""].filter(Boolean).join(" · "))}</div>
      </article>`;
  }
  // 預售在排序中的對應值（單坪價定義不同 → 排最後）
  function pSortVal(p, field, mult) {
    if (field === "price") return mult > 0 ? p.tMin : p.tMax;
    if (field === "ma") return p.units ? Math.max(...p.units.map((x) => x.inner)) : p.maEst;
    if (field === "age") return 0;
    return null;
  }
  function mergeSorted(rItems) {
    const { field, mult } = sortSpec();
    const pItems = state.pVisible.map((p) => ({ v: pSortVal(p, field, mult), html: () => presaleCard(p), p: true, star: !!p.star }));
    const out = []; let i = 0;
    // 待售保持原順序；預售依值插入（null 置後；坤德知之在同值時優先）
    pItems.sort((a, b) => (a.v == null) - (b.v == null) || (a.v - b.v) * mult || b.star - a.star);
    pItems.forEach((pi) => {
      if (pi.v == null) return;
      while (i < rItems.length && rItems[i].v != null && (rItems[i].v - pi.v) * mult <= 0) out.push(rItems[i++]);
      out.push(pi);
    });
    while (i < rItems.length) out.push(rItems[i++]);
    pItems.filter((x) => x.v == null).forEach((x) => out.push(x));
    return out.map((x) => x.html()).join("");
  }
  function renderList() {
    if (!state.visible.length && !state.pVisible.length) { el.list.innerHTML = '<p class="empty">沒有符合條件的物件，請調整篩選條件或圖層。</p>'; return; }
    const { field } = sortSpec();
    if (el.view.value === "unit") { el.list.innerHTML = mergeSorted(state.visible.map((u) => ({ v: u[field], html: () => unitCard(u) }))); return; }
    // community mode: order by each community's first unit (already sorted)
    el.list.innerHTML = mergeSorted([...state.byComm.entries()].map(([k, list]) => ({ v: list[0][field], html: () => commCard(comms.get(k), list) })));
  }
  function highlightList() {
    el.list.querySelectorAll("[data-key]").forEach((n) => n.classList.toggle("active", n.dataset.key === state.activeKey));
  }

  function select(key, { fromMap = false } = {}) {
    state.activeKey = key;
    refreshIcons();
    highlightList();
    const card = el.list.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const m = state.markers.get(key);
    if (m && !fromMap) {
      state.map.setView(m.getLatLng(), Math.max(state.map.getZoom(), 15), { animate: true });
      m.openPopup();
    }
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const tr = e.target.closest("tr.unit-row[data-url]");
    if (tr && !e.target.closest("a")) { window.open(tr.dataset.url, "_blank", "noopener"); e.stopPropagation(); return; }
  }, true);
  el.list.addEventListener("click", (e) => {
    if (e.target.closest("[data-stop]") || e.target.closest("tr.unit-row")) return;
    const card = e.target.closest("[data-key]");
    if (card) select(card.dataset.key);
  });
  el.list.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const card = e.target.closest("[data-key]");
    if (card) { e.preventDefault(); select(card.dataset.key); }
  });

  function initControls() {
    const cntTxt = (nR, nP) => (nP ? `待售 ${nR}／預售 ${nP}` : `${nR}`);
    const areas = [...new Set(units.map((u) => u.area).concat(PRE.map((p) => p.area)))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    areas.forEach((a) => el.area.insertAdjacentHTML("beforeend", `<option value="${esc(a)}">${esc(a)}（${cntTxt(units.filter((u) => u.area === a).length, PRE.filter((p) => p.area === a).length)}）</option>`));
    const types = [...new Set(units.map((u) => u.type).concat(PRE.map((p) => p.type)))];
    types.forEach((t) => el.type.insertAdjacentHTML("beforeend", `<option value="${esc(t)}">${esc(t)}（${cntTxt(units.filter((u) => u.type === t).length, PRE.filter((p) => p.type === t).length)}）</option>`));
    const maxMa = Math.ceil(Math.max(...units.map((u) => u.ma || 0)));
    el.maMin.max = String(Math.min(maxMa, 70));
    [el.sortBy, el.view, el.area, el.type, el.under, el.se, el.hideFlag, el.showR, el.showP, el.showX].filter(Boolean).forEach((n) => n.addEventListener("change", applyFilters));
    [el.pMin, el.pMax, el.maMin, el.ageMax, el.q].forEach((n) => n.addEventListener("input", applyFilters));
    el.lines.addEventListener("change", () => (el.lines.checked ? state.linesLayer.addTo(state.map) : state.map.removeLayer(state.linesLayer)));
    el.reset.addEventListener("click", () => {
      el.area.value = "all"; el.type.value = "all"; el.pMin.value = 3000; el.pMax.value = 4500; el.maMin.value = 32;
      el.ageMax.value = AGE_ANY; el.q.value = ""; el.under.checked = false; el.se.checked = false; el.hideFlag.checked = false;
      if (el.showR) { el.showR.checked = true; el.showP.checked = true; el.showX.checked = false; }
      applyFilters();
    });
  }

  function initMap() {
    state.map = LF.map("map", { zoomControl: true }).setView([24.82, 121.02], 14);
    LF.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · 資料：樂居、內政部實價登錄、591',
    }).addTo(state.map);
    const L2 = DATA.lines;
    const g = LF.layerGroup();
    const main = { color: "#1d4f8a", weight: 4, opacity: 0.8, dashArray: "10 8" };
    const ext = { color: "#1d4f8a", weight: 2.5, opacity: 0.55, dashArray: "2 7" };
    LF.polyline(L2.zj, main).bindTooltip("莊敬南路（以東）", { permanent: true, direction: "right", className: "line-label" }).addTo(g);
    LF.polyline(L2.gm, main).bindTooltip("光明六路（以南）", { permanent: true, direction: "top", className: "line-label" }).addTo(g);
    L2.zjExt.concat(L2.gmExt).forEach((seg) => LF.polyline(seg, ext).bindTooltip("延伸線（判定用）").addTo(g));
    state.linesLayer = g.addTo(state.map);
    state.map.on("zoomend", () => refreshIcons());
  }

  function boot() {
    if (!LF) { el.list.innerHTML = '<p class="empty">無法載入 Leaflet 地圖函式庫，請檢查網路連線。</p>'; }
    if (!DATA) { el.list.innerHTML = '<p class="empty">找不到資料（data.js）。</p>'; return; }
    initControls();
    if (LF) { initMap(); buildMarkers(); }
    else { state.map = { hasLayer: () => false, getContainer: () => document.body }; }
    applyFilters();
    if (LF) { setTimeout(() => state.map.invalidateSize(), 50); window.addEventListener("resize", () => state.map.invalidateSize()); }
    window.__ZB = { state, units, comms, pres };
    // 深層連結：#c=社區名（部分字串即可）開啟該社區
    const m = decodeURIComponent(location.hash || "").match(/^#c=(.+)$/);
    if (m && LF) {
      const hit = [...comms.values()].find((c) => c.name.includes(m[1])) || [...pres.values()].find((p) => p.name.includes(m[1]));
      if (hit) setTimeout(() => select(hit.key), 300);
    }
  }
  boot();
})();
