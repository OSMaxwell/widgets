// node widgets/github/test.mjs — checks the GraphQL parser (gi:// imports stripped).
import assert from 'node:assert';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./widget.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '');
const {parseCalendar, endpoint, gridLayout} = await import(`data:text/javascript,${encodeURIComponent(src)}`);

const week = levels => ({contributionDays: levels.map(contributionLevel => ({contributionLevel}))});
const json = {data: {viewer: {url: 'u', login: 'me', name: null, avatarUrl: 'a', contributionsCollection: {contributionCalendar: {
  totalContributions: 7,
  weeks: [week(['FOURTH_QUARTILE']), ...Array(26).fill(week(['NONE', 'SECOND_QUARTILE', 'bogus']))],
}}}}};
const parsed = parseCalendar(json);

assert.equal(parsed.weeks.length, 27);
assert.equal(parsed.name, 'me');
assert.deepEqual(parsed.weeks[0], [4]);
assert.deepEqual(parsed.weeks[1], [0, 2, 0]);
assert.equal(parsed.total, 7);
assert.throws(() => parseCalendar({errors: [{message: 'Bad credentials'}]}), /Bad credentials/);
assert.equal(endpoint('github.com'), 'https://api.github.com/graphql');
assert.equal(endpoint('ghe.example.com'), 'https://ghe.example.com/api/graphql');
// medium tile 454x220: 17px squares, 21 weeks; grid must fit inside the padding
const {cell, weeks} = gridLayout(454, 220);
assert.deepEqual({cell, weeks}, {cell: 17, weeks: 21});
assert.ok(weeks * (cell + 3) - 3 <= 454 - 32 && 40 + 10 + 7 * (cell + 3) - 3 <= 220 - 32);
assert.equal(gridLayout(4000, 454).weeks, 53);
console.log('ok');
