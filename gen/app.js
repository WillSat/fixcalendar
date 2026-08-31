'use strict';
/* ==========================================================================
   ICS 日历编辑器 · 应用逻辑（无框架原生 JS）
   默认载入 fixcalendar 在线 cn.ics
   ========================================================================== */

/* ---------------- 工具 ---------------- */
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(s) { return esc(s); }
function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.hidden = true; }, 2600);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // 兜底
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
}

/* ---------------- 常量与状态 ---------------- */
const DEFAULT_URL = 'https://raw.githubusercontent.com/WillSat/fixcalendar/refs/heads/main/cn.ics';
const PALETTE = ['#b45f31', '#6f8a6a', '#8a6a24', '#9a5b8f', '#4f7a8a', '#b58845', '#7a5f8a', '#6a8a5f', '#a05f45', '#5f8a7a'];
const WD = { SU: '周日', MO: '周一', TU: '周二', WE: '周三', TH: '周四', FR: '周五', SA: '周六' };
const WD_ORDER = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const state = {
  events: [],
  properties: [],
  sourceName: '',
  selected: new Set(),
  selectMode: false,
  groupMode: true,
  search: '',
  year: 'all',
  type: 'all',
  editingId: null,
  calInfoOpen: false,
  collapsedFams: new Set(),
};

/* ---------------- 派生 ---------------- */
function yearOf(e) { return e.dtstart && e.dtstart.value ? +e.dtstart.value.slice(0, 4) : null; }
function famColor(f) { let h = 0; for (const c of f) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
function firstChar(f) { return (f || '·').trim().slice(0, 1); }
function dateLabel(e) {
  if (!e.dtstart) return '';
  const t = core.whichDateType(e.dtstart);
  const d = core.icsDateToDisplay(e.dtstart.value);
  return t === 'datetime' ? d.replace('T', ' ') : d;
}
function nthText(n) {
  if (n === '-1') return '最后';
  return '第' + (n || 1) + '个';
}
function bydayText(b) {
  const m = String(b).match(/^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
  if (!m) return b;
  return nthText(m[1]) + (WD[m[2]] || m[2]) + (m[1] === '-1' ? '' : '');
}
function ruleSummary(e) {
  if (!e.rrule) return '单次';
  const o = e.rrule;
  if (o.BYDAY && o.BYMONTH) return '每年 ' + (+o.BYMONTH) + ' 月' + bydayText(o.BYDAY);
  if (o.BYMONTHDAY && o.BYMONTH) return '每年 ' + (+o.BYMONTH) + ' 月' + (+o.BYMONTHDAY) + ' 日';
  if (o.FREQ) return o.FREQ.toLowerCase();
  return '';
}
function evBadges(e) {
  if (e.rrule) return '<span class="badge b-yearly">每年</span>';
  if (/(伏|九|·夏|·冬)/.test(e.summary || '')) return '<span class="badge b-seas">时令</span>';
  return '<span class="badge b-once">单次</span>';
}
function getSelected() { return state.events.filter(e => state.selected.has(e.id)); }
function getFiltered() {
  let list = state.events.slice();
  const q = state.search.trim().toLowerCase();
  if (q) list = list.filter(e =>
    (e.summary || '').toLowerCase().includes(q) ||
    (e.uid || '').toLowerCase().includes(q) ||
    (e.description || '').toLowerCase().includes(q));
  if (state.year !== 'all') list = list.filter(e => String(yearOf(e)) === state.year);
  if (state.type !== 'all') list = list.filter(e => state.type === 'recurring' ? !!e.rrule : !e.rrule);
  return list;
}

function serializeICS() {
  return core.serializeCalendar({ properties: state.properties, events: state.events });
}

/* ---------------- 载入 ---------------- */
async function loadUrl(url) {
  const src = $('#srcDot');
  src.className = 'dot';
  $('#srcLabel').textContent = '正在加载 ' + url + ' …';
  $('#urlInput').value = url;
  try {
    const resp = await fetch(url, { headers: { 'Accept': 'text/calendar, */*' } });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const text = await resp.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('不是有效的 iCalendar 内容');
    loadText(text, url);
    src.className = 'dot ok';
  } catch (e) {
    src.className = 'dot err';
    $('#srcLabel').textContent = '加载失败：' + (e.message || e);
    toast('加载失败：' + (e.message || e), 'err');
  }
}
function loadText(text, name) {
  if (!text || !/BEGIN:VCALENDAR/i.test(text)) { toast('无法识别的 ICS 内容', 'err'); return; }
  const parsed = core.parseICS(text);
  state.events = parsed.events;
  state.properties = parsed.root.properties;
  state.sourceName = name || '';
  state.selected.clear();
  state.selectMode = false;
  $('#selectMode').checked = false;
  state.editingId = null;
  state.calInfoOpen = false;
  state.collapsedFams.clear();
  $('#srcLabel').textContent = name || '已载入文本';
  $('#srcDot').className = 'dot ok';
  renderAll();
  toast('已载入 ' + state.events.length + ' 个事件', 'ok');
}

/* ---------------- 渲染 ---------------- */
function renderAll() { renderStats(); renderFilters(); renderList(); renderPanel(); }
function refreshListStats() { renderStats(); renderList(); }
function renderStats() {
  const sec = $('#stats');
  const evs = state.events;
  if (!evs.length) { sec.hidden = true; sec.innerHTML = ''; return; }
  sec.hidden = false;
  const recurring = evs.filter(e => e.rrule).length;
  const once = evs.length - recurring;
  const fams = new Set(evs.map(e => core.familyKey(e)));
  const years = evs.map(yearOf).filter(Boolean);
  const minY = years.length ? Math.min.apply(null, years) : 0;
  const maxY = years.length ? Math.max.apply(null, years) : 0;
  sec.innerHTML =
    '<div class="stat"><div class="v">' + evs.length + '</div><div class="k">事件总数</div></div>' +
    '<div class="stat"><div class="v">' + recurring + '</div><div class="k">每年重复</div></div>' +
    '<div class="stat"><div class="v">' + once + '</div><div class="k">单次事件</div></div>' +
    '<div class="stat gold"><div class="v">' + fams.size + '</div><div class="k">节假日种类</div></div>' +
    '<div class="stat green"><div class="v">' + minY + '–' + maxY + '</div><div class="k">年份范围</div></div>';
}
function renderFilters() {
  const yf = $('#yearFilter');
  const years = Array.from(new Set(state.events.map(yearOf).filter(Boolean))).sort((a, b) => a - b);
  yf.innerHTML = '<option value="all">全部年份</option>' + years.map(y =>
    '<option value="' + y + '"' + (String(y) === state.year ? ' selected' : '') + '>' + y + ' 年</option>').join('');
  if (!years.map(String).includes(String(state.year))) { state.year = 'all'; yf.value = 'all'; }
}

function rowHTML(e, color) {
  const sel = state.selected.has(e.id) ? ' selected' : '';
  const chk = state.selectMode
    ? '<input type="checkbox" class="ev-check" data-check="' + escAttr(e.id) + '"' + (state.selected.has(e.id) ? ' checked' : '') + '>'
    : '';
  return '<div class="ev-row' + sel + '" data-id="' + escAttr(e.id) + '">' +
    chk +
    '<span class="ev-dot" style="background:' + color + '"></span>' +
    '<div class="ev-main"><span class="ev-name">' + esc(e.summary || '（无标题）') + '</span>' +
    '<span class="ev-badges">' + evBadges(e) + '</span>' +
    '<div class="ev-meta">' + esc(e.uid || '') + ' · ' + esc(ruleSummary(e)) + '</div></div>' +
    '<span class="ev-date">' + esc(dateLabel(e)) + '</span>' +
    '<button class="icon-btn" data-edit="' + escAttr(e.id) + '" title="编辑">✎</button></div>';
}
function renderList() {
  const eventsEl = $('#events');
  const emptyEl = $('#empty');
  const list = getFiltered();
  if (!list.length) {
    eventsEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  if (state.groupMode) {
    const groups = new Map();
    for (const e of list) {
      const f = core.familyKey(e);
      if (!groups.has(f)) groups.set(f, []);
      groups.get(f).push(e);
    }
    const groupArr = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'zh'));
    let html = '';
    for (const [fam, evs] of groupArr) {
      evs.sort((a, b) => (yearOf(a) || 0) - (yearOf(b) || 0) || (a.summary || '').localeCompare(b.summary || '', 'zh'));
      const color = famColor(fam);
      const yrs = Array.from(new Set(evs.map(yearOf).filter(Boolean))).sort((a, b) => a - b);
      const collapse = state.collapsedFams.has(fam);
      html += '<div class="group' + (collapse ? ' collapsed' : '') + '" data-fam="' + escAttr(fam) + '">' +
        '<div class="group-head" data-toggle><div class="g-ico" style="background:' + color + '">' + esc(firstChar(fam)) + '</div>' +
        '<span class="g-title">' + esc(fam) + '</span><span class="g-count">' + evs.length + ' 项</span>' +
        '<span class="g-years">' + esc(yrs.length ? yrs.join(' · ') + ' 年' : '') + '</span>' +
        '<span class="g-caret">▾</span></div>';
      for (const e of evs) html += rowHTML(e, color);
      html += '</div>';
    }
    eventsEl.innerHTML = html;
  } else {
    const arr = list.slice().sort((a, b) => (yearOf(a) || 0) - (yearOf(b) || 0) || (a.summary || '').localeCompare(b.summary || '', 'zh'));
    eventsEl.innerHTML = arr.map(e => rowHTML(e, famColor(core.familyKey(e)))).join('');
  }
}

/* ---------------- 面板 ---------------- */
function renderPanel() {
  const head = $('#panelHead'), body = $('#panelBody'), ph = $('#panelPlaceholder');
  const ev = state.editingId ? state.events.find(e => e.id === state.editingId) : null;
  if (ev) {
    $('#panelTitle').textContent = '编辑事件';
    head.hidden = false; ph.hidden = true;
    renderDetail(ev);
  } else if (state.calInfoOpen) {
    $('#panelTitle').textContent = '日历信息';
    head.hidden = false; ph.hidden = true;
    renderCalInfo();
  } else {
    head.hidden = true; ph.hidden = false; body.innerHTML = '';
  }
}

/* ---- 日期字段 ---- */
function dateField(which, type, dt) {
  const v = dt ? core.icsDateToDisplay(dt.value) : '';
  const isDT = type !== 'date';
  const d = isDT ? v.slice(0, 10) : v;
  const t = isDT ? v.slice(11, 16) : '09:00';
  return '<div class="field">' +
    '<div class="radios" data-type-group="' + which + '">' +
    '<label><input type="radio" name="' + which + 'Type" value="date"' + (isDT ? '' : ' checked') + '> 全天</label>' +
    '<label><input type="radio" name="' + which + 'Type" value="datetime"' + (isDT ? ' checked' : '') + '> 时刻</label></div>' +
    '<input class="input" id="' + which + 'Date" type="date" value="' + escAttr(d) + '" style="margin-top:8px">' +
    '<input class="input" id="' + which + 'Time" type="time" value="' + escAttr(t) + '" style="margin-top:8px;' + (isDT ? '' : 'display:none') + '"></div>';
}
function readDate(which, ev) {
  const type = $('input[name="' + which + 'Type"]:checked').value;
  const dateVal = ($('#' + which + 'Date').value) || '';
  const timeVal = ($('#' + which + 'Time').offsetParent === null || $('#' + which + 'Time').style.display === 'none') ? '00:00' : ($('#' + which + 'Time').value || '00:00');
  const key = which === 'start' ? 'dtstart' : 'dtend';
  let params = ev[key] ? Object.assign({}, ev[key].params) : {};
  if (type === 'date') {
    params.VALUE = 'DATE';
    ev[key] = { value: core.displayToICSDate(dateVal) || dateVal, params };
  } else {
    params.VALUE = 'DATE-TIME';
    const ics = (core.displayToICSDate(dateVal) || dateVal) + 'T' + (timeVal.replace(':', ''))
      + (timeVal.length === 2 ? '00' : '') + '00';
    ev[key] = { value: ics, params };
  }
}

/* ---- 选择器生成 ---- */
function monthSel(id, selVal) {
  let s = '<select class="sel" id="' + id + '">';
  for (let m = 1; m <= 12; m++) s += '<option value="' + m + '"' + (m === selVal ? ' selected' : '') + '>' + m + ' 月</option>';
  return s + '</select>';
}
function daySel(id, selVal) {
  let s = '<select class="sel" id="' + id + '">';
  for (let d = 1; d <= 31; d++) s += '<option value="' + d + '"' + (d === selVal ? ' selected' : '') + '>' + d + ' 日</option>';
  return s + '</select>';
}
function nthSel(id, selVal) {
  const labels = { '1': '第1个', '2': '第2个', '3': '第3个', '4': '第4个', '5': '第5个', '-1': '最后1个' };
  let s = '<select class="sel" id="' + id + '">';
  ['1', '2', '3', '4', '5', '-1'].forEach(k => { s += '<option value="' + k + '"' + (k === String(selVal) ? ' selected' : '') + '>' + labels[k] + '</option>'; });
  return s + '</select>';
}
function weekdaySel(id, selVal) {
  let s = '<select class="sel" id="' + id + '">';
  WD_ORDER.forEach(w => { s += '<option value="' + w + '"' + (w === selVal ? ' selected' : '') + '>' + WD[w] + '</option>'; });
  return s + '</select>';
}
function selOptions(pairs, sel) {
  return pairs.map(p => '<option value="' + p[0] + '"' + (p[0] === sel ? ' selected' : '') + '>' + esc(p[1]) + '</option>').join('');
}
function nthOf(byday) { const m = String(byday).match(/^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/); return m && m[1] ? m[1] : '1'; }
function wdOf(byday) { const m = String(byday).match(/^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/); return m ? m[2] : 'SU'; }

/* ---- RRULE 构建 ---- */
function ruleBuilder(o, dtstart) {
  const freq = o.FREQ || 'NONE';
  const hasByDay = !!(o.BYDAY && o.BYMONTH);
  const mode = hasByDay ? 'weekday' : 'date';
  const bymonth = o.BYMONTH ? +o.BYMONTH : (dtstart ? +dtstart.value.slice(4, 6) : 1);
  const bymonthday = o.BYMONTHDAY ? +o.BYMONTHDAY : (dtstart ? +dtstart.value.slice(6, 8) : 1);
  const byday = o.BYDAY || '2SU';
  const show = freq !== 'NONE';
  return '<div class="field"><label>重复规则</label>' +
    '<div class="radios" id="ruleFreq">' +
    '<label><input type="radio" name="fFreq" value="NONE"' + (freq === 'NONE' ? ' checked' : '') + '> 不重复</label>' +
    '<label><input type="radio" name="fFreq" value="YEARLY"' + (freq === 'YEARLY' ? ' checked' : '') + '> 每年重复</label></div>' +
    '<div id="ruleBody" style="margin-top:8px;' + (show ? '' : 'display:none') + '">' +
    '<div class="radios" id="ruleMode">' +
    '<label><input type="radio" name="fMode" value="date"' + (mode === 'date' ? ' checked' : '') + '> 固定日期</label>' +
    '<label><input type="radio" name="fMode" value="weekday"' + (mode === 'weekday' ? ' checked' : '') + '> 特定星期</label></div>' +
    '<div id="ruleDate" class="rule-selects" style="' + (mode === 'weekday' ? 'display:none' : '') + '">' + monthSel('fRMonth', bymonth) + daySel('fRDay', bymonthday) + '</div>' +
    '<div id="ruleWeek" class="rule-selects" style="' + (mode === 'date' ? 'display:none' : '') + '">' + monthSel('fRMonthW', bymonth) + nthSel('fRNth', nthOf(byday)) + weekdaySel('fRWeekday', wdOf(byday)) + '</div>' +
    '</div></div>';
}

function renderDetail(ev) {
  const body = $('#panelBody');
  const dttype = ev.dtstart ? core.whichDateType(ev.dtstart) : 'date';
  const dtendtype = ev.dtend ? core.whichDateType(ev.dtend) : 'date';
  body.innerHTML =
    '<div class="field"><label>标题</label><input class="input" id="fSummary" value="' + escAttr(ev.summary) + '" placeholder="如：母亲节"></div>' +
    '<div class="field"><label>UID</label><input class="input" id="fUid" value="' + escAttr(ev.uid) + '" spellcheck="false" placeholder="唯一标识"></div>' +
    '<div class="divider"></div>' +
    '<div class="section-label"><span class="s-co"></span>开始日期</div>' + dateField('start', dttype, ev.dtstart) +
    '<div class="section-label"><span class="s-co"></span>结束日期</div>' + dateField('end', dtendtype, ev.dtend) +
    '<div class="divider"></div>' +
    ruleBuilder(ev.rrule || {}, ev.dtstart) +
    '<div class="hint" style="color:var(--ink-faint);font-size:11px;margin-bottom:4px;">规则预览</div>' +
    '<div class="rr-preview" id="rrPreview">' + esc(core.rruleToString(ev.rrule) || '（不重复）') + '</div>' +
    '<div class="divider"></div>' +
    '<div class="row2"><div class="field"><label>状态</label><select class="sel" id="fStatus">' + selOptions([['CONFIRMED', '已确认'], ['TENTATIVE', '暂定'], ['CANCELLED', '已取消']], ev.status || 'CONFIRMED') + '</select></div>' +
    '<div class="field"><label>透明度</label><select class="sel" id="fTransp">' + selOptions([['TRANSPARENT', '透明（不占用）'], ['OPAQUE', '不透明（占用）']], ev.transp || 'TRANSPARENT') + '</select></div></div>' +
    '<div class="field"><label>地点</label><input class="input" id="fLoc" value="' + escAttr(ev.location) + '" placeholder="可选"></div>' +
    '<div class="field"><label>备注</label><textarea class="ta" id="fDesc" placeholder="描述 / 备注…">' + esc(ev.description) + '</textarea></div>' +
    (ev.extraProps.length ? '<div class="divider"></div><div class="section-label"><span class="s-co"></span>其他属性</div>' +
      '<div class="kv" style="font-size:12px">' + ev.extraProps.map(x => '<div class="kv"><span class="k">' + esc(x.name) + '</span><span class="v">' + esc(x.value) + '</span></div>').join('') + '</div>' : '');

  // 文本字段即时更新
  $('#fSummary').addEventListener('input', e => { ev.summary = e.target.value; refreshListStats(); });
  $('#fUid').addEventListener('input', e => { ev.uid = e.target.value.trim(); refreshListStats(); });
  $('#fLoc').addEventListener('input', e => { ev.location = e.target.value; refreshListStats(); });
  $('#fDesc').addEventListener('input', e => { ev.description = e.target.value; refreshListStats(); });
  $('#fStatus').addEventListener('change', e => { ev.status = e.target.value; refreshListStats(); });
  $('#fTransp').addEventListener('change', e => { ev.transp = e.target.value; });

  // 日期
  ['start', 'end'].forEach(which => {
    $$('input[name="' + which + 'Type"]').forEach(r => r.addEventListener('change', () => {
      readDate(which, ev);
      const isDT = $('input[name="' + which + 'Type"]:checked').value === 'datetime';
      $('#' + which + 'Time').style.display = isDT ? '' : 'none';
      refreshListStats();
    }));
    $('#' + which + 'Date').addEventListener('input', () => { readDate(which, ev); refreshListStats(); });
    $('#' + which + 'Time').addEventListener('input', () => { readDate(which, ev); refreshListStats(); });
  });

  // 规则
  const ruleFreq = $('#ruleFreq'), ruleMode = $('#ruleMode');
  function applyRule() {
    const freq = $('input[name="fFreq"]:checked').value;
    if (freq === 'NONE') { ev.rrule = null; }
    else {
      const mode = $('input[name="fMode"]:checked').value;
      const month = mode === 'date' ? +$('#fRMonth').value : +$('#fRMonthW').value;
      if (mode === 'date') {
        const day = +$('#fRDay').value;
        ev.rrule = { FREQ: 'YEARLY', BYMONTH: String(month), BYMONTHDAY: String(day) };
      } else {
        const nth = $('#fRNth').value;
        const wd = $('#fRWeekday').value;
        ev.rrule = { FREQ: 'YEARLY', BYMONTH: String(month), BYDAY: (nth === '-1' ? '-1' : nth) + wd };
      }
    }
    $('#rrPreview').textContent = core.rruleToString(ev.rrule) || '（不重复）';
    refreshListStats();
  }
  ruleFreq.addEventListener('change', () => {
    const isY = $('input[name="fFreq"]:checked').value === 'YEARLY';
    $('#ruleBody').style.display = isY ? '' : 'none';
    applyRule();
  });
  ruleMode.addEventListener('change', () => {
    const isDate = $('input[name="fMode"]:checked').value === 'date';
    $('#ruleDate').style.display = isDate ? '' : 'none';
    $('#ruleWeek').style.display = isDate ? 'none' : '';
    applyRule();
  });
  $('#ruleBody').addEventListener('change', (e) => {
    if (e.target && (e.target.id === 'fRMonth' || e.target.id === 'fRDay' || e.target.id === 'fRMonthW' || e.target.id === 'fRNth' || e.target.id === 'fRWeekday')) applyRule();
  });
}

/* ---- 日历信息 ---- */
function renderCalInfo() {
  const body = $('#panelBody');
  const names = Array.from(new Set(state.properties.map(p => p.name)));
  let html = '<p style="margin:0 0 12px;color:var(--ink-soft);font-size:12.5px;">以下为整份日历的元信息，可直接点击右侧数值进行修改。</p>';
  html += '<div class="chips" style="margin-bottom:12px">' + names.map(n => '<span class="chip">' + esc(n) + '</span>').join('') + '</div>';
  const seen = new Set();
  for (const p of state.properties) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    html += '<div class="kv"><span class="k">' + esc(p.name) + '</span><span class="v" contenteditable="true" data-prop="' + escAttr(p.name) + '" spellcheck="false">' + esc(p.value) + '</span></div>';
  }
  html += '<div class="divider"></div>';
  html += '<button class="btn sm" id="btnShiftCalYear">整份日历年份平移…</button>';
  body.innerHTML = html;
  $$('[data-prop]', body).forEach(el => {
    el.addEventListener('blur', () => {
      const name = el.dataset.prop;
      const v = el.textContent.trim();
      const p = state.properties.find(x => x.name === name);
      if (p) { p.value = v; toast('已更新 ' + name); }
    });
  });
  $('#btnShiftCalYear').addEventListener('click', openShiftCalYear);
}

/* ---------------- 新建 / 编辑 ---------------- */
function newEvent() {
  const ev = {
    id: 'ev_' + Math.random().toString(36).slice(2, 9),
    uid: 'new-' + Date.now().toString(36),
    summary: '',
    dtstart: { value: '20250101', params: { VALUE: 'DATE' } },
    dtend: { value: '20250102', params: { VALUE: 'DATE' } },
    rrule: null, description: '', location: '', status: 'CONFIRMED', transp: 'TRANSPARENT', extraProps: [],
  };
  state.events.push(ev);
  state.editingId = ev.id;
  state.calInfoOpen = false;
  renderAll();
  $('#panelBody').scrollTop = 0;
  const s = $('#fSummary'); if (s) { s.focus(); s.select(); }
  toast('已新建事件，填写标题即可');
}
function openDetail(id) {
  state.editingId = id;
  state.calInfoOpen = false;
  renderPanel();
}
function openCalInfo() {
  state.editingId = null;
  state.calInfoOpen = true;
  renderPanel();
}
function closePanel() {
  state.editingId = null;
  state.calInfoOpen = false;
  renderPanel();
}

/* ---------------- 选择与批量 ---------------- */
function toggleSelect(id, box) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  const row = $('#events [data-id="' + CSS.escape(id) + '"]');
  if (row) row.classList.toggle('selected', state.selected.has(id));
  if (box) box.checked = state.selected.has(id);
  updateBatchbar();
}
function updateBatchbar() {
  const bar = $('#batchbar');
  const n = state.selected.size;
  $('#selCount').textContent = n;
  bar.hidden = !(state.selectMode && n >= 1);
}
function onListClick(e) {
  const check = e.target.closest('.ev-check');
  if (check) { toggleSelect(check.dataset.check, check); return; }
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) { openDetail(editBtn.dataset.edit); return; }
  const gh = e.target.closest('.group-head');
  if (gh) {
    const g = gh.closest('.group');
    const fam = g.dataset.fam;
    const collapsed = g.classList.toggle('collapsed');
    if (collapsed) state.collapsedFams.add(fam); else state.collapsedFams.delete(fam);
    return;
  }
  const row = e.target.closest('.ev-row');
  if (row && !state.selectMode) openDetail(row.dataset.id);
}
function runBatch(kind) {
  const sel = getSelected();
  if (!sel.length) { toast('请先勾选事件'); return; }
  if (kind === 'delete') {
    if (!confirm('确定删除所选 ' + sel.length + ' 个事件？此操作不可撤销。')) return;
    const ids = new Set(sel.map(e => e.id));
    state.events = state.events.filter(e => !ids.has(e.id));
    ids.forEach(id => state.selected.delete(id));
    if (state.editingId && ids.has(state.editingId)) state.editingId = null;
    refreshAfterBatch(sel.length);
    toast('已删除 ' + sel.length + ' 个事件', 'ok');
  }
  else if (kind === 'clear') { state.selected.clear(); state.selectMode = false; $('#selectMode').checked = false; renderList(); updateBatchbar(); }
  else if (kind === 'duplicate') {
    let n = 0;
    for (const e of sel) {
      const c = JSON.parse(JSON.stringify(e));
      c.id = 'ev_' + Math.random().toString(36).slice(2, 9);
      c.uid = e.uid + '-c' + (Math.floor(Math.random() * 900) + 100);
      state.events.push(c); n++;
    }
    state.selected.clear(); renderAll(); updateBatchbar();
    toast('已复制 ' + n + ' 个事件（UID 已加后缀）', 'ok');
  }
  else if (kind === 'shiftUp') shiftSelected(1);
  else if (kind === 'shiftDown') shiftSelected(-1);
  else if (kind === 'shiftCustom') openShiftCustom();
  else if (kind === 'rename') openRename();
  else if (kind === 'props') openProps();
  else if (kind === 'rrule') openRuleModal();
}
function shiftDateValue(v, delta) {
  if (/^\d{8}$/.test(v)) return core.shiftYearDate(v, delta);
  if (/^\d{8}T\d{6}Z?$/.test(v)) return core.shiftYearDate(v.slice(0, 8), delta) + v.slice(8);
  return v;
}
function shiftSelected(n, silent) {
  let cnt = 0;
  for (const ev of getSelected()) {
    const oldY = ev.dtstart ? yearOf(ev) : null;
    if (ev.dtstart) ev.dtstart.value = shiftDateValue(ev.dtstart.value, n);
    if (ev.dtend) ev.dtend.value = shiftDateValue(ev.dtend.value, n);
    if (oldY) ev.uid = core.setYearSuffix(ev.uid, +oldY + n);
    cnt++;
  }
  refreshAfterBatch(cnt);
  if (!silent) toast('已平移 ' + cnt + ' 个事件' + (n >= 0 ? ' +' + n : ' ' + n) + ' 年', 'ok');
}
function refreshAfterBatch(cnt) {
  state.selected.clear();
  renderAll();
  updateBatchbar();
}
function renameSelected(find, rep) {
  let cnt = 0;
  for (const ev of getSelected()) {
    if (find && (ev.summary || '').includes(find)) { ev.summary = ev.summary.split(find).join(rep); cnt++; }
  }
  refreshAfterBatch(cnt);
  toast('已重命名 ' + cnt + ' 个事件', 'ok');
}

/* ---------------- 批量弹窗 ---------------- */
function openShiftCustom() {
  const n = getSelected().length;
  openModal({ title: '按年平移', body:
    '<p style="margin:0 0 12px;color:var(--ink-soft);font-size:13px;">为所选 <b>' + n + '</b> 个事件按「年」平移日期，并同步更新 UID 年份后缀。正值向后、负值向前。</p>' +
    '<div class="field"><label>平移年数</label><input class="input" id="mYears" type="number" value="1" step="1"></div>',
    foot: '<button class="btn" id="mShift">平移</button><button class="btn ghost" id="mCancel">取消</button>' });
  $('#mShift').addEventListener('click', () => { const v = +$('#mYears').value || 0; closeModal(); if (v) shiftSelected(v); });
  $('#mCancel').addEventListener('click', closeModal);
}
function openShiftCalYear() {
  openModal({ title: '整份日历年份平移', body:
    '<p style="margin:0 0 12px;color:var(--ink-soft);font-size:13px;">对整个日历的所有事件按年平移（含单次与每年重复事件）。用于批量搬迁到新的年份区间。</p>' +
    '<div class="field"><label>平移年数</label><input class="input" id="mYears" type="number" value="1" step="1"></div>',
    foot: '<button class="btn" id="mShift">平移</button><button class="btn ghost" id="mCancel">取消</button>' });
  $('#mShift').addEventListener('click', () => {
    const v = +$('#mYears').value || 0; closeModal();
    const keep = getSelected().map(e => e.id);
    state.selected = new Set(state.events.map(e => e.id));
    shiftSelected(v, true);
    state.selected = new Set(keep);
    renderAll(); updateBatchbar();
    toast('已平移整份日历 ' + v + ' 年', 'ok');
  });
  $('#mCancel').addEventListener('click', closeModal);
}
function openRename() {
  const n = getSelected().length;
  openModal({ title: '批量重命名', body:
    '<p style="margin:0 0 12px;color:var(--ink-soft);font-size:13px;">在所选 <b>' + n + '</b> 个事件的标题中查找并替换文本。</p>' +
    '<div class="row2"><div class="field"><label>查找</label><input class="input" id="mFind"></div>' +
    '<div class="field"><label>替换为</label><input class="input" id="mRep"></div></div>',
    foot: '<button class="btn" id="mRename">执行</button><button class="btn ghost" id="mCancel">取消</button>' });
  $('#mRename').addEventListener('click', () => { const f = $('#mFind').value, r = $('#mRep').value; closeModal(); renameSelected(f, r); });
  $('#mCancel').addEventListener('click', closeModal);
}
function openProps() {
  const n = getSelected().length;
  openModal({ title: '批量属性', body:
    '<p style="margin:0 0 12px;color:var(--ink-soft);font-size:13px;">为所选 <b>' + n + '</b> 个事件设置公共属性（“保持”表示不修改）。</p>' +
    '<div class="field"><label>状态</label><select class="sel" id="mStat"><option value="">保持</option>' + selOptions([['CONFIRMED', '已确认'], ['TENTATIVE', '暂定'], ['CANCELLED', '已取消']], '') + '</select></div>' +
    '<div class="field"><label>透明度</label><select class="sel" id="mTransp"><option value="">保持</option>' + selOptions([['TRANSPARENT', '透明（不占用）'], ['OPAQUE', '不透明（占用）']], '') + '</select></div>' +
    '<div class="field"><label>地点</label><input class="input" id="mLoc" placeholder="留空保持；输入则覆盖"></div>' +
    '<div class="field"><label>备注</label><textarea class="ta" id="mDesc" placeholder="留空保持；输入则覆盖"></textarea></div>',
    foot: '<button class="btn" id="mPropsOk">应用</button><button class="btn ghost" id="mCancel">取消</button>' });
  $('#mPropsOk').addEventListener('click', () => {
    const stat = $('#mStat').value, transp = $('#mTransp').value, loc = $('#mLoc').value.trim(), desc = $('#mDesc').value;
    let cnt = 0;
    for (const ev of getSelected()) {
      if (stat) ev.status = stat;
      if (transp) ev.transp = transp;
      if (loc) ev.location = loc;
      if (desc !== '') ev.description = desc;
      cnt++;
    }
    closeModal(); refreshAfterBatch(cnt); toast('已应用属性到 ' + cnt + ' 个事件', 'ok');
  });
  $('#mCancel').addEventListener('click', closeModal);
}
function openRuleModal() {
  const n = getSelected().length;
  openModal({ title: '批量设置规则', wide: true, body:
    '<p style="margin:0 0 10px;color:var(--ink-soft);font-size:13px;">为所选 <b>' + n + '</b> 个事件设置重复规则。</p>' +
    '<div class="opts" id="rOpts">' +
    '<div class="opt-row" data-val="clear"><span class="oi">✖</span><span><span class="ot">转为单次</span><br><span class="od">清除所选事件的 RRULE</span></span></div>' +
    '<div class="opt-row" data-val="yearly"><span class="oi">↻</span><span><span class="ot">每年固定日期</span><br><span class="od">按所选“月份+日期”每年重复</span></span></div>' +
    '<div class="opt-row" data-val="nth"><span class="oi">📅</span><span><span class="ot">每年第 N 个星期</span><br><span class="od">如“每年 5 月第 2 个周日”</span></span></div></div>' +
    '<div id="rConfig" style="display:none;margin-top:14px"></div>',
    foot: '<button class="btn" id="mRuleOk">应用</button><button class="btn ghost" id="mCancel">取消</button>' });
  let choice = '';
  $('#rOpts').addEventListener('click', e => {
    const row = e.target.closest('.opt-row');
    if (!row) return;
    $$('#rOpts .opt-row').forEach(r => r.classList.toggle('on', r === row));
    choice = row.dataset.val;
    const cfg = $('#rConfig');
    cfg.style.display = '';
    if (choice === 'yearly') cfg.innerHTML = '<div class="field"><label>日期</label></div><div class="rule-selects">' + monthSel('bRMonth', 1) + daySel('bRDay', 1) + '</div>';
    else if (choice === 'nth') cfg.innerHTML = '<div class="field"><label>星期</label></div><div class="rule-selects">' + monthSel('bRMonthW', 1) + nthSel('bRNth', '2') + weekdaySel('bRWeekday', 'SU') + '</div>';
    else cfg.innerHTML = '';
  });
  $('#mRuleOk').addEventListener('click', () => {
    let rule = null;
    if (choice === 'yearly') { const m = $('#bRMonth').value, d = $('#bRDay').value; rule = { FREQ: 'YEARLY', BYMONTH: m, BYMONTHDAY: d }; }
    else if (choice === 'nth') { const m = $('#bRMonthW').value, n2 = $('#bRNth').value, w = $('#bRWeekday').value; rule = { FREQ: 'YEARLY', BYMONTH: m, BYDAY: (n2 === '-1' ? '-1' : n2) + w }; }
    let cnt = 0;
    for (const ev of getSelected()) { ev.rrule = rule; cnt++; }
    closeModal(); refreshAfterBatch(cnt); toast('已设置规则到 ' + cnt + ' 个事件', 'ok');
  });
  $('#mCancel').addEventListener('click', closeModal);
}

/* ---------------- 模态 ---------------- */
function openModal(opts) {
  $('#modalTitle').textContent = opts.title;
  $('#modalBody').innerHTML = opts.body || '';
  $('#modalFoot').innerHTML = opts.foot || '';
  $('#modal').classList.toggle('wide', !!opts.wide);
  $('#modalOverlay').hidden = false;
}
function closeModal() {
  $('#modalOverlay').hidden = true;
  $('#modalBody').innerHTML = '';
  $('#modalFoot').innerHTML = '';
}
function openSource() {
  openModal({ title: '更换来源', body:
    '<p style="margin:0 0 12px;color:var(--ink-soft);font-size:13px;">输入任意 iCalendar 订阅地址或文件地址，编辑器会抓取并解析。默认使用本仓库的在线文件。</p>' +
    '<div class="field"><label>订阅地址</label><input class="input" id="mUrl" value="' + escAttr(DEFAULT_URL) + '" spellcheck="false"></div>' +
    '<div class="hint" style="color:var(--ink-faint);font-size:11px;">GitHub Raw：' + esc(DEFAULT_URL) + '</div>',
    foot: '<button class="btn" id="mSourceOk">加载</button><button class="btn ghost" id="mCancel">取消</button>' });
  $('#mSourceOk').addEventListener('click', () => { const u = $('#mUrl').value.trim(); closeModal(); if (u) loadUrl(u); });
  $('#mCancel').addEventListener('click', closeModal);
}
function openPaste() {
  openModal({ title: '粘贴 ICS 文本', wide: true, body:
    '<p style="margin:0 0 10px;color:var(--ink-soft);font-size:13px;">将以 <code>BEGIN:VCALENDAR</code> 开头的完整文本粘贴到下面。</p>' +
    '<textarea class="ta big" id="mPaste" placeholder="BEGIN:VCALENDAR\n…\nEND:VCALENDAR"></textarea>',
    foot: '<button class="btn" id="mPasteOk">解析</button><button class="btn ghost" id="mCancel">取消</button>' });
  $('#mPasteOk').addEventListener('click', () => { const t = $('#mPaste').value; closeModal(); if (t.trim()) loadText(t, '粘贴文本'); });
  $('#mCancel').addEventListener('click', closeModal);
}

/* ---------------- 导出 ---------------- */
const EXPORTS = [
  { i: '⬇', t: '下载 .ics 文件', d: '保存为当前编辑内容', cls: '' },
  { i: '📋', t: '复制完整 ICS', d: '复制到剪贴板（订阅用）', cls: '' },
  { i: '🗂', t: '复制订阅链接', d: '复制在线源地址', cls: '' },
  { i: '🧾', t: '导出 JSON', d: '结构化描述所有事件', cls: '' },
];
function toggleMenu() {
  const menu = $('#exportMenu');
  if (!menu.hidden) { menu.hidden = true; return; }
  menu.innerHTML = EXPORTS.map((x, i) =>
    '<button data-exp="' + i + '" class="' + x.cls + '"><span class="mi">' + x.i + '</span><span>' + x.t + '<span class="mg">' + x.d + '</span></span></button>').join('');
  menu.hidden = false;
  $$('#exportMenu button').forEach(b => b.addEventListener('click', e => {
    const idx = +b.dataset.exp;
    menu.hidden = true;
    if (idx === 0) downloadICS();
    else if (idx === 1) copyICS();
    else if (idx === 2) copySub();
    else if (idx === 3) copyJSON();
  }));
}
function downloadICS() {
  const text = serializeICS();
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName();
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 800);
  toast('已下载 ' + fileName(), 'ok');
}
function fileName() {
  let n = (state.sourceName || 'calendar').split('/').pop().split('?')[0];
  if (!/.ics$/i.test(n)) n += '.ics';
  return n || 'calendar.ics';
}
async function copyICS() {
  const ok = await copyText(serializeICS());
  toast(ok ? '已复制完整 ICS' : '复制失败', ok ? 'ok' : 'err');
}
async function copySub() {
  const ok = await copyText(DEFAULT_URL);
  toast(ok ? '已复制订阅链接' : '复制失败', ok ? 'ok' : 'err');
}
async function copyJSON() {
  const data = state.events.map(e => ({
    uid: e.uid, summary: e.summary,
    start: e.dtstart ? core.icsDateToDisplay(e.dtstart.value) : null,
    end: e.dtend ? core.icsDateToDisplay(e.dtend.value) : null,
    rrule: e.rrule ? core.rruleToString(e.rrule) : null,
    status: e.status, transp: e.transp, location: e.location, description: e.description,
  }));
  const ok = await copyText(JSON.stringify(data, null, 2));
  toast(ok ? '已导出 JSON' : '复制失败', ok ? 'ok' : 'err');
}

/* ---------------- 初始化 ---------------- */
function init() {
  $('#btnImport').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) { const r = new FileReader(); r.onload = () => loadText(r.result, f.name); r.readAsText(f); }
    e.target.value = '';
  });
  $('#btnPaste').addEventListener('click', openPaste);
  $('#btnSource').addEventListener('click', openSource);
  $('#btnLoadUrl').addEventListener('click', () => loadUrl($('#urlInput').value.trim()));
  $('#btnLoadDefault').addEventListener('click', () => loadUrl(DEFAULT_URL));
  $('#btnExport').addEventListener('click', toggleMenu);
  document.addEventListener('click', e => { if (!e.target.closest('.wrap')) $('#exportMenu').hidden = true; });
  $('#btnCalInfo').addEventListener('click', openCalInfo);
  $('#btnAdd').addEventListener('click', newEvent);
  $('#closePanel').addEventListener('click', closePanel);
  $('#search').addEventListener('input', e => { state.search = e.target.value; renderList(); });
  $('#yearFilter').addEventListener('change', e => { state.year = e.target.value; renderList(); });
  $('#typeFilter').addEventListener('change', e => { state.type = e.target.value; renderList(); });
  $('#selectMode').addEventListener('change', e => {
    state.selectMode = e.target.checked;
    if (!state.selectMode) state.selected.clear();
    renderList(); updateBatchbar();
  });
  $('#groupMode').addEventListener('change', e => { state.groupMode = e.target.checked; renderList(); });
  $('#batchbar').addEventListener('click', e => { const b = e.target.closest('[data-batch]'); if (b) runBatch(b.dataset.batch); });
  $('#events').addEventListener('click', onListClick);
  $('#closeModal').addEventListener('click', closeModal);
  $('#modalOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  $('#urlInput').value = DEFAULT_URL;
  loadUrl(DEFAULT_URL);
}
document.addEventListener('DOMContentLoaded', init);
