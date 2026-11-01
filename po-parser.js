/* PO text parser: turns OCR / PDF text lines into header fields and line items.
   Works on noisy OCR text from scanned purchase orders. */
(function (g) {
  'use strict';

  // Known units of measure, compared uppercase without dots or spaces.
  const UNITS = new Set([
    'LM', 'M', 'RM', 'LIN.M', 'MTR', 'MTRS', 'METER', 'METERS', 'MT', 'KM',
    'PCS', 'PC', 'PCE', 'NOS', 'NO', 'NR', 'EA', 'EACH', 'UNIT', 'UNITS',
    'SET', 'SETS', 'LOT', 'LS', 'LUMPSUM', 'KG', 'KGS', 'TON', 'TONS', 'MTON',
    'M2', 'M3', 'SQM', 'SQMT', 'CUM', 'CBM', 'SQFT', 'FT', 'LTR', 'LTRS', 'L', 'GAL',
    'ROLL', 'ROLLS', 'BOX', 'BOXES', 'PKT', 'PKTS', 'PACK', 'PAIR', 'PAIRS', 'JOB',
    'TRIP', 'TRIPS', 'DAY', 'DAYS', 'HR', 'HRS', 'HOUR', 'MONTH', 'MONTHS', 'WEEK',
    'BAG', 'BAGS', 'DRUM', 'DRUMS', 'LEN', 'LENGTH', 'COIL', 'SHEET', 'SHEETS', 'CAN', 'CTN'
  ]);
  // Common OCR misreads of units.
  const UNIT_FIX = { '1M': 'LM', IM: 'LM', LIVI: 'LM', PGS: 'PCS', PCG: 'PCS', POS: 'PCS', PCB: 'PCS', LIM: 'LM', 'L1M': 'LM', NOB: 'NOS', N0S: 'NOS', M0: 'NO' };
  const UNIT_DISPLAY = { LM: 'L.M', PCS: 'PCS', NOS: 'NOS', EA: 'EA' };

  const TOTAL_LINE = /\b(GRAND\s*TOTAL|TOTAL\s+(NET\s+)?AMOUNT|NET\s+AMOUNT|TOTAL\s+CONTRACT|TOTAL\s+PRICE|TOTAL\s+VALUE|SUB\s*-?\s*TOTAL|VAT\b)/i;

  function unitKey(tok) {
    let t = tok.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.]+$/g, '').replace(/\.+$/, '');
    if (!t || !/[A-Za-z]/.test(t)) return null;
    // stray lowercase junk glued in front of an uppercase unit: "oL.M" -> "L.M"
    t = t.replace(/^[a-z]+(?=[A-Z])/, '');
    let k = t.toUpperCase().replace(/[.\s]/g, '');
    if (k.length > 7) return null;
    if (UNIT_FIX[k]) k = UNIT_FIX[k];
    if (UNITS.has(k)) return k;
    // doubled or junk first letter: "LLM", "CLM" -> "LM"
    if (k.length >= 3 && UNITS.has(k.slice(1)) && k.slice(1).length >= 2) return k.slice(1);
    return null;
  }
  function unitDisplay(k) { return UNIT_DISPLAY[k] || k; }

  // Parse a numeric token; returns {v, dec} or null. dec = number of decimals written.
  function num(tok) {
    let t = tok.replace(/^[^0-9]+/, '').replace(/[^0-9]+$/, '');
    if (!t || !/^\d[\d,.]*$/.test(t)) return null;
    // "1,642,00" -> decimal comma at the end
    if (!t.includes('.') && /,\d{2}$/.test(t)) t = t.replace(/,(\d{2})$/, '.$1');
    if ((t.match(/\./g) || []).length > 1) return null;
    const parts = t.split('.');
    const intPart = parts[0].replace(/,/g, '');
    if (!/^\d+$/.test(intPart)) return null;
    const v = parseFloat(intPart + (parts[1] !== undefined ? '.' + parts[1] : ''));
    if (!isFinite(v)) return null;
    return { v, dec: parts[1] !== undefined ? parts[1].length : 0, clean: t };
  }

  function normalizeLine(raw) {
    let s = ' ' + raw + ' ';
    s = s.replace(/[|_—–~«»=©®“”"]+/g, ' ');
    // re-join a thousands group split by OCR: "3,971, 100.00" -> "3,971,100.00"
    s = s.replace(/(^|[^\d.,])(\d{1,3}(?:,\d{3})*),\s+(\d{3}(?:\.\d{1,2})?)(?![\d,])/g, '$1$2,$3');
    // split a unit glued to the following number: "PCS'1,642.00" -> "PCS 1,642.00"
    s = s.replace(/\b(PCS|PC|NOS|EA|SET|LOT|LS|L\.?M|KG|TON|MTR)\.?['’`,:]*(?=\d)/gi, '$1. ');
    return s.replace(/\s+/g, ' ').trim();
  }

  const isJunk = (t) => !/[A-Za-z0-9]/.test(t);
  const OCR_DIGIT = { O: '0', o: '0', D: '0', Q: '0', l: '1', I: '1', i: '1', '|': '1', A: '4', S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', g: '9', T: '7' };

  function guessItemNo(tok) {
    const t = tok.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (/^\d{1,4}$/.test(t)) return parseInt(t, 10);
    if (t.length >= 1 && t.length <= 3) {
      const m = t.split('').map((c) => (/\d/.test(c) ? c : OCR_DIGIT[c] || 'x')).join('');
      if (/^\d+$/.test(m)) return parseInt(m, 10);
    }
    return null;
  }

  function cleanDesc(tokens) {
    const out = tokens.slice();
    const junkTail = (t) => {
      if (isJunk(t)) return true;
      const core = t.replace(/[^A-Za-z0-9]/g, '');
      // short lowercase scraps OCR picks up from table borders: "ee", "oo", "a"
      return /^[a-z]{1,3}$/.test(core) && !/^(mm|m|x|of|in|to|kg|cm)$/.test(core);
    };
    while (out.length && junkTail(out[out.length - 1])) out.pop();
    while (out.length && isJunk(out[0])) out.shift();
    return out.join(' ')
      // diameter sign misread after "mm": "400mm@", "300mm¢@", "1600mmY" -> "400mmØ"
      .replace(/(\d\s?mm)\s?[@¢øgoOY0Q€]{1,2}(?=[\s,xX]|$)/g, '$1Ø')
      .replace(/\s+([,.;:])/g, '$1')
      .replace(/^[^A-Za-z0-9(]+/, '')
      .replace(/[\s\-,;:.]+$/, (m) => (m.trim() === '.' ? '.' : ''))
      .trim();
  }

  // qty x rate must equal the total to the cent (allowing rates quoted to 3 decimals)
  const closeTotal = (q, r, t) => Math.abs(q * r - t) <= Math.max(0.011, Math.abs(q) * 0.0051);
  const digits = (x) => String(x).replace(/[^0-9]/g, '').replace(/^0+/, '');
  function editDistance(a, b) {
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  // A correction is trusted only if it looks like a misread of what was printed.
  const resembles = (readTok, value) => editDistance(digits(readTok), digits(value)) <= 2;
  const isWhole = (x) => Math.abs(x - Math.round(x)) < 0.005;
  const twoDp = (x) => Math.abs(x * 100 - Math.round(x * 100)) < 0.001;

  /** Try to read one table row. Returns an item or null. */
  function parseItemLine(raw, ctx) {
    const s = normalizeLine(raw);
    if (!s || TOTAL_LINE.test(s)) return null;
    const toks = s.split(' ').filter((t) => !isJunk(t));
    if (toks.length < 4) return null;
    const info = toks.map((t) => ({ t, n: num(t), u: unitKey(t) }));

    // Find, from the right: [qty] unit rate [total]
    let i = info.length - 1;
    const skipJunkWord = (j) => {
      // allow one short non-numeric, non-unit junk word between columns
      if (j >= 0 && !info[j].n && !info[j].u && info[j].t.replace(/[^A-Za-z0-9]/g, '').length <= 2) return j - 1;
      return j;
    };
    i = skipJunkWord(i);
    if (i < 0 || !info[i].n) return null;
    const a = info[i].n; // last number
    const j = skipJunkWord(i - 1);
    let rate, total = null, unitIdx;
    if (j >= 0 && info[j].n && !info[j].u) {
      // two trailing numbers: rate, total
      rate = info[j].n; total = a;
      unitIdx = skipJunkWord(j - 1);
    } else {
      rate = a; unitIdx = j;
    }
    let unit = null, qty = null, descEnd, qtyWeak = false;
    if (unitIdx >= 0 && info[unitIdx].u) {
      unit = info[unitIdx].u;
      let q = unitIdx - 1;
      if (q >= 0 && info[q].n) { qty = info[q].n; descEnd = q; }
      else if (q >= 1 && info[q - 1].n && info[q].t.replace(/[^A-Za-z0-9]/g, '').length <= 2) { qty = info[q - 1].n; descEnd = q - 1; qtyWeak = true; }
      else if (q >= 0 && info[q].t.length <= 3 && !/^[A-Z]/.test(info[q].t)) { qty = null; descEnd = q; } // unreadable qty
      else { descEnd = q + 1; }
    } else if (unitIdx >= 1 && info[unitIdx].n && info[unitIdx - 1].u) {
      // layout: unit qty rate total
      unit = info[unitIdx - 1].u; qty = info[unitIdx].n; descEnd = unitIdx - 1;
    } else {
      return null; // no unit column -> not an item row
    }

    // Item number at the start
    let start = 0, itemNo = guessItemNo(info[0].t);
    const expected = ctx.lastItem != null ? ctx.lastItem + 1 : null;
    if (itemNo != null && /^\d/.test(info[0].t.replace(/^[^A-Za-z0-9]+/, ''))) {
      start = 1;
      // "46" read for 16: same length, one digit different from the expected next item
      if (expected != null && (itemNo < expected || itemNo > expected + 2) && String(itemNo).length === String(expected).length && editDistance(String(itemNo), String(expected)) === 1) itemNo = expected;
    }
    else if (itemNo != null && expected != null && itemNo === expected) start = 1;
    else if (ctx.inTable) { itemNo = expected; if (info[0].t.replace(/[^A-Za-z0-9]/g, '').length <= 2) start = 1; }
    else return null; // first row must start with an item number
    if (itemNo == null || itemNo > 9999) return null;
    const t0 = total ? total.v : null;
    if (descEnd - start < 1) return null;

    // A number picked up past a junk word ("SN 10,000 do PCS") that doesn't fit the math belongs to the description.
    if (qtyWeak && t0 != null && !closeTotal(qty.v, rate.v, t0)) { descEnd += 1; qty = null; }
    const desc = cleanDesc(toks.slice(start, descEnd));
    if (!/[A-Za-z]{2,}/.test(desc)) return null;

    // Reconcile qty x rate = total, correcting OCR misreads where the math allows it.
    let q = qty ? qty.v : null, r = rate.v, t = total ? total.v : null, status = 'unchecked', note = '';
    if (t != null) {
      const rateSuspect = rate.dec === 0 && total.dec > 0; // "20000)" for "200.00"
      const rateFix = q ? Math.round((t / q) * 100) / 100 : null;
      const rateFixOk = q && twoDp(t / q) && closeTotal(q, rateFix, t) && resembles(rate.clean, rateFix.toFixed(Math.max(rate.dec, 2)));
      const qtyFix = r > 0 ? Math.round(t / r) : null;
      const qtyFixOk = qtyFix >= 1 && closeTotal(qtyFix, r, t);
      if (q != null && closeTotal(q, r, t)) status = 'ok';
      else if (rateSuspect && rateFixOk) {
        note = `Rate read as ${rate.clean}; corrected from total ÷ qty`;
        r = Math.round((t / q) * 100) / 100; status = 'fixed';
      } else if (qtyFixOk) {
        const fixed = qtyFix;
        note = q != null ? `Qty read as ${qty.clean}; corrected from total ÷ rate` : 'Qty unreadable; computed from total ÷ rate';
        q = fixed; status = 'fixed';
      } else if (rateFixOk) {
        note = `Rate read as ${rate.clean}; corrected from total ÷ qty`;
        r = rateFix; status = 'fixed';
      } else {
        status = 'check'; note = 'Qty × rate does not match the total. Check against the PDF.';
      }
    } else if (q == null) { status = 'check'; note = 'Qty unreadable'; }
    if (status === 'check' && !note) note = 'Qty × rate does not match the total. Check against the PDF.';

    return { item: itemNo, description: desc, qty: q, unit: unitDisplay(unit), rate: r, total: t, status, note };
  }

  function cleanValue(v) {
    return v.replace(/[|_«»©®“”"]+/g, ' ').replace(/\[(?=[a-z])/g, 'I').replace(/\s+/g, ' ').replace(/^[\s:;.>»\-]+|[\s:;,\-]+$/g, '').trim();
  }

  function findPO(lines) {
    const counts = new Map();
    const re = /\b(?:P\s*\.?\s*O\s*\.?|Purchase\s+Order|Order|LPO|PO)\s*(?:Number|Num|No\s*\.?|#|Ref(?:erence)?)\s*[:.»>|\-\s]*\s*([A-Z0-9][A-Z0-9\/\-_.]*(?:\s?[\/\-]\s?[A-Z0-9][A-Z0-9\-_.]*)*)/i;
    for (const line of lines) {
      const m = line.replace(/[|]/g, ' ').match(re);
      if (!m) continue;
      const c = m[1].replace(/\s+/g, '').replace(/[.\-_]+$/, '');
      if (c.length < 4 || !/\d/.test(c)) continue;
      const score = (counts.get(c) || 0) + 1 + (/[\/\-]/.test(c) ? 0.5 : 0);
      counts.set(c, score);
    }
    let best = '', bs = 0;
    for (const [c, s] of counts) if (s > bs) { best = c; bs = s; }
    return best;
  }

  function findVendor(lines) {
    const re = /\b(?:Vendor|Supplier|Seller)(?:['’]s)?\s*(?:Name)?\s*[:.»>|\-]+\s*(.{3,})/i;
    for (const line of lines) {
      const m = line.match(re);
      if (m) {
        const v = cleanValue(m[1]);
        if (/[A-Za-z]{3,}/.test(v)) return v;
      }
    }
    for (let k = 0; k < lines.length; k++) {
      const m = lines[k].match(/\bM\/s\.?\s+(.{3,})/i);
      if (m) {
        let v = cleanValue(m[1]).split(/\s{2,}| (?:See|Shipping|Payment|Date) /)[0];
        const next = (lines[k + 1] || '').match(/^\s*(\([^)]{4,}\))/);
        if (next) v += ' ' + next[1];
        return v;
      }
    }
    return '';
  }

  /** Incremental document parser: feed page texts one at a time. */
  function createDocParser() {
    const st = { lines: [], items: [], ctx: { lastItem: null, inTable: false }, sawTotal: false };
    return {
      addPage(text) {
        const pageLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        let pageItems = 0;
        for (const line of pageLines) {
          st.lines.push(line);
          const it = parseItemLine(line, st.ctx);
          if (it) {
            st.items.push(it); pageItems++;
            st.ctx.lastItem = it.item; st.ctx.inTable = true;
          } else if (st.items.length && TOTAL_LINE.test(line)) {
            st.sawTotal = true; st.ctx.inTable = false;
          }
        }
        return pageItems;
      },
      result() {
        return { po: findPO(st.lines), vendor: findVendor(st.lines), items: st.items, sawTotal: st.sawTotal };
      }
    };
  }

  g.POParser = { createDocParser, parseItemLine, findPO, findVendor, normalizeLine };
})(typeof window !== 'undefined' ? window : globalThis);
