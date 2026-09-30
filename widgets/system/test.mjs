// node widgets/system/test.mjs — checks the /proc parsers (gi:// imports stripped).
import assert from 'node:assert';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./widget.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '');
const {cpuTimes, memUsage} = await import(`data:text/javascript,${encodeURIComponent(src)}`);

assert.deepEqual(cpuTimes('cpu  10 0 10 70 10 0 0 0 0 0\ncpu0 1'), [20, 100]);
assert.deepEqual(memUsage('MemTotal:  1000 kB\nMemFree: 1 kB\nMemAvailable:  250 kB\n'), [750, 1000]);
console.log('ok');
