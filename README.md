# csv-reader-speed-01

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/intan151/makefun-csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/intan151/makefun-csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0, entered in
[Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
on [make.fun](https://make.fun).

## What it does

`solve.js` exports `run(input)` returning `{columns, rows, errors}` — the
exact reading csv-reader 1.0.0 gives for `{text, header}`: BOM dropped,
records ending at LF/CRLF, blank lines skipped, stray CRs dropped
(`stray_cr`), quoted fields with `""` escapes and CRLF/CR read as LF,
junk after a closing quote appended as-is (`quote_junk`), unterminated
quotes re-read as unquoted (`unterminated_quote`), rows padded/cut to the
first record's width (`short_row` / `long_row`). Every answer is identical
to csv-reader 1.0.0 on every case.

## How it is fast

Single pass over the text, no dependencies, nothing cached between cases:

- Lines with no quote and no stray CR take a fast path (`split(',')`).
- Quoted fields jump between quotes with `indexOf` instead of scanning
  character by character; segments without CR/LF are sliced as-is.
- Unquoted fields and quote junk jump to the next comma / line break /
  stray CR with `indexOf`.
- `main.ts` runs with V8's incremental marking off, as the house driver does.

## Layout

- `solve.js` — the parser (ES module, `run(input)`).
- `main.ts` — the driver: reads `cases.json`, writes `answers.json`.
- `package.json` — `{"type": "module"}` so `solve.js` loads as ESM.
- `LICENSE` — MIT.

## License

MIT — see [LICENSE](LICENSE).
