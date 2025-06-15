/// 仅每年重复的公历节日可以使用

function gstr({ month, day, name, year }) {
  if (!year) year = '2024';
  return `BEGIN:VEVENT
UID:${toLengthedStr(month)}${toLengthedStr(day)}
SUMMARY:${name}
DTSTART;TZID=Asia/Shanghai:${year}${toLengthedStr(month)}${toLengthedStr(day)}
DTEND;TZID=Asia/Shanghai:${year}${toLengthedStr(month)}${toLengthedStr(day + 1)}
RRULE:FREQ=YEARLY;BYMONTH=${month};BYMONTHDAY=${day}
STATUS:CONFIRMED
TRANSP:TRANSPARENT
END:VEVENT`;

  function toLengthedStr(int) {
    if (int.toString().length === 1) {
      return `0${int}`;
    } else {
      return int.toString();
    }
  }
}

console.log([
  {
    month: 7,
    day: 2,
    name: '世界 UFO 日'
  }
].map(e => gstr(e)).join('\n'));