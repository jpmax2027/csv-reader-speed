# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/jpmax2027/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/jpmax2027/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A from-scratch CSV reader built for speed, matching the csv-reader 1.0.0
semantics exactly — including its broken-row behaviour (BOM drop,
blank-line skipping, stray CRs, quote junk, unterminated quotes, short-row
padding and long-row cutting, with errors reported in encounter order).

Instead of the reference's character-at-a-time concatenation, `solve.js`
parses by slicing: `indexOf`-driven field cutting, an incrementally tracked
next-CR position so all scans together stay linear, a fast path for whole
clean records, and a quoted-field fast path with a segment-cutting slow
walk for escapes. Verified against the reference implementation with 156
hand-written differential tests and 4,000 randomized fuzz tests (all
identical), and about 2.6–3.2× faster than the baseline on the practice
set.

## Run it

```sh
node main.ts
```

`main.ts` is the competition driver: it reads `/input/cases.json` and
writes `/output/answers.json`, calling `run(input)` from `solve.js` for
each case.

## License

MIT — see [LICENSE](LICENSE).

---
<sub>Entered on [make.fun](https://make.fun/?ref=zbqpv30a&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
