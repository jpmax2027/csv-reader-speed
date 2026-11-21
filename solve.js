// A fast CSV reader that answers exactly as csv-reader 1.0.0 does, written from scratch for speed.
//
// run(input) reads input {text, header} once, left to right, and returns {columns, rows, errors} under the same
// broken-row policy: a U+FEFF at the very start is dropped; a record ends at LF or CRLF and a line left with no
// characters is no record; a CR outside quotes that is not followed by LF is dropped (stray_cr); a field that opens
// with a quote runs to the next quote that is not doubled ("" inside it is one quote, and each CRLF or lone CR inside
// it is read as LF), what follows its closing quote up to the next comma or line break is appended as it stands
// (quote_junk when anything was appended), and a quote that never closes is a literal character with the text after
// it read again as unquoted (unterminated_quote); a quote inside an unquoted field is literal; fields stay strings.
// columns is the first record when header is true, else null; every row is padded with "" (short_row) or cut
// (long_row) to the first record's width; each error is {code, line, row} in the order met, line the 1-based line
// its record starts on and row its record's index in rows (null for the header).
//
// Where the reference walks one character at a time and builds each field a character at a time, this reader cuts
// fields out of the text with slice: indexOf finds the next comma, line feed or carriage return, and only quoted
// fields with escapes or carriage returns inside them fall back to a walk that still cuts a slice per segment.
// The next carriage return is tracked incrementally (the read position only moves forward), so the three searches
// together scan the text once instead of once per field. Pure: nothing is kept from one call to the next.

/** How a field ended: at a comma (the record goes on), at a line break, or at the end of the text. */
const COMMA = 0;
const BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The index of the next CR at or after the place the last CR search reached, or -1 when the rest of the text
  // holds none. pos only moves forward, so a stale value is refreshed lazily and all CR searches together are linear.
  let crPos = text.indexOf('\r', pos);

  // The field being read, set by the two readers below: its value, how it ended, and how many characters the
  // reader appended to the value it was handed (the junk test after a closing quote reads this).
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  function refreshCr() {
    if (crPos !== -1 && crPos < pos) crPos = text.indexOf('\r', pos);
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Sets fValue, fEnded and fAdded (the characters appended to `value`).
  function readUnquoted(value) {
    let added = 0;
    let built = null; // value plus the segments cut so far, once a stray CR has split the field
    let seg = pos; // the start of the segment not yet cut
    refreshCr();
    for (;;) {
      const ic = text.indexOf(',', pos);
      const il = text.indexOf('\n', pos);
      let end = ic;
      let kind = COMMA;
      if (il !== -1 && (end === -1 || il < end)) {
        end = il;
        kind = BREAK;
      }
      if (crPos !== -1 && (end === -1 || crPos < end)) {
        end = crPos;
        kind = 2;
      }
      if (end === -1) {
        // No comma, line feed or CR remains: the field runs to the end of the text.
        added += n - seg;
        fValue = built === null ? value + text.slice(seg, n) : built + text.slice(seg, n);
        fEnded = END;
        fAdded = added;
        pos = n;
        return;
      }
      if (kind === 2 && text.charCodeAt(end + 1) !== 10) {
        // A lone CR: dropped, with an error, and the field goes on without it.
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        built = (built === null ? value : built) + text.slice(seg, end);
        added += end - seg;
        pos = end + 1;
        seg = pos;
        crPos = text.indexOf('\r', pos);
        continue;
      }
      // The field ends at end: at a comma, at a line feed, or at a CRLF.
      added += end - seg;
      fValue = built === null ? value + text.slice(seg, end) : built + text.slice(seg, end);
      fAdded = added;
      if (kind === COMMA) {
        pos = end + 1;
        fEnded = COMMA;
      } else if (kind === BREAK) {
        pos = end + 1;
        line += 1;
        fEnded = BREAK;
      } else {
        pos = end + 2;
        line += 1;
        fEnded = BREAK;
      }
      return;
    }
  }

  // What follows a quoted field's closing quote: a comma, a line break, the end of the text, or junk appended as
  // it stands up to the next comma or line break (quote_junk, when the junk added anything).
  function finishQuoted(value) {
    if (pos >= n) {
      fValue = value;
      fEnded = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = value;
      fEnded = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = BREAK;
      return;
    }
    readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    const start = pos + 1;
    refreshCr();
    const close = text.indexOf('"', start);
    if (close !== -1 && text.charCodeAt(close + 1) !== 34 && (crPos === -1 || crPos > close)) {
      // The common quoted field: the first quote met closes it (it is not doubled) and no CR stands inside, so
      // the value is one slice; only the line feeds inside it still have to be counted.
      const value = text.slice(start, close);
      let lf = text.indexOf('\n', start);
      if (lf !== -1 && lf < close) {
        let count = 0;
        while (lf !== -1 && lf < close) {
          count += 1;
          lf = text.indexOf('\n', lf + 1);
        }
        line += count;
      }
      pos = close + 1;
      finishQuoted(value);
      return;
    }
    // The slow walk: an escaped quote or a CR inside, or no closing quote at all. Slices are cut at each escape
    // and each CR; line feeds only move the line count, which is committed only when the field closes.
    let parts = null;
    let seg = start;
    let p = start;
    let l = line;
    for (;;) {
      if (p >= n) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      const c = text.charCodeAt(p);
      if (c === 34) {
        if (text.charCodeAt(p + 1) === 34) {
          if (parts === null) parts = [];
          parts.push(text.slice(seg, p), '"');
          p += 2;
          seg = p;
          continue;
        }
        const value = parts === null ? text.slice(seg, p) : parts.join('') + text.slice(seg, p);
        pos = p + 1;
        line = l;
        finishQuoted(value);
        return;
      }
      if (c === 13) {
        // CRLF and a lone CR inside quotes are each one LF.
        if (parts === null) parts = [];
        parts.push(text.slice(seg, p), '\n');
        l += 1;
        p += text.charCodeAt(p + 1) === 10 ? 2 : 1;
        seg = p;
        continue;
      }
      if (c === 10) l += 1;
      p += 1;
    }
  }

  // The common record whole: it sits on one line, holds no quote anywhere on the line and no CR but the one of
  // its CRLF ending, so it is just its fields cut at the commas. Anything else (a quote, a stray CR, a line feed
  // inside quotes) falls back to the field-by-field readers. A lookahead only: on a fall back nothing is consumed.
  function fastRecord(fields) {
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    let contentEnd = lineEnd;
    if (nl !== -1 && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13) contentEnd = lineEnd - 1;
    const q = text.indexOf('"', pos);
    if (q !== -1 && q < lineEnd) return false;
    refreshCr();
    if (crPos !== -1 && crPos < contentEnd) return false;
    let p = pos;
    for (;;) {
      const c = text.indexOf(',', p);
      if (c === -1 || c >= contentEnd) {
        fields.push(text.slice(p, contentEnd));
        break;
      }
      fields.push(text.slice(p, c));
      p = c + 1;
    }
    pos = nl === -1 ? n : lineEnd + 1;
    if (nl !== -1) line += 1;
    return true;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      if (text.charCodeAt(pos) === 10) {
        pos += 1;
        line += 1;
      } else if (text.charCodeAt(pos) === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    if (!fastRecord(fields)) {
      do {
        quoted = text.charCodeAt(pos) === 34;
        if (quoted) readQuoted();
        else readUnquoted('');
        fields.push(fValue);
      } while (fEnded === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
