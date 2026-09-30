// node widgets/github/test.mjs — checks the GraphQL parser (gi:// imports stripped).
import assert from 'node:assert';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./widget.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '');
const {parseCalendar, endpoint} = await import(`data:text/javascript,${encodeURIComponent(src)}`);

const week = levels => ({contributionDays: levels.map(contributionLevel => ({contributionLevel}))});
const json = {data: {viewer: {url: 'u', contributionsCollection: {contributionCalendar: {
  totalContributions: 7,
  weeks: [week(['FOURTH_QUARTILE']), ...Array(26).fill(week(['NONE', 'SECOND_QUARTILE', 'bogus']))],
}}}}};
const parsed = parseCalendar(json);

assert.equal(parsed.weeks.length, 26);
assert.deepEqual(parsed.weeks[0], [0, 2, 0]);
assert.equal(parsed.total, 7);
assert.throws(() => parseCalendar({errors: [{message: 'Bad credentials'}]}), /Bad credentials/);
assert.equal(endpoint('github.com'), 'https://api.github.com/graphql');
assert.equal(endpoint('ghe.example.com'), 'https://ghe.example.com/api/graphql');
console.log('ok');
