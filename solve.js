// Fast drop-in for make.fun's csv-reader 1.0.0, written from the competition
// spec (competition.yaml / RULES.txt). Single pass: a fast path for lines
// without quotes, indexOf jumps between quotes, and a tight charCodeAt loop
// for unquoted fields; no dependencies, no caching.
//
// Semantics (from the spec):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (error stray_cr).
// - A field opening with a quote runs to the next non-doubled quote; "" is
//   one quote, CRLF / lone CR inside it read as LF; text after the closing
//   quote up to the next comma or line break is appended as-is (error
//   quote_junk when the field ends); a quote that never closes is a literal
//   and the text after it is read again as unquoted (error
//   unterminated_quote). A quote inside an unquoted field is literal.
// - Fields stay strings, never trimmed or converted.
// - columns is the first record when header is true, else null (an empty
//   input with header true gives []); rows are padded with "" (short_row,
//   with fields: its field count) or cut (long_row, with extra: the cut
//   fields) to the first record's width.
// - Errors are {code, line, row} in the order met; line is the 1-based line
//   the record starts on (counting every LF, CRLF and lone CR inside
//   quotes); row is the record's index in rows, null for the header.

/** Count line breaks (LF, CRLF, lone CR) in s; each counts once. */
function countBreaks(s) {
  let c = 0;
  for (let k = 0, m = s.length; k < m; k++) {
    const ch = s.charCodeAt(k);
    if (ch === 10) c++;
    else if (ch === 13) {
      c++;
      if (s.charCodeAt(k + 1) === 10) k++;
    }
  }
  return c;
}

export function run(input) {
  const text = input.text;
  const header = input.header;
  const n = text.length;
  let i = 0;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1; // drop leading BOM
  let line = 1; // 1-based line of the text at position i
  let done = 0; // records completed (header counts)
  let first = true;
  let width = 0;
  let columns = null;
  const rows = [];
  const errors = [];

  while (i < n) {
    const recLine = line;
    let fields = null;

    // ---- fast path: this record's first line holds no quote / stray CR ----
    // (No quote on the line means no quoted field can start here, so the
    // record ends at this line's break; the slice bounds every scan.)
    const lf = text.indexOf('\n', i);
    const lineEnd = lf === -1 ? n : lf;
    let end = lineEnd;
    if (lf !== -1 && end > i && text.charCodeAt(end - 1) === 13) end--; // CRLF
    if (end === i) {
      // Blank line: no record.
      i = lf === -1 ? n : lf + 1;
      line++;
      continue;
    }
    const lineStr = text.slice(i, end);
    if (lineStr.indexOf('"') === -1 && lineStr.indexOf('\r') === -1) {
      fields = lineStr.split(',');
      i = lf === -1 ? n : lf + 1;
      line++;
    } else {
      // ---- slow path: field by field (quoted fields may span lines) ----
      const f = [];
      let hadContent = false;
      let recEnded = false;
      while (!recEnded) {
        let value;
        let term; // 0 comma, 1 LF, 2 CRLF, 3 EOF
        let unqStart = -1;
        let unqPrefix = null;
        if (i < n && text.charCodeAt(i) === 34) {
          // ----- quoted field -----
          hadContent = true;
          let j = i + 1;
          let segStart = i + 1;
          let parts = null;
          let breaks = 0;
          let closing = -1;
          for (;;) {
            const q = text.indexOf('"', j);
            if (q === -1) break; // no closing quote before EOF
            if (text.charCodeAt(q + 1) === 34) {
              // Doubled quote: one literal quote in the value.
              if (parts === null) parts = [];
              const s = text.slice(segStart, q);
              if (s.indexOf('\r') !== -1) {
                parts.push(s.replace(/\r\n?/g, '\n'));
                breaks += countBreaks(s);
              } else {
                parts.push(s);
                if (s.indexOf('\n') !== -1) breaks += countBreaks(s);
              }
              parts.push('"');
              j = q + 2;
              segStart = j;
              continue;
            }
            closing = q;
            break;
          }
          if (closing === -1) {
            // Unterminated: the quote is literal; re-read as unquoted.
            errors.push({ code: 'unterminated_quote', line: recLine, row: header ? (done === 0 ? null : done - 1) : done });
            unqStart = i + 1;
            unqPrefix = '"';
          } else {
            const s = text.slice(segStart, closing);
            let v;
            if (s.indexOf('\r') !== -1) {
              v = s.replace(/\r\n?/g, '\n');
              breaks += countBreaks(s);
            } else {
              v = s;
              if (s.indexOf('\n') !== -1) breaks += countBreaks(s);
            }
            line += breaks;
            value = parts === null ? v : (parts.push(v), parts.join(''));
            // ----- junk after the closing quote, as it stands -----
            // Fast path: usually the next char is the field/record terminator.
            const afterQ = text.charCodeAt(closing + 1);
            if (afterQ === 44) { term = 0; i = closing + 2; }
            else if (afterQ === 10) { term = 1; i = closing + 2; line++; }
            else if (afterQ === 13 && text.charCodeAt(closing + 2) === 10) { term = 2; i = closing + 3; line++; }
            else if (closing + 1 >= n) { term = 3; i = n; }
            else {
            // ----- junk scan (only when real junk follows) -----
            let junk = null;
            let junkLen = 0;
            let s2 = closing + 1;
            let j2 = closing + 1;
            for (;;) {
              const c = text.indexOf(',', j2);
              const l = text.indexOf('\n', j2);
              const r = text.indexOf('\r', j2);
              let m = -1;
              let w = 3; // 0 comma, 1 LF, 2 CR, 3 EOF
              if (c !== -1) { m = c; w = 0; }
              if (l !== -1 && (m === -1 || l < m)) { m = l; w = 1; }
              if (r !== -1 && (m === -1 || r < m)) { m = r; w = 2; }
              if (w === 3) {
                const tail = text.slice(s2, n);
                junkLen += tail.length;
                if (tail.length > 0) junk = junk === null ? tail : junk + tail;
                term = 3;
                i = n;
                break;
              }
              if (w === 2) {
                if (text.charCodeAt(m + 1) === 10) {
                  // CRLF ends the record.
                  const seg = text.slice(s2, m);
                  junkLen += seg.length;
                  if (seg.length > 0) junk = junk === null ? seg : junk + seg;
                  term = 2;
                  i = m + 2;
                  line++;
                  break;
                }
                errors.push({ code: 'stray_cr', line: recLine, row: header ? (done === 0 ? null : done - 1) : done });
                const seg = text.slice(s2, m);
                junkLen += seg.length;
                if (seg.length > 0) junk = junk === null ? seg : junk + seg;
                j2 = m + 1;
                s2 = m + 1;
                continue;
              }
              const seg = text.slice(s2, m);
              junkLen += seg.length;
              if (seg.length > 0) junk = junk === null ? seg : junk + seg;
              if (w === 0) { term = 0; i = m + 1; }
              else { term = 1; i = m + 1; line++; }
              break;
            }
            if (junkLen > 0) {
              value = value + (junk === null ? '' : junk);
              errors.push({ code: 'quote_junk', line: recLine, row: header ? (done === 0 ? null : done - 1) : done });
            }
            }
          }
        } else {
          // ----- unquoted field -----
          unqStart = i;
          unqPrefix = null;
        }
        if (unqStart !== -1) {
          // Unquoted scan, char by char: ends at the next comma, LF, CRLF
          // or EOF; a lone CR is dropped (stray_cr) and the field continues.
          let val = unqPrefix;
          let s = unqStart;
          let k = unqStart;
          for (;;) {
            while (k < n) {
              const ch = text.charCodeAt(k);
              if (ch === 44 || ch === 10 || ch === 13) break;
              k++;
            }
            if (k >= n) {
              const tail = text.slice(s, n);
              value = val === null ? tail : val + tail;
              term = 3;
              i = n;
              break;
            }
            const ch = text.charCodeAt(k);
            if (ch === 13) {
              if (text.charCodeAt(k + 1) === 10) {
                // CRLF ends the record.
                const seg = text.slice(s, k);
                value = val === null ? seg : val + seg;
                term = 2;
                i = k + 2;
                line++;
                break;
              }
              errors.push({ code: 'stray_cr', line: recLine, row: header ? (done === 0 ? null : done - 1) : done });
              val = val === null ? text.slice(s, k) : val + text.slice(s, k);
              k++;
              s = k;
              continue;
            }
            const seg = text.slice(s, k);
            value = val === null ? seg : val + seg;
            if (ch === 44) { term = 0; i = k + 1; }
            else { term = 1; i = k + 1; line++; }
            break;
          }
        }
        f.push(value);
        if (value.length > 0) hadContent = true;
        if (term === 0) {
          hadContent = true; // a comma means this record has fields
          continue;
        }
        recEnded = true;
      }
      // A record left with no characters (only dropped stray CRs) is no record.
      if (hadContent) fields = f;
      else continue;
    }

    // ---- emit the record ----
    if (first) {
      width = fields.length;
      if (header) columns = fields;
      else rows.push(fields);
      first = false;
      done++;
    } else {
      const rIdx = header ? done - 1 : done;
      if (fields.length < width) {
        errors.push({ code: 'short_row', line: recLine, row: rIdx, fields: fields.length });
        while (fields.length < width) fields.push('');
      } else if (fields.length > width) {
        errors.push({ code: 'long_row', line: recLine, row: rIdx, extra: fields.slice(width) });
        fields = fields.slice(0, width);
      }
      rows.push(fields);
      done++;
    }
  }

  if (first && header) columns = []; // no records at all, header on
  return { columns, rows, errors };
}
