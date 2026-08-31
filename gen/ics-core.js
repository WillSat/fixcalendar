/* ============================================================================
 * ics-core.js — 纯函数：iCalendar(ICS) 的解析 / 序列化 / RRULE / 日期 / 转义
 * 不依赖 DOM，可单独在 Node 中测试。
 * ============================================================================ */

/* ---------- 文本转义（TEXT 值） ---------- */
function escapeText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function unescapeText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\\r\\n|\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/* ---------- 折行 / 展开 与 字节长度 ---------- */
function byteLen(s) {
  return new TextEncoder().encode(s).length;
}

function foldLine(line) {
  if (byteLen(line) <= 73) return [line];
  const out = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const b = byteLen(ch);
    if (curBytes + b > 73 && cur) {
      out.push(cur);
      cur = ch;
      curBytes = b;
    } else {
      cur += ch;
      curBytes += b;
    }
  }
  if (cur) out.push(cur);
  return out.map((seg, i) => (i === 0 ? seg : ' ' + seg));
}

function unfoldICS(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .reduce((acc, line) => {
      if ((line.startsWith(' ') || line.startsWith('\t')) && acc.length) {
        acc[acc.length - 1] += line.slice(1);
      } else {
        acc.push(line);
      }
      return acc;
    }, []);
}

/* ---------- 行解析：NAME;PARAM=V;...:VALUE ---------- */
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return { name: line.trim().toUpperCase(), params: {}, value: '' };
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(';');
  const name = parts[0].toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const eq = p.indexOf('=');
    if (eq >= 0) {
      let k = p.slice(0, eq).toUpperCase();
      let v = p.slice(eq + 1);
      if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
      k = k.trim();
      params[k.trim()] = v;
    }
  }
  return { name, params, value };
}

/* ---------- RRULE ---------- */
function parseRRule(s) {
  if (!s) return null;
  const o = {};
  for (const part of String(s).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    o[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return Object.keys(o).length ? o : null;
}

function rruleToString(o) {
  if (!o) return '';
  const parts = [];
  if (o.FREQ) parts.push('FREQ=' + o.FREQ);
  if (o.INTERVAL) parts.push('INTERVAL=' + o.INTERVAL);
  if (o.COUNT) parts.push('COUNT=' + o.COUNT);
  if (o.UNTIL) parts.push('UNTIL=' + o.UNTIL);
  if (o.BYMONTH) parts.push('BYMONTH=' + o.BYMONTH);
  if (o.BYDAY) parts.push('BYDAY=' + o.BYDAY);
  if (o.BYMONTHDAY) parts.push('BYMONTHDAY=' + o.BYMONTHDAY);
  return parts.join(';');
}

/* ---------- 组件解析 ---------- */
function parseComponents(lines) {
  let root = null;
  const stack = [];
  for (const raw of lines) {
    const ln = parseLine(raw);
    if (ln.name === 'BEGIN') {
      const c = { name: String(ln.value).trim().toUpperCase(), properties: [], components: [] };
      if (stack.length === 0) root = c;
      else stack[stack.length - 1].components.push(c);
      stack.push(c);
    } else if (ln.name === 'END') {
      if (stack.length) stack.pop();
    } else if (ln.name) {
      if (stack.length) stack[stack.length - 1].properties.push(ln);
    }
  }
  return root || { name: 'VCALENDAR', properties: [], components: [] };
}

/* ---------- 事件模型 ---------- */
function componentsToEvents(root) {
  const events = [];
  for (const comp of root.components) {
    if (comp.name !== 'VEVENT') continue;
    const ev = {
      id: 'ev_' + Math.random().toString(36).slice(2, 9),
      uid: '',
      summary: '',
      dtstart: null,
      dtend: null,
      rrule: null,
      description: '',
      location: '',
      status: '',
      transp: '',
      extraProps: [],
    };
    for (const p of comp.properties) {
      switch (p.name) {
        case 'UID': ev.uid = p.value; break;
        case 'SUMMARY': ev.summary = unescapeText(p.value); break;
        case 'DTSTART': ev.dtstart = { value: p.value, params: p.params || {} }; break;
        case 'DTEND': ev.dtend = { value: p.value, params: p.params || {} }; break;
        case 'RRULE': ev.rrule = parseRRule(p.value); break;
        case 'DESCRIPTION': ev.description = unescapeText(p.value); break;
        case 'LOCATION': ev.location = unescapeText(p.value); break;
        case 'STATUS': ev.status = p.value; break;
        case 'TRANSP': ev.transp = p.value; break;
        default:
          ev.extraProps.push({ name: p.name, params: p.params || {}, value: p.value });
      }
    }
    events.push(ev);
  }
  return events;
}

/* ---------- 整份 ICS 解析 ---------- */
function parseICS(text) {
  const lines = unfoldICS(text);
  const root = parseComponents(lines);
  const events = componentsToEvents(root);
  return { root, events };
}

/* ---------- 单个属性序列化 ---------- */
function emitProp(lines, p) {
  let left = p.name;
  const params = p.params || {};
  for (const k of Object.keys(params)) {
    const v = params[k];
    left += ';' + k + '=' + (v.includes(':') || v.includes(';') || v.includes(',') || v.includes('"')
      ? '"' + v + '"'
      : v);
  }
  const line = left + ':' + p.value;
  lines.push.apply(lines, foldLine(line));
}

function emitCalendarProps(lines, props) {
  for (const p of props) emitProp(lines, p);
}

/* ---------- 事件序列化 ---------- */
function serializeEvent(ev) {
  const lines = [];
  lines.push('BEGIN:VEVENT');
  emitProp(lines, { name: 'UID', params: {}, value: ev.uid || ('ev_' + Date.now()) });
  if (ev.summary != null) emitProp(lines, { name: 'SUMMARY', params: {}, value: escapeText(ev.summary) });
  if (ev.dtstart) emitProp(lines, { name: 'DTSTART', params: ev.dtstart.params || { VALUE: 'DATE' }, value: ev.dtstart.value });
  if (ev.dtend) emitProp(lines, { name: 'DTEND', params: ev.dtend.params || { VALUE: 'DATE' }, value: ev.dtend.value });
  if (ev.rrule) emitProp(lines, { name: 'RRULE', params: {}, value: rruleToString(ev.rrule) });
  if (ev.description) emitProp(lines, { name: 'DESCRIPTION', params: {}, value: escapeText(ev.description) });
  if (ev.location) emitProp(lines, { name: 'LOCATION', params: {}, value: escapeText(ev.location) });
  if (ev.status) emitProp(lines, { name: 'STATUS', params: {}, value: ev.status });
  if (ev.transp) emitProp(lines, { name: 'TRANSP', params: {}, value: ev.transp });
  for (const x of ev.extraProps || []) emitProp(lines, x);
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

/* ---------- 整份 ICS 序列化 ---------- */
function serializeCalendar(cal) {
  const lines = [];
  lines.push('BEGIN:VCALENDAR');
  emitCalendarProps(lines, cal.properties || []);
  for (const ev of cal.events) lines.push(serializeEvent(ev));
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/* ---------- 日期辅助 ---------- */
function pad2(n) { return String(n).padStart(2, '0'); }

function dateToICS(d) { return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }

function icsToDate(s) {
  if (/^\d{8}$/.test(s)) return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  if (/^\d{8}T\d{6}(Z)?$/.test(s)) {
    const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
    const hh = +s.slice(9, 11), mm = +s.slice(11, 13), ss = +s.slice(13, 15);
    if (s.endsWith('Z')) return new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
    return new Date(y, m - 1, d, hh, mm, ss);
  }
  return null;
}

function icsDateToDisplay(s) {
  if (/^\d{8}$/.test(s)) return s.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  if (/^\d{8}T\d{6}Z?$/.test(s)) {
    const base = s.replace(/(\d{4})(\d{2})(\d{2})T(\d{4})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
    return s.endsWith('Z') ? base + 'Z' : base;
  }
  return s;
}

function displayToICSDate(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return m[1] + m[2] + m[3];
}

function whichDateType(dt) {
  if (!dt || !dt.value) return 'date';
  if (/^\d{8}$/.test(dt.value)) return 'date';
  if (/^\d{8}T\d{6}Z?$/.test(dt.value)) return 'datetime';
  return 'unknown';
}

function shiftYearDate(s, n) {
  if (!/^\d{8}$/.test(s)) return s;
  let y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
  const ny = y + n;
  let nd = d;
  if (m === 2 && d === 29) nd = 28;
  return '' + ny + pad2(m) + pad2(nd);
}

function yearSuffixOf(uid) {
  const m = String(uid).match(/(\d{2,4})$/);
  return m ? m[1] : null;
}

function setYearSuffix(uid, year) {
  // year: 4 位年份；保留原后缀位数（2 位用 2 位，4 位用 4 位，无则追加 2 位）
  const m = String(uid).match(/(\d{2,4})$/);
  const two = String(year % 100);
  const four = String(year);
  if (!m) return uid + two;
  const run = m[1];
  if (run.length === 4) return uid.slice(0, -4) + four;
  return uid.slice(0, -run.length) + two;
}

function familyKey(ev) {
  const s = (ev.summary || '').trim();
  if (s) return s;
  const base = String(ev.uid || '').replace(/\d+$/, '');
  return base || '未命名';
}

/* ---------- 导出模块 ---------- */
const core = {
  escapeText, unescapeText, foldLine, unfoldICS, parseLine,
  parseRRule, rruleToString, parseICS, serializeCalendar, serializeEvent,
  dateToICS, icsToDate, icsDateToDisplay, displayToICSDate, whichDateType,
  shiftYearDate, yearSuffixOf, setYearSuffix, familyKey,
};
if (typeof module !== 'undefined' && module.exports) module.exports = core;
if (typeof window !== 'undefined') window.core = core;

