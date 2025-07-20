function maker(obj) {

  const tempArr = [];

  for (const event of obj) {
    tempArr.push(`BEGIN:VEVENT
UID:${event[0]}#${event[1]}-${event[2]}@fixcalendar-additional-waitwill
SUMMARY:${event[0]}
DTSTART;TZID=Asia/Shanghai:${event[1]}
DTEND;TZID=Asia/Shanghai:${event[2]}${event[3] ? '\n' + event[3] : ''}
STATUS:CONFIRMED
TRANSP:TRANSPARENT
END:VEVENT`);
  }

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:fixcalendar-additional-waitwill
CALSCALE:GREGORIAN
X-WR-CALNAME:节假日补充+
X-APPLE-LANGUAGE:zh
X-APPLE-REGION:CN
${tempArr.join('\n')}
END:VCALENDAR`;
}