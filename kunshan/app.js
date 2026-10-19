(function () {
  'use strict';
  var D = window.KS_DATA;
  var P = D.projects, L = D.listings;
  var byId = {}; P.forEach(function (p) { byId[p.id] = p; });
  var LbyId = {}; L.forEach(function (l) { LbyId[l.id] = l; });
  var ERA = { e1: '2010 前完工', e2: '2010–2017 完工', e3: '2018 後完工', pre: '預售', e0: '完工年未知' };
  var BN = D.builders, BCH = { ks: '坤', dx: '德', yl: '椰', hy: '惠', fy: '富', dy: '硯', hs: '合' };
  var bsel = 'all';
  function bOk(b) { return bsel === 'all' || b === bsel; }
  var sheet = document.getElementById('sheet');
  var mobile = function () { return window.matchMedia('(max-width: 760px)').matches; };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n, d) { if (n == null || isNaN(n)) return '—'; return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: d == null ? 2 : d }); }
  function wan(n) { return n == null ? '—' : fmt(n, 0) + '萬'; }
  function listingsOf(p) { return p.listings.map(function (id) { return LbyId[id]; }); }
  function innerOf(l) { return l.inner != null ? fmt(l.inner) + '坪' : (l.main != null ? '主建物' + fmt(l.main) + '坪' : '未知'); }
  function shortName(p) { return p.name.replace(/（.*?）/g, '').replace(/^(坤山|德鑫|椰林|椰寶|惠宇|富宇|大硯|合石)/, '') || p.name; }
  function yearText(p) { return p.era === 'pre' ? '預售' : (p.year ? String(p.year) : '?'); }

  // ---------- map ----------
  var map = L_init();
  function L_init() {
    var m = window.L.map('map', { zoomControl: true, tap: true, zoomSnap: mobile() ? 0.25 : 1 }).setView([24.812, 121.026], 14);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(m);
    return m;
  }
  var markers = {}, activeId = null;

  var compact = {};
  function labelText(p) { var z = map.getZoom(); return z >= 15 ? p.name : shortName(p); }
  function iconHtml(p) {
    var z = map.getZoom();
    var sale = p.listings.length ? '<span class="ps">售' + p.listings.length + '</span>' : '';
    if (compact[p.id] && p.id !== activeId) {
      return '<div class="pdot b-' + p.builder + ' ' + p.era + (p.star ? ' starred' : '') + '" title="' + esc(p.name) + '">' + (p.star ? '★' : (p.listings.length ? p.listings.length : '')) + '</div>';
    }
    var unit = '';
    if (z >= 16 && p.unitLabel) unit = '<span class="pu">' + esc(p.unitLabel) + (p.unitEst ? '萬(估)' : '萬') + '</span>';
    var star = p.star ? '<span class="pstar">★</span>' : '';
    return '<div class="ptag b-' + p.builder + ' ' + p.era + (p.star ? ' starred' : '') + (p.id === activeId ? ' active' : '') + '">' +
      '<span class="pb">' + BCH[p.builder] + '</span><span class="pn">' + star + esc(labelText(p)) + '</span>' + unit + '<span class="py">' + yearText(p) + '</span>' + sale + '</div>';
  }
  function makeIcon(p) { return window.L.divIcon({ className: 'tag-icon', html: iconHtml(p), iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -34] }); }
  function labelBox(p, pt) {
    var z = map.getZoom(), w = labelText(p).length * 12.5 + 64 + (z >= 16 && p.unitLabel ? 50 : 0) + (p.star ? 14 : 0);
    return { x1: pt.x - w / 2 - 4, x2: pt.x + w / 2 + 10, y1: pt.y - 40, y2: pt.y + 2 };
  }
  function declutter() {
    var order = P.filter(function (p) { return map.hasLayer(markers[p.id]); }).sort(function (a, b) {
      var s = function (p) { return (p.id === activeId ? 1000 : 0) + (p.star ? 500 : 0) + p.listings.length * 50 + (p.year || 2030) / 100; };
      return s(b) - s(a);
    });
    var placed = [], nc = {};
    order.forEach(function (p) {
      var bx = labelBox(p, map.latLngToContainerPoint([p.lat, p.lng]));
      var hit = placed.some(function (q) { return !(bx.x2 < q.x1 || bx.x1 > q.x2 || bx.y2 < q.y1 || bx.y1 > q.y2); });
      if (hit && p.id !== activeId) nc[p.id] = true; else placed.push(bx);
    });
    compact = nc;
  }
  function popupHtml(p) {
    var h = '<div class="pop">';
    h += '<div class="pop-title">' + (p.star ? '<span class="star">★</span>' : '') + esc(p.name) + '</div>';
    if (p.alias) h += '<div class="pop-alias">又名：' + esc(p.alias) + '</div>';
    h += '<div class="pop-sub"><span class="tag tag-b b-' + p.builder + '">' + esc(BN[p.builder]) + '</span><span class="tag tag-zone">' + esc(p.zone) + '</span><span class="tag">' + esc(ERA[p.era]) + '</span>' +
      (p.listings.length ? '<span class="tag tag-sale">在售 ' + p.listings.length + ' 戶</span>' : '') + '</div>';
    h += '<div class="pop-scroll">';
    h += '<div class="sec"><h4>基本資料</h4><dl class="kv">' +
      '<dt>完工</dt><dd>' + esc(p.done) + '</dd>' +
      '<dt>建商</dt><dd>' + esc(p.developer) + '</dd>' +
      '<dt>區域</dt><dd>' + esc(p.area) + '</dd>' +
      '<dt>地址</dt><dd>' + esc(p.address) + '</dd>' +
      ((p.units || p.floors) ? '<dt>戶數/樓</dt><dd>' + esc(p.units || '—') + ' · ' + esc(p.floors || '—') + '</dd>' : '') +
      '<dt>權狀</dt><dd>' + esc(p.ownRange) + ' 坪（不含車位）</dd>' +
      '<dt>室內</dt><dd>' + esc(p.innerRange) + ' 坪（主+附）</dd>' +
      '</dl></div>';
    h += '<div class="sec"><h4>最近一筆實價登錄</h4>';
    var t = p.latest;
    if (t) {
      h += '<div class="tx"><div><span class="tx-big">' + wan(t.total) + '</span> · ' + esc(t.date) + (t.type === '預售' ? ' <span class="est">預售</span>' : '') + '</div>' +
        '<dl class="kv"><dt>樓層</dt><dd>' + esc(t.floor) + '</dd>' +
        '<dt>權狀</dt><dd>' + fmt(t.own) + ' 坪（含車位）</dd>' +
        '<dt>室內</dt><dd>' + (t.inner != null ? fmt(t.inner) + ' 坪' : '未登錄') + '</dd>' +
        '<dt>車位</dt><dd>' + esc(t.park) + (t.parkEst ? '<span class="est">車位以120萬估</span>' : '') + '</dd>' +
        '<dt>單價</dt><dd><span class="tx-unit">' + fmt(t.unit, 1) + ' 萬/坪</span>（扣車位）</dd></dl></div>';
    } else {
      h += '<div class="tx">尚無實價登錄 · 推估 <span class="tx-unit">' + esc(p.unitLabel) + ' 萬/坪</span><span class="est">推估</span></div>';
    }
    h += '</div>';
    var ls = listingsOf(p).slice().sort(function (a, b) { return a.total - b.total; });
    if (ls.length) {
      h += '<div class="sec"><h4>目前在售（點開刊登頁）</h4><ul class="pl">';
      ls.forEach(function (l) {
        h += '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener" class="' + (l.fit ? 'fit' : '') + '">' +
          '<span class="f">' + esc(l.floor) + '</span><span class="t">' + wan(l.total) + '</span>' +
          '<span class="a">權狀 ' + fmt(l.own) + ' · 室內 ' + innerOf(l) + ' · ' + esc(l.src) + (l.priceHist ? ' · 曾見 ' + esc(l.priceHist) : '') + ' ↗</span></a></li>';
      });
      h += '</ul></div>';
    } else {
      h += '<div class="sec"><h4>目前在售</h4><div style="font-size:.74rem;color:var(--ink-soft)">' + (p.builder === 'ks' || p.builder === 'fy' ? '591／信義未見刊登' : '591 未見刊登') + '</div></div>';
    }
    if (p.notes.length) {
      h += '<div class="sec"><h4>注意事項</h4><ul class="notes">' + p.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>';
    }
    h += '<div class="geo">座標：' + esc(p.geoMethod) + '</div>';
    h += '</div>';
    if (p.links.length) {
      h += '<div class="btns">' + p.links.map(function (k) {
        var cls = k.kind === 'leju' ? 'leju' : (k.kind === '591' ? 'b591' : 'sinyi');
        return '<a class="btn ' + cls + '" href="' + esc(k.url) + '" target="_blank" rel="noopener">' + esc(k.label) + ' ↗</a>';
      }).join('') + '</div>';
    }
    h += '</div>';
    return h;
  }

  function popupOpts() {
    var w = Math.min(330, window.innerWidth - 36);
    var pad = mobile() ? [10, sheetVisiblePx() + 10] : [20, 20];
    return { maxWidth: w, minWidth: Math.min(260, w), autoPanPaddingTopLeft: [10, 60], autoPanPaddingBottomRight: pad, closeButton: true };
  }

  P.forEach(function (p) {
    var mk = window.L.marker([p.lat, p.lng], { icon: makeIcon(p), riseOnHover: true, title: p.name, keyboard: true });
    mk.bindPopup(function () { return popupHtml(p); }, popupOpts());
    mk.on('click', function () { setActive(p.id, false); });
    mk.on('popupopen', function () { mk.getPopup().options.autoPanPaddingBottomRight = popupOpts().autoPanPaddingBottomRight; });
    mk.on('popupclose', function () { if (activeId === p.id) setActive(null, false); });
    mk.addTo(map);
    markers[p.id] = mk;
  });
  map.on('zoomend', refreshIcons);
  function refreshIcons() { declutter(); P.forEach(function (p) { markers[p.id].setIcon(makeIcon(p)); }); }

  function setActive(id, fromList) {
    var prev = activeId; activeId = id;
    refreshIcons();
    [prev, id].forEach(function (x) { if (x && markers[x]) markers[x].setZIndexOffset(x === id ? 1000 : 0); });
    document.querySelectorAll('.card').forEach(function (c) { c.classList.toggle('active', c.dataset.id === id); });
    if (id && !fromList) {
      var c = document.querySelector('.card[data-id="' + id + '"]');
      if (c && !mobile()) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  function flyTo(id) {
    var p = byId[id], mk = markers[id];
    if (!map.hasLayer(mk)) mk.addTo(map);
    if (mobile()) setSheet('collapsed');
    setActive(id, true);
    var z = Math.max(map.getZoom(), 16);
    var target = window.L.latLng(p.lat, p.lng);
    if (mobile()) {
      var pt = map.project(target, z).add([0, -Math.round(window.innerHeight * 0.18)]);
      target = map.unproject(pt, z);
    }
    map.flyTo(target, z, { duration: 0.6 });
    map.once('moveend', function () { mk.openPopup(); });
  }

  // ---------- filters ----------
  var $ = function (id) { return document.getElementById(id); };
  var zones = []; P.slice().sort(function (a, b) { return a.zone > b.zone ? 1 : -1; }).forEach(function (p) { if (zones.indexOf(p.zone) < 0) zones.push(p.zone); });
  zones.forEach(function (z) { var o = document.createElement('option'); o.value = z; o.textContent = z; $('zone-filter').appendChild(o); });
  function innerOk(l) { return l.inner != null ? l.inner >= 32 : (l.main != null && l.main >= 31.5); }
  function passes(p) {
    var z = $('zone-filter').value, ls = listingsOf(p);
    if (!bOk(p.builder)) return false;
    if (z !== 'all' && p.zone !== z) return false;
    if ($('f-sale').checked && !ls.length) return false;
    var u4 = $('f-4000').checked, i32 = $('f-32').checked;
    if (u4 && i32) return ls.some(function (l) { return l.total <= 4000 && innerOk(l); });
    if (u4 && !ls.some(function (l) { return l.total <= 4000; })) return false;
    if (i32 && !((p.innerMax != null && p.innerMax >= 32) || ls.some(innerOk))) return false;
    return true;
  }
  function sorted(arr) {
    var s = $('sort-by').value, a = arr.slice();
    var yk = function (p) { return p.year || 9999; };
    if (s === 'year') a.sort(function (x, y) { return yk(x) - yk(y) || (x.done > y.done ? 1 : -1); });
    if (s === 'year-desc') a.sort(function (x, y) { return yk(y) - yk(x) || (x.done < y.done ? 1 : -1); });
    if (s === 'unit-asc') a.sort(function (x, y) { return (x.unitSort || 999) - (y.unitSort || 999); });
    if (s === 'unit-desc') a.sort(function (x, y) { return (y.unitSort || 0) - (x.unitSort || 0); });
    if (s === 'sale') a.sort(function (x, y) { return y.listings.length - x.listings.length || yk(x) - yk(y); });
    return a;
  }

  var view = 'projects';
  function render() {
    var vis = P.filter(passes);
    P.forEach(function (p) { var on = vis.indexOf(p) >= 0, mk = markers[p.id]; if (on && !map.hasLayer(mk)) mk.addTo(map); if (!on && map.hasLayer(mk)) map.removeLayer(mk); });
    refreshIcons();
    var PB = P.filter(function (p) { return bOk(p.builder); }), LB = L.filter(function (l) { return bOk(l.builder); });
    $('count-pill').textContent = (bsel === 'all' ? '八家建商' : BN[bsel]) + ' ' + PB.length + ' 案（顯示 ' + vis.length + '）· 在售 ' + LB.length + ' 戶 · 符合 ' + LB.filter(function (l) { return l.fit; }).length;
    $('n-proj').textContent = vis.length + '/' + PB.length;
    $('n-list').textContent = LB.length;
    if (view === 'projects') renderProjects(sorted(vis)); else renderListings();
  }
  function renderProjects(arr) {
    var box = $('list');
    if (!arr.length) { box.innerHTML = '<div class="empty">沒有符合條件的建案</div>'; return; }
    box.innerHTML = arr.map(function (p) {
      var ls = listingsOf(p), fit = ls.filter(function (l) { return l.fit; }).length;
      var t = p.latest;
      return '<div class="card ' + p.era + (p.star ? ' star-card' : '') + (p.id === activeId ? ' active' : '') + '" data-id="' + p.id + '" tabindex="0">' +
        '<div class="card-head"><p class="cname">' + (p.star ? '<span class="star">★</span>' : '') + esc(p.name) + '<span class="cyear">' + esc(p.era === 'pre' ? '預售 ' + (p.year || '') : (p.year || '年份未知')) + '</span></p>' +
        '<span class="cunit">' + (p.unitLabel ? esc(p.unitLabel) + '<small> 萬/坪' + (p.unitEst ? '(估)' : '') + '</small>' : '—') + '</span></div>' +
        '<div class="cmeta"><span class="tag tag-b b-' + p.builder + '">' + esc(BN[p.builder]) + '</span><span class="tag tag-zone">' + esc(p.zone) + '</span>' +
        '<span class="tag">室內 ' + esc(p.innerRange) + '</span>' +
        (t ? '<span class="tag">最新 ' + esc(t.date.slice(0, 7)) + ' ' + wan(t.total) + '</span>' : '<span class="tag tag-est">尚無實登</span>') +
        (ls.length ? '<span class="tag tag-sale">售' + ls.length + '</span>' : '') +
        (fit ? '<span class="tag tag-fit">≤4,000萬·≥32坪 ×' + fit + '</span>' : '') + '</div></div>';
    }).join('');
  }
  function renderListings() {
    var s = $('lsort').value, a = L.filter(function (l) { return bOk(l.builder); });
    if ($('f-fit').checked) a = a.filter(function (l) { return l.fit; });
    var inn = function (l) { return l.inner != null ? l.inner : (l.main || 0); };
    if (s === 'price-asc') a.sort(function (x, y) { return x.total - y.total; });
    if (s === 'price-desc') a.sort(function (x, y) { return y.total - x.total; });
    if (s === 'inner-desc') a.sort(function (x, y) { return inn(y) - inn(x); });
    if (s === 'ppi-asc') a.sort(function (x, y) { return x.total / (inn(x) || 1) - y.total / (inn(y) || 1); });
    var box = $('list');
    if (!a.length) { box.innerHTML = '<div class="empty">沒有符合條件的物件</div>'; return; }
    box.innerHTML = a.map(function (l) {
      var p = byId[l.pid], ppi = l.inner != null ? fmt(l.total / l.inner, 1) + '萬' : '—';
      return '<div class="lcard' + (l.fit ? ' fit' : '') + '">' +
        '<div class="lcard-top"><span class="lname" data-pid="' + p.id + '"><i class="bmini b-' + p.builder + '">' + BCH[p.builder] + '</i>' + esc(p.name) + ' ' + esc(l.floor) + '</span>' +
        '<a class="lprice ' + (l.total <= 4000 ? 'u4000' : 'o4000') + '" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + wan(l.total) + '</a></div>' +
        '<div class="lgrid"><div><span>權狀(含車位)</span><b>' + fmt(l.own) + '坪</b></div>' +
        '<div><span>室內(主+附)</span><b>' + (l.inner != null ? fmt(l.inner) + '坪' : '未知') + '</b></div>' +
        '<div><span>每室內坪</span><b>' + ppi + '</b></div></div>' +
        '<div class="lnote">' + esc(p.year ? p.year + ' 完工' : '') + ' · ' + esc(String(l.rooms).match(/^\d+$/) ? l.rooms + '房' : l.rooms) + ' · 車位 ' + esc(l.park) + ' · ' + esc(l.src) +
        (l.priceHist ? '<br>曾見價格：' + esc(l.priceHist) : '') + (l.innerNote ? '<br>' + esc(l.innerNote) : (l.innerSrc ? '<br>室內坪：' + esc(l.innerSrc) : '')) + '</div></div>';
    }).join('');
  }

  $('list').addEventListener('click', function (e) {
    var c = e.target.closest('.card'); if (c) { flyTo(c.dataset.id); return; }
    var n = e.target.closest('.lname'); if (n) flyTo(n.dataset.pid);
  });
  $('list').addEventListener('keydown', function (e) { var c = e.target.closest('.card'); if (c && e.key === 'Enter') flyTo(c.dataset.id); });
  ['sort-by', 'zone-filter', 'f-sale', 'f-4000', 'f-32', 'lsort', 'f-fit'].forEach(function (id) { $(id).addEventListener('change', render); });
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      view = t.dataset.view;
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === t); });
      $('controls-projects').hidden = view !== 'projects';
      $('controls-listings').hidden = view !== 'listings';
      $('sheet-title').textContent = view === 'projects' ? '建案清單' : '在售物件';
      if (mobile()) setSheet('expanded');
      render();
    });
  });

  function fitVisible() {
    var vis = P.filter(passes); if (!vis.length) return;
    var b = window.L.latLngBounds(vis.map(function (p) { return [p.lat, p.lng]; }));
    map.fitBounds(b, mobile() ? { paddingTopLeft: [36, 36], paddingBottomRight: [36, Math.round(window.innerHeight * 0.34) + 4], maxZoom: 16 } : { paddingTopLeft: [30, 40], paddingBottomRight: [30, 30], maxZoom: 16 });
  }
  document.querySelectorAll('.btab').forEach(function (t) {
    t.addEventListener('click', function () {
      bsel = t.dataset.b; map.closePopup(); activeId = null;
      document.querySelectorAll('.btab').forEach(function (x) { var on = x === t; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
      render(); fitVisible();
    });
  });
  document.querySelectorAll('.btab').forEach(function (t) {
    var b = t.dataset.b, n = P.filter(function (p) { return b === 'all' || p.builder === b; }).length;
    t.querySelector('small').textContent = n;
  });

  // ---------- bottom sheet (mobile) ----------
  function fitSheet() {
    var t = document.querySelector('.btabs'); if (!t || !mobile()) { sheet.style.removeProperty('--sheet-h'); return; }
    var h = Math.round(Math.min(window.innerHeight * 0.82, window.innerHeight - t.getBoundingClientRect().bottom - 6));
    sheet.style.setProperty('--sheet-h', h + 'px');
  }
  window.addEventListener('resize', fitSheet);
  function setSheet(state) {
    fitSheet();
    sheet.classList.remove('expanded', 'collapsed');
    if (state !== 'peek') sheet.classList.add(state);
    sheet.dataset.state = state;
  }
  function sheetVisiblePx() {
    if (!mobile()) return 0;
    var st = sheet.dataset.state || 'peek';
    if (st === 'collapsed') return 52;
    if (st === 'expanded') return sheet.getBoundingClientRect().height;
    return window.innerHeight * 0.34;
  }
  setSheet('peek');
  $('sheet-handle').addEventListener('click', function () {
    var st = sheet.dataset.state;
    setSheet(st === 'peek' ? 'expanded' : st === 'expanded' ? 'collapsed' : 'peek');
  });
  // simple swipe on handle
  var y0 = null;
  $('sheet-handle').addEventListener('touchstart', function (e) { y0 = e.touches[0].clientY; }, { passive: true });
  $('sheet-handle').addEventListener('touchend', function (e) {
    if (y0 == null) return; var dy = e.changedTouches[0].clientY - y0; y0 = null;
    if (Math.abs(dy) < 30) return;
    var st = sheet.dataset.state;
    if (dy < 0) setSheet(st === 'collapsed' ? 'peek' : 'expanded'); else setSheet(st === 'expanded' ? 'peek' : 'collapsed');
    e.preventDefault();
  });
  map.on('click', function () { if (mobile() && sheet.dataset.state === 'expanded') setSheet('peek'); });

  // ---------- footer ----------
  $('foot').innerHTML =
    '<p><b>資料來源：</b>建商官網業績（<a href="https://www.kuensun.com.tw/works" target="_blank" rel="noopener">坤山</a>、<a href="https://www.dexinhouse.com.tw/classic/all/" target="_blank" rel="noopener">德鑫</a>、<a href="https://www.grandconstruction.com.tw/program.php" target="_blank" rel="noopener">椰林</a>、<a href="https://www.huyuu.com.tw/" target="_blank" rel="noopener">惠宇</a>）；大硯、合石以媒體專訪（科技生活、米築、亞太新聞網、新竹縣府新聞）、預售屋備查與 591 社區名比對；富宇以 JR 預售屋資訊站竹北富宇整理、新屋網富宇建設案件表、591 社區名比對（富宇官網只列近年個案）；JR 預售屋資訊站椰林各區整理；' + esc(D.meta.lvr) + '；591（社區頁與售屋）；信義社區頁（坤山在售、建商核對）。樂居被 Cloudflare 擋住，德鑫／椰林的在售只收 591，信義、永慶獨家委託可能漏列。查詢日 ' + esc(D.meta.generated) + '。</p>' +
    '<p><b>單價：</b>' + esc(D.meta.formula) + '</p>' +
    '<p><b>室內坪：</b>' + esc(D.meta.innerDef) + '</p>' +
    '<p><b>座標：</b>採 591／信義社區頁內嵌座標（少數無社區頁者用 591 門牌點），全部以 OpenStreetMap 反查確認位於竹北市。</p>' +
    '<p><b>標記：</b>標籤左側字樣與外框顏色＝建商（坤＝棕、德＝紅方角、椰＝綠圓角）；底色＝完工年代；紅色「售N」＝在售戶數。</p>' +
    '<p class="warn">室內坪多為推估，看屋或出價前請以建物謄本核對主建物、附屬建物與車位坪數。</p>' +
    '<p>新竹縣總價 ≥ 4,000 萬屬高價住宅：貸款最多 3 成、無寬限期。</p>';

  render();
  var b = window.L.latLngBounds(P.map(function (p) { return [p.lat, p.lng]; }));
  map.fitBounds(b, mobile() ? { paddingTopLeft: [36, 36], paddingBottomRight: [36, Math.round(window.innerHeight * 0.34) + 4] } : { paddingTopLeft: [30, 40], paddingBottomRight: [30, 30] });
  window.KS_APP = { map: map, markers: markers, flyTo: flyTo, setSheet: setSheet };
})();
