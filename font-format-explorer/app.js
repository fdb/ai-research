// =====================================================================
//  Font Format Explorer — parses a TrueType-flavored OpenType file and
//  renders each step into the page. Reading top-to-bottom, this file is:
//    1. small helpers
//    2. FontParser class (read tables, decode fields)
//    3. hex-view component
//    4. one render-* function per page section
//    5. boot + drag/drop wiring
//
//  CFF outlines and variable-font tables are intentionally not rendered.
// =====================================================================

// ----- small helpers --------------------------------------------------

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in props) {
    if (k === 'class') e.className = props[k];
    else if (k === 'style' && typeof props[k] === 'object') Object.assign(e.style, props[k]);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), props[k]);
    else if (k === 'html') e.innerHTML = props[k];
    else e.setAttribute(k, props[k]);
  }
  for (const kid of kids) {
    if (kid == null) continue;
    e.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return e;
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// =====================================================================
//  FontParser — reads what we need from a TTF / OTF buffer.
// =====================================================================

class FontParser {
  constructor(buffer) {
    this.buffer = buffer;
    this.bytes = new Uint8Array(buffer);
    this.view = new DataView(buffer);
    this.tables = Object.create(null);

    this._parseDirectory();
  }

  // primitive readers
  u8 (o) { return this.view.getUint8(o); }
  u16(o) { return this.view.getUint16(o); }
  u32(o) { return this.view.getUint32(o); }
  i8 (o) { return this.view.getInt8(o); }
  i16(o) { return this.view.getInt16(o); }
  i32(o) { return this.view.getInt32(o); }
  fixed(o) { return this.i16(o) + this.u16(o + 2) / 65536; }   // 16.16 fixed
  ascii(o, n) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8(o + i));
    return s;
  }
  longDateTime(o) {
    // 64-bit signed seconds since 1904-01-01 00:00:00 UTC
    const hi = this.i32(o), lo = this.u32(o + 4);
    const seconds = hi * 0x100000000 + lo;
    // JS epoch is 1970-01-01; difference is 2082844800 seconds
    return new Date((seconds - 2082844800) * 1000);
  }

  _parseDirectory() {
    this.sfntVersion = this.u32(0);
    this.numTables   = this.u16(4);
    this.searchRange = this.u16(6);
    this.entrySelector = this.u16(8);
    this.rangeShift  = this.u16(10);

    this.sfntTag = this.ascii(0, 4);
    if (this.sfntVersion === 0x4F54544F /* 'OTTO' */) this.flavour = 'cff';
    else if (this.sfntVersion === 0x00010000) this.flavour = 'truetype';
    else if (this.sfntTag === 'true' || this.sfntTag === 'typ1') this.flavour = 'truetype';
    else this.flavour = 'unknown';

    this.tableRecords = [];
    for (let i = 0; i < this.numTables; i++) {
      const r = 12 + i * 16;
      const tag = this.ascii(r, 4);
      const rec = {
        tag,
        recordOffset: r,
        checksum: this.u32(r + 4),
        offset:   this.u32(r + 8),
        length:   this.u32(r + 12),
      };
      this.tableRecords.push(rec);
      this.tables[tag] = rec;
    }
    // Stable order: same as on-disk
    this.tableRecords.sort((a, b) => a.offset - b.offset);
  }

  hasTable(tag) { return !!this.tables[tag]; }

  // ----- maxp ---------------------------------------------------------
  parseMaxp() {
    const t = this.tables['maxp']; if (!t) return null;
    const o = t.offset;
    return {
      _offset: o,
      version: this.u32(o),
      numGlyphs: this.u16(o + 4),
    };
  }

  // ----- head ---------------------------------------------------------
  parseHead() {
    const t = this.tables['head']; if (!t) return null;
    const o = t.offset;
    return {
      _offset: o,
      majorVersion: this.u16(o),
      minorVersion: this.u16(o + 2),
      fontRevision: this.fixed(o + 4),
      checksumAdjustment: this.u32(o + 8),
      magicNumber: this.u32(o + 12),
      flags: this.u16(o + 16),
      unitsPerEm: this.u16(o + 18),
      created:  this.longDateTime(o + 20),
      modified: this.longDateTime(o + 28),
      xMin: this.i16(o + 36),
      yMin: this.i16(o + 38),
      xMax: this.i16(o + 40),
      yMax: this.i16(o + 42),
      macStyle: this.u16(o + 44),
      lowestRecPPEM: this.u16(o + 46),
      fontDirectionHint: this.i16(o + 48),
      indexToLocFormat: this.i16(o + 50),
      glyphDataFormat: this.i16(o + 52),
    };
  }

  // ----- hhea ---------------------------------------------------------
  parseHhea() {
    const t = this.tables['hhea']; if (!t) return null;
    const o = t.offset;
    return {
      _offset: o,
      majorVersion: this.u16(o),
      minorVersion: this.u16(o + 2),
      ascender: this.i16(o + 4),
      descender: this.i16(o + 6),
      lineGap: this.i16(o + 8),
      advanceWidthMax: this.u16(o + 10),
      minLeftSideBearing: this.i16(o + 12),
      minRightSideBearing: this.i16(o + 14),
      xMaxExtent: this.i16(o + 16),
      caretSlopeRise: this.i16(o + 18),
      caretSlopeRun: this.i16(o + 20),
      caretOffset: this.i16(o + 22),
      // 4 reserved int16 at o+24..o+31
      metricDataFormat: this.i16(o + 32),
      numberOfHMetrics: this.u16(o + 34),
    };
  }

  // ----- hmtx ---------------------------------------------------------
  parseHmtx(numberOfHMetrics, numGlyphs) {
    const t = this.tables['hmtx']; if (!t) return null;
    const o = t.offset;
    const metrics = [];
    for (let i = 0; i < numberOfHMetrics; i++) {
      metrics.push({
        advanceWidth: this.u16(o + i * 4),
        lsb: this.i16(o + i * 4 + 2),
      });
    }
    const lastAdvance = numberOfHMetrics > 0 ? metrics[numberOfHMetrics - 1].advanceWidth : 0;
    const tailOffset = o + numberOfHMetrics * 4;
    for (let i = numberOfHMetrics; i < numGlyphs; i++) {
      metrics.push({
        advanceWidth: lastAdvance,
        lsb: this.i16(tailOffset + (i - numberOfHMetrics) * 2),
      });
    }
    return metrics;
  }

  // ----- cmap ---------------------------------------------------------
  parseCmap() {
    const t = this.tables['cmap']; if (!t) return null;
    const o = t.offset;
    const version = this.u16(o);
    const numTables = this.u16(o + 2);
    const encodings = [];
    for (let i = 0; i < numTables; i++) {
      const r = o + 4 + i * 8;
      const subOff = this.u32(r + 4);
      encodings.push({
        platformID: this.u16(r),
        encodingID: this.u16(r + 2),
        subtableOffset: subOff,
        absoluteSubtableOffset: o + subOff,
        format: this.u16(o + subOff),
      });
    }
    return { _offset: o, version, numTables, encodings };
  }

  parseCmapFormat4(absSubtableOffset) {
    const o = absSubtableOffset;
    const format = this.u16(o);
    if (format !== 4) return null;
    const length = this.u16(o + 2);
    const language = this.u16(o + 4);
    const segCountX2 = this.u16(o + 6);
    const segCount = segCountX2 / 2;
    const searchRange = this.u16(o + 8);
    const entrySelector = this.u16(o + 10);
    const rangeShift = this.u16(o + 12);

    const endCodes = [];
    for (let i = 0; i < segCount; i++) endCodes.push(this.u16(o + 14 + i * 2));
    const startCodesOff = o + 14 + segCount * 2 + 2; // +2 for reservedPad
    const startCodes = [];
    for (let i = 0; i < segCount; i++) startCodes.push(this.u16(startCodesOff + i * 2));
    const idDeltaOff = startCodesOff + segCount * 2;
    const idDeltas = [];
    for (let i = 0; i < segCount; i++) idDeltas.push(this.i16(idDeltaOff + i * 2));
    const idRangeOffsetOff = idDeltaOff + segCount * 2;
    const idRangeOffsets = [];
    for (let i = 0; i < segCount; i++) idRangeOffsets.push(this.u16(idRangeOffsetOff + i * 2));
    const glyphIdArrayOff = idRangeOffsetOff + segCount * 2;

    const view = this;
    const lookup = (codepoint) => {
      // segment whose endCode >= codepoint, in increasing order
      for (let i = 0; i < segCount; i++) {
        if (endCodes[i] < codepoint) continue;
        if (startCodes[i] > codepoint) return { gid: 0, segment: -1, method: 'no-segment' };
        let gid;
        let method;
        if (idRangeOffsets[i] === 0) {
          gid = (codepoint + idDeltas[i]) & 0xFFFF;
          method = 'delta';
        } else {
          // glyphId = *(idRangeOffset[i]/2 + (c-startCode[i]) + &idRangeOffset[i])
          const addr = idRangeOffsetOff + i * 2 + idRangeOffsets[i] + (codepoint - startCodes[i]) * 2;
          const raw = view.u16(addr);
          gid = raw === 0 ? 0 : (raw + idDeltas[i]) & 0xFFFF;
          method = 'idRangeOffset';
        }
        return { gid, segment: i, method };
      }
      return { gid: 0, segment: -1, method: 'past-end' };
    };

    return {
      _offset: o,
      _length: length,
      format, length, language, segCount,
      searchRange, entrySelector, rangeShift,
      endCodes, startCodes, idDeltas, idRangeOffsets,
      idRangeOffsetOff, glyphIdArrayOff,
      lookup,
    };
  }

  // ----- loca ---------------------------------------------------------
  parseLoca(numGlyphs, indexToLocFormat) {
    const t = this.tables['loca']; if (!t) return null;
    const o = t.offset;
    const offsets = new Uint32Array(numGlyphs + 1);
    if (indexToLocFormat === 0) {
      // short — uint16 offsets divided by 2
      for (let i = 0; i <= numGlyphs; i++) offsets[i] = this.u16(o + i * 2) * 2;
    } else {
      for (let i = 0; i <= numGlyphs; i++) offsets[i] = this.u32(o + i * 4);
    }
    return offsets;
  }

  // ----- glyf — one glyph at a time ----------------------------------
  parseGlyph(glyphIndex, locaOffsets) {
    const glyf = this.tables['glyf']; if (!glyf) return null;
    const start = glyf.offset + locaOffsets[glyphIndex];
    const end   = glyf.offset + locaOffsets[glyphIndex + 1];
    if (start === end) {
      return { glyphIndex, empty: true, kind: 'empty', xMin: 0, yMin: 0, xMax: 0, yMax: 0,
               numberOfContours: 0, contours: [], glyphStart: start, glyphEnd: end };
    }

    const numberOfContours = this.i16(start);
    const xMin = this.i16(start + 2);
    const yMin = this.i16(start + 4);
    const xMax = this.i16(start + 6);
    const yMax = this.i16(start + 8);

    if (numberOfContours < 0) {
      // composite — we don't fully resolve them, but flag for the UI
      return { glyphIndex, kind: 'composite', numberOfContours, xMin, yMin, xMax, yMax,
               glyphStart: start, glyphEnd: end };
    }

    let p = start + 10;
    const endPtsOfContours = [];
    for (let i = 0; i < numberOfContours; i++) {
      endPtsOfContours.push(this.u16(p));
      p += 2;
    }
    const numPoints = endPtsOfContours.length > 0
      ? endPtsOfContours[endPtsOfContours.length - 1] + 1
      : 0;

    const instructionLength = this.u16(p); p += 2;
    const instructionsStart = p;
    p += instructionLength;
    const flagsStart = p;

    const flags = new Array(numPoints);
    let f = 0;
    for (let i = 0; i < numPoints; i++) {
      const flag = this.u8(p++);
      flags[i] = flag;
      if (flag & 0x08) {
        const repeat = this.u8(p++);
        for (let j = 0; j < repeat; j++) flags[++i] = flag;
      }
    }
    const xCoordsStart = p;

    // x deltas
    const xs = new Array(numPoints);
    let x = 0;
    for (let i = 0; i < numPoints; i++) {
      const fl = flags[i];
      if (fl & 0x02) {                      // x is byte
        const v = this.u8(p++);
        x += (fl & 0x10) ? v : -v;
      } else if (!(fl & 0x10)) {            // x is word delta
        x += this.i16(p); p += 2;
      } // else: x is same as previous
      xs[i] = x;
    }
    const yCoordsStart = p;

    // y deltas
    const ys = new Array(numPoints);
    let y = 0;
    for (let i = 0; i < numPoints; i++) {
      const fl = flags[i];
      if (fl & 0x04) {
        const v = this.u8(p++);
        y += (fl & 0x20) ? v : -v;
      } else if (!(fl & 0x20)) {
        y += this.i16(p); p += 2;
      }
      ys[i] = y;
    }

    const points = new Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      points[i] = {
        x: xs[i], y: ys[i],
        onCurve: !!(flags[i] & 0x01),
        index: i,
      };
    }

    const contours = [];
    let s = 0;
    for (const e of endPtsOfContours) {
      contours.push(points.slice(s, e + 1));
      s = e + 1;
    }

    return {
      glyphIndex,
      kind: 'simple',
      numberOfContours, xMin, yMin, xMax, yMax,
      endPtsOfContours, instructionLength, instructionsStart,
      flagsStart, xCoordsStart, yCoordsStart,
      flags, points, contours,
      glyphStart: start, glyphEnd: end,
    };
  }
}

// =====================================================================
//  Hex view
// =====================================================================

// `highlights` is [{start, length, className, label}].
// Bytes covered by a highlight get className applied. The first byte of
// each highlight also gets a `lead-*` class for a coloured underline so
// you can see field boundaries.
function renderHexView(target, parser, startOffset, endOffset, highlights = []) {
  const len = endOffset - startOffset;
  if (len <= 0) {
    target.innerHTML = '<div class="hex-wrap"><div class="hex-view"><span class="muted">(empty)</span></div></div>';
    return;
  }

  // Map each byte's class
  const byteClass = new Array(len).fill('');
  const isLead = new Array(len).fill(false);
  for (const hl of highlights) {
    const localStart = hl.start - startOffset;
    if (localStart < 0 || localStart >= len) continue;
    isLead[localStart] = hl.className.replace(/^hl-/, 'lead-');
    for (let i = 0; i < hl.length; i++) {
      const idx = localStart + i;
      if (idx < 0 || idx >= len) break;
      byteClass[idx] = hl.className;
    }
  }

  const bytes = parser.bytes;
  const rowsCount = Math.ceil(len / 16);
  const totalLen = parser.bytes.length;

  // Header bar with current range / size
  const header = `<div class="hex-head">
    <span>offset <code>0x${startOffset.toString(16).toUpperCase().padStart(6, '0')}</code></span>
    <span>&middot; ${len} bytes</span>
    <span class="right pill">${rowsCount} row${rowsCount===1?'':'s'} of 16</span>
  </div>`;

  // Pre-build any legend chips from highlights
  const legendItems = [];
  const seen = new Set();
  for (const hl of highlights) {
    if (!hl.label || seen.has(hl.className + ':' + hl.label)) continue;
    seen.add(hl.className + ':' + hl.label);
    legendItems.push(`<span class="chip" data-cls="${hl.className}"><span class="swatch ${hl.className}"></span>${escapeHtml(hl.label)}</span>`);
  }
  const legend = legendItems.length
    ? `<div class="legend">${legendItems.join('')}</div>`
    : '';

  let html = '<div class="hex-view">';
  for (let row = 0; row < rowsCount; row++) {
    const rowStart = row * 16;
    let hexCells = '';
    let asciiCells = '';
    for (let col = 0; col < 16; col++) {
      const idx = rowStart + col;
      if (col === 8) hexCells += '<span class="gap-mid"></span>';
      if (idx >= len) {
        hexCells += '<span class="hb empty">..</span>';
        asciiCells += '<span class="ab empty">.</span>';
        continue;
      }
      const b = bytes[startOffset + idx];
      const cls = byteClass[idx] || '';
      const lead = isLead[idx] ? ' ' + isLead[idx] : '';
      const hex = b.toString(16).padStart(2, '0').toUpperCase();
      const ch  = (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '·';
      hexCells   += `<span class="hb ${cls}${lead}" data-off="${startOffset + idx}" data-val="${b}" title="0x${(startOffset+idx).toString(16).toUpperCase()} = 0x${hex} (${b})">${hex}</span>`;
      asciiCells += `<span class="ab ${cls}">${escapeHtml(ch)}</span>`;
    }
    const offHex = (startOffset + rowStart).toString(16).toUpperCase().padStart(6, '0');
    html += `<div class="hex-row"><span class="off">${offHex}</span><span class="bytes">${hexCells}</span><span class="ascii">${asciiCells}</span></div>`;
  }
  html += '</div>';

  target.innerHTML = `<div class="hex-wrap">${header}${html}</div>${legend}`;
}

// helper: 4-byte ascii view of a uint32 (for sfnt version etc.)
function tagDecode(u32) {
  return String.fromCharCode((u32 >>> 24) & 0xff, (u32 >>> 16) & 0xff, (u32 >>> 8) & 0xff, u32 & 0xff);
}

// =====================================================================
//  Section renderers
// =====================================================================

function renderHeader(parser, head, hhea, maxp) {
  const target = $('#hex-header');
  // Show the offset table (12 bytes) plus first table record (16 bytes)
  // = 28 bytes, padded to 64 for context
  const showLen = Math.min(64, parser.bytes.length);
  const highlights = [
    { start: 0,  length: 4, className: 'hl-red',    label: 'sfntVersion' },
    { start: 4,  length: 2, className: 'hl-blue',   label: 'numTables' },
    { start: 6,  length: 2, className: 'hl-green',  label: 'searchRange' },
    { start: 8,  length: 2, className: 'hl-purple', label: 'entrySelector' },
    { start: 10, length: 2, className: 'hl-amber',  label: 'rangeShift' },
  ];
  // Mark the first record (12..28) lightly so people see the seam
  highlights.push({ start: 12, length: 16, className: 'hl-teal', label: 'first table record' });
  renderHexView(target, parser, 0, showLen, highlights);

  const tableEl = $('#offset-table-fields');
  const versionAscii = tagDecode(parser.sfntVersion);
  const versionPretty = parser.sfntVersion === 0x00010000 ? '0x00010000  →  TrueType outlines'
                      : parser.sfntVersion === 0x4F54544F ? "'OTTO'  →  CFF / CFF2 outlines"
                      : `0x${parser.sfntVersion.toString(16).toUpperCase().padStart(8,'0')}  →  '${versionAscii}'`;
  tableEl.innerHTML = `
    <thead><tr><th>field</th><th>type</th><th>value</th><th>meaning</th></tr></thead>
    <tbody>
      <tr><td class="t-name"><span class="swatch-inline hl-red"></span>sfntVersion</td><td class="t-type">uint32</td><td class="t-val">${versionPretty}</td><td class="t-note">Tells the renderer what kind of outlines lie inside.</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-blue"></span>numTables</td><td class="t-type">uint16</td><td class="t-val">${parser.numTables}</td><td class="t-note">How many table-directory records follow.</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-green"></span>searchRange</td><td class="t-type">uint16</td><td class="t-val">${parser.searchRange}</td><td class="t-note">Pre-computed binary-search hint, redundant on modern CPUs.</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-purple"></span>entrySelector</td><td class="t-type">uint16</td><td class="t-val">${parser.entrySelector}</td><td class="t-note">log<sub>2</sub> of the largest power of two ≤ numTables.</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-amber"></span>rangeShift</td><td class="t-type">uint16</td><td class="t-val">${parser.rangeShift}</td><td class="t-note">numTables × 16 − searchRange. Also for that vintage binary search.</td></tr>
    </tbody>`;
}

function renderTableDirectory(parser) {
  $('#num-tables-inline').textContent = String(parser.numTables);
  const known = new Set(['cmap','head','hhea','hmtx','maxp','loca','glyf']);
  const list = $('#dir-list');
  list.innerHTML = '';
  for (const r of parser.tableRecords) {
    const li = document.createElement('li');
    if (known.has(r.tag)) li.classList.add('known');
    li.innerHTML = `<span class="tag-name">${escapeHtml(r.tag)}</span><span class="size">${fmtBytes(r.length)}</span>`;
    li.title = `offset 0x${r.offset.toString(16).toUpperCase()}, length ${r.length}`;
    list.appendChild(li);
  }

  // Show the first record's bytes
  const first = parser.tableRecords[0];
  const recOff = first.recordOffset;
  const target = $('#hex-one-record');
  renderHexView(target, parser, recOff, recOff + 16, [
    { start: recOff,      length: 4, className: 'hl-red',    label: 'tag (4 ASCII)' },
    { start: recOff + 4,  length: 4, className: 'hl-amber',  label: 'checksum' },
    { start: recOff + 8,  length: 4, className: 'hl-blue',   label: 'offset' },
    { start: recOff + 12, length: 4, className: 'hl-green',  label: 'length' },
  ]);
  $('#record-fields').innerHTML = `
    <thead><tr><th>field</th><th>type</th><th>value</th><th>meaning</th></tr></thead>
    <tbody>
      <tr><td class="t-name"><span class="swatch-inline hl-red"></span>tag</td><td class="t-type">char[4]</td><td class="t-val">'${escapeHtml(first.tag)}'</td><td class="t-note">A 4-character ASCII identifier — fixed by the spec for known tables.</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-amber"></span>checksum</td><td class="t-type">uint32</td><td class="t-val">0x${first.checksum.toString(16).toUpperCase().padStart(8,'0')}</td><td class="t-note">Sum of the table's u32 words. Modern stacks ignore it.</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-blue"></span>offset</td><td class="t-type">uint32</td><td class="t-val">${first.offset}</td><td class="t-note">Absolute byte offset of the table from the start of the file.</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-green"></span>length</td><td class="t-type">uint32</td><td class="t-val">${first.length}</td><td class="t-note">Length of the table, in bytes.</td></tr>
    </tbody>`;
}

function renderMaxp(parser, maxp) {
  const t = parser.tables['maxp'];
  if (!t || !maxp) {
    $('#hex-maxp').innerHTML = '<div class="error-box">No <span class="tag">maxp</span> table.</div>';
    $('#maxp-fields').innerHTML = '';
    return;
  }
  const showEnd = Math.min(t.offset + 6, t.offset + t.length);
  renderHexView($('#hex-maxp'), parser, t.offset, showEnd, [
    { start: t.offset,     length: 4, className: 'hl-blue',   label: 'version' },
    { start: t.offset + 4, length: 2, className: 'hl-red',    label: 'numGlyphs' },
  ]);
  $('#maxp-fields').innerHTML = `
    <thead><tr><th>field</th><th>type</th><th>value</th><th>meaning</th></tr></thead>
    <tbody>
      <tr><td class="t-name"><span class="swatch-inline hl-blue"></span>version</td><td class="t-type">Fixed</td><td class="t-val">0x${maxp.version.toString(16).toUpperCase().padStart(8,'0')}</td><td class="t-note">${maxp.version === 0x00010000 ? 'Long form (TrueType): more limit fields follow.' : 'Short form (CFF): only numGlyphs.'}</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-red"></span>numGlyphs</td><td class="t-type">uint16</td><td class="t-val">${maxp.numGlyphs}</td><td class="t-note">The font defines this many glyphs (indexed 0 &hellip; ${maxp.numGlyphs - 1}).</td></tr>
    </tbody>`;
}

function renderHead(parser, head) {
  const t = parser.tables['head'];
  if (!t || !head) return;
  // Highlight the most interesting fields; the rest stay unmarked.
  const o = t.offset;
  const highlights = [
    { start: o + 12, length: 4, className: 'hl-red',    label: 'magicNumber' },
    { start: o + 18, length: 2, className: 'hl-blue',   label: 'unitsPerEm' },
    { start: o + 36, length: 8, className: 'hl-green',  label: 'font bbox' },
    { start: o + 50, length: 2, className: 'hl-purple', label: 'indexToLocFormat' },
  ];
  renderHexView($('#hex-head'), parser, o, o + t.length, highlights);

  const magicOK = head.magicNumber === 0x5F0F3CF5 ? '✓ matches the spec' : '✗ does not match';
  const indexFmt = head.indexToLocFormat === 0 ? 'short — uint16 offsets ÷ 2' : 'long — uint32 offsets';
  $('#head-fields').innerHTML = `
    <thead><tr><th>field</th><th>type</th><th>value</th><th>meaning</th></tr></thead>
    <tbody>
      <tr><td class="t-name">version</td><td class="t-type">uint16,uint16</td><td class="t-val">${head.majorVersion}.${head.minorVersion}</td><td class="t-note">Always 1.0 in modern fonts.</td></tr>
      <tr><td class="t-name">fontRevision</td><td class="t-type">Fixed</td><td class="t-val">${head.fontRevision.toFixed(3)}</td><td class="t-note">Set by the type designer; informational.</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-red"></span>magicNumber</td><td class="t-type">uint32</td><td class="t-val">0x${head.magicNumber.toString(16).toUpperCase().padStart(8,'0')}</td><td class="t-note">Required to be <code>0x5F0F3CF5</code> — ${magicOK}.</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-blue"></span>unitsPerEm</td><td class="t-type">uint16</td><td class="t-val">${head.unitsPerEm}</td><td class="t-note">All glyph coordinates are integers in this design space.</td></tr>
      <tr><td class="t-name">created</td><td class="t-type">LONGDATETIME</td><td class="t-val">${head.created.toISOString().slice(0,10)}</td><td class="t-note">Seconds since 1904-01-01 UTC.</td></tr>
      <tr><td class="t-name">modified</td><td class="t-type">LONGDATETIME</td><td class="t-val">${head.modified.toISOString().slice(0,10)}</td><td class="t-note"></td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-green"></span>x/yMin – x/yMax</td><td class="t-type">FWord ×4</td><td class="t-val">(${head.xMin}, ${head.yMin}) → (${head.xMax}, ${head.yMax})</td><td class="t-note">The smallest rectangle that contains every glyph in the font.</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-purple"></span>indexToLocFormat</td><td class="t-type">int16</td><td class="t-val">${head.indexToLocFormat}</td><td class="t-note">${indexFmt} — needed to read <span class="tag">loca</span>.</td></tr>
    </tbody>`;

  // bounding box drawing
  const bx = $('#bbox-display');
  const w = 720, h = 220;
  const upem = head.unitsPerEm;
  const margin = 30;
  const cw = w - margin * 2;
  const ch = h - margin * 2;
  // map x: head.xMin..head.xMax -> margin..margin+cw
  // map y: head.yMin..head.yMax -> margin+ch..margin (flipped)
  const fw = head.xMax - head.xMin;
  const fh = head.yMax - head.yMin;
  const sc = Math.min(cw / fw, ch / fh);
  const cx = margin + (cw - fw * sc) / 2;
  const cy = margin + (ch - fh * sc) / 2;
  const X = (vx) => cx + (vx - head.xMin) * sc;
  const Y = (vy) => cy + ch - (vy - head.yMin) * sc - (ch - fh * sc);

  // em square (0..upem)
  const emY0 = Y(0), emY1 = Y(upem);
  const emX0 = X(0), emX1 = X(upem);

  bx.innerHTML = `<svg viewBox="0 0 ${w} ${h}">
    <rect x="${X(head.xMin)}" y="${Y(head.yMax)}" width="${fw*sc}" height="${fh*sc}" fill="oklch(94% 0.04 28)" stroke="var(--accent)" stroke-width="1"/>
    <rect x="${emX0}" y="${emY1}" width="${(emX1-emX0)}" height="${(emY0-emY1)}" fill="none" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="3 3"/>
    <line x1="${X(head.xMin)}" y1="${Y(0)}" x2="${X(head.xMax)}" y2="${Y(0)}" stroke="var(--ink-soft)" stroke-width="0.7"/>
    <text x="${X(head.xMin)+5}" y="${Y(0)-4}" font-family="var(--mono)" font-size="11" fill="var(--ink-soft)">baseline (y = 0)</text>
    <text x="${X(head.xMax)-2}" y="${Y(head.yMax)-3}" text-anchor="end" font-family="var(--mono)" font-size="11" fill="var(--accent)">font bbox  (${head.xMin},${head.yMin}) → (${head.xMax},${head.yMax})</text>
    <text x="${emX1+4}" y="${emY1+11}" font-family="var(--mono)" font-size="11" fill="var(--ink-faint)">em square (${upem} × ${upem})</text>
  </svg>`;
}

function renderHheaHmtx(parser, head, hhea, hmtx, numGlyphs) {
  const tH = parser.tables['hhea'];
  const tM = parser.tables['hmtx'];
  if (!tH || !hhea) return;

  const o = tH.offset;
  renderHexView($('#hex-hhea'), parser, o, o + tH.length, [
    { start: o + 4,  length: 2, className: 'hl-red',    label: 'ascender' },
    { start: o + 6,  length: 2, className: 'hl-blue',   label: 'descender' },
    { start: o + 8,  length: 2, className: 'hl-green',  label: 'lineGap' },
    { start: o + 34, length: 2, className: 'hl-purple', label: 'numberOfHMetrics' },
  ]);
  $('#hhea-fields').innerHTML = `
    <thead><tr><th>field</th><th>type</th><th>value</th><th>meaning</th></tr></thead>
    <tbody>
      <tr><td class="t-name"><span class="swatch-inline hl-red"></span>ascender</td><td class="t-type">FWord</td><td class="t-val">${hhea.ascender}</td><td class="t-note">Distance from baseline to the top of the design area, in em units.</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-blue"></span>descender</td><td class="t-type">FWord</td><td class="t-val">${hhea.descender}</td><td class="t-note">Negative — distance from baseline downward.</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-green"></span>lineGap</td><td class="t-type">FWord</td><td class="t-val">${hhea.lineGap}</td><td class="t-note">Recommended extra leading between lines.</td></tr>
      <tr><td class="t-name">advanceWidthMax</td><td class="t-type">UFWord</td><td class="t-val">${hhea.advanceWidthMax}</td><td class="t-note">The widest glyph's advance width.</td></tr>
      <tr><td class="t-name"><span class="swatch-inline hl-purple"></span>numberOfHMetrics</td><td class="t-type">uint16</td><td class="t-val">${hhea.numberOfHMetrics}</td><td class="t-note">Length of the (advance, lsb) prefix in <span class="tag">hmtx</span>.</td></tr>
    </tbody>`;

  // hmtx: show the first ~10 entries
  if (!tM || !hmtx) return;
  const oM = tM.offset;
  const showEntries = Math.min(10, hhea.numberOfHMetrics);
  const showEnd = oM + showEntries * 4;
  const highlights = [];
  for (let i = 0; i < showEntries; i++) {
    const cls = (i % 2 === 0) ? 'hl-amber' : 'hl-teal';
    highlights.push({ start: oM + i * 4, length: 4, className: cls,
      label: i === 0 ? '4-byte hMetric pair' : null });
  }
  renderHexView($('#hex-hmtx'), parser, oM, showEnd, highlights);

  // table of first ~10 metrics
  let html = `<thead><tr><th>gid</th><th>advanceWidth</th><th>leftSideBearing</th><th></th></tr></thead><tbody>`;
  for (let i = 0; i < Math.min(10, hmtx.length); i++) {
    const m = hmtx[i];
    html += `<tr><td class="t-name">${i}</td><td class="t-val">${m.advanceWidth}</td><td class="t-val">${m.lsb}</td><td class="t-note">${i===0?'(.notdef)':''}</td></tr>`;
  }
  html += '</tbody>';
  $('#hmtx-fields').innerHTML = html;
}

function renderCmap(parser, cmap, fmt4, currentChar) {
  // Subtables list
  const subT = $('#cmap-subtables');
  let html = '<thead><tr><th>platform</th><th>encoding</th><th>format</th><th>offset (rel)</th><th></th></tr></thead><tbody>';
  for (const e of cmap.encodings) {
    const platName = ({0:'Unicode', 1:'Macintosh', 3:'Microsoft'})[e.platformID] || `(${e.platformID})`;
    const isPicked = e.absoluteSubtableOffset === fmt4._offset;
    html += `<tr${isPicked?' class="match"':''}><td class="t-name">${e.platformID} <span class="muted">(${platName})</span></td><td class="t-name">${e.encodingID}</td><td class="t-val">${e.format}</td><td class="t-name">0x${e.subtableOffset.toString(16).toUpperCase()}</td><td class="t-note">${isPicked?'← format 4 picked for the demo':''}</td></tr>`;
  }
  html += '</tbody>';
  subT.innerHTML = html;

  // Lookup demo
  const cp = currentChar.codePointAt(0);
  $('#cmap-codepoint').textContent = `U+${cp.toString(16).toUpperCase().padStart(4,'0')}`;
  const r = fmt4.lookup(cp);
  $('#cmap-gid').textContent = r.gid;
  if (r.segment >= 0) {
    $('#cmap-segment').textContent = `[${fmt4.startCodes[r.segment]}, ${fmt4.endCodes[r.segment]}]`;
  } else {
    $('#cmap-segment').textContent = '—';
  }

  // Trace
  const trace = $('#cmap-trace');
  if (r.segment >= 0) {
    const seg = r.segment;
    const startCode = fmt4.startCodes[seg];
    const endCode = fmt4.endCodes[seg];
    const idDelta = fmt4.idDeltas[seg];
    const idRangeOffset = fmt4.idRangeOffsets[seg];
    let steps = [];
    steps.push(`Codepoint <strong>${cp}</strong> falls in segment ${seg}: startCode = ${startCode}, endCode = ${endCode}.`);
    if (r.method === 'delta') {
      steps.push(`idRangeOffset is 0, so glyphId = (codepoint + idDelta) mod 65536.`);
      steps.push(`= (${cp} + ${idDelta}) mod 65536 = <strong>${r.gid}</strong>.`);
    } else if (r.method === 'idRangeOffset') {
      steps.push(`idRangeOffset = ${idRangeOffset}, so we follow it into the glyphIdArray.`);
      steps.push(`Computed glyph index = <strong>${r.gid}</strong>.`);
    } else {
      steps.push(`Codepoint not covered → falls through to glyph 0 (.notdef).`);
    }
    trace.innerHTML = steps.map(s => `<div class="step"><span class="arrow-in">›</span>${s}</div>`).join('');
  } else {
    trace.innerHTML = `<div class="step"><span class="arrow-in">›</span>No segment covers codepoint ${cp} — it maps to glyph 0 (.notdef).</div>`;
  }

  // Segment table — first lots of segments + the matching one
  const segT = $('#seg-table');
  let segHtml = '<thead><tr><th>#</th><th>startCode</th><th>endCode</th><th>idDelta</th><th>idRangeOffset</th></tr></thead><tbody>';
  for (let i = 0; i < fmt4.segCount; i++) {
    const isMatch = i === r.segment;
    const sc = fmt4.startCodes[i];
    const ec = fmt4.endCodes[i];
    const dc = fmt4.idDeltas[i];
    const ro = fmt4.idRangeOffsets[i];
    const startStr = sc === 0xFFFF ? '0xFFFF' : `${sc} U+${sc.toString(16).toUpperCase().padStart(4,'0')}`;
    const endStr   = ec === 0xFFFF ? '0xFFFF' : `${ec} U+${ec.toString(16).toUpperCase().padStart(4,'0')}`;
    segHtml += `<tr${isMatch?' class="match"':''}><td>${i}</td><td>${startStr}</td><td>${endStr}</td><td>${dc}</td><td>${ro}</td></tr>`;
  }
  segHtml += '</tbody>';
  segT.innerHTML = segHtml;

  // scroll to match
  if (r.segment >= 0) {
    const matchRow = segT.querySelector('tr.match');
    if (matchRow) matchRow.scrollIntoView({ block: 'nearest' });
  }
}

// =====================================================================
//  Glyph rendering
// =====================================================================

function renderGlyph(parser, head, hhea, hmtx, glyph, opts) {
  const target = $('#glyph-svg');
  const side   = $('#glyph-side');

  if (!glyph) { target.innerHTML = ''; side.innerHTML = '<em>No glyph.</em>'; return; }

  const showPoints   = opts.showPoints;
  const showImplicit = opts.showImplicit;
  const showMetrics  = opts.showMetrics;
  const showNumbers  = opts.showNumbers;

  const upem = head.unitsPerEm;
  // Drawing area
  const W = 720, H = 480;
  const PAD = 30;
  // Use the glyph's bounding box union'd with metric extents
  const advance = hmtx[glyph.glyphIndex] ? hmtx[glyph.glyphIndex].advanceWidth : 0;
  const left  = Math.min(0, glyph.xMin || 0);
  const right = Math.max(advance, glyph.xMax || 0);
  const bot   = Math.min(hhea.descender, glyph.yMin || 0);
  const top   = Math.max(hhea.ascender,  glyph.yMax || 0);

  const fw = right - left;
  const fh = top - bot;
  const sc = Math.min((W - PAD * 2) / fw, (H - PAD * 2) / fh);
  const cx = PAD + ((W - PAD * 2) - fw * sc) / 2;
  const cy = PAD + ((H - PAD * 2) - fh * sc) / 2;

  // font units → svg coords (y flipped because SVG has y down)
  const X = (x) => cx + (x - left) * sc;
  const Y = (y) => cy + (top - y) * sc;

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`);

  // Background — em-square in design space (0..upem in y from baseline)
  if (showMetrics) {
    // ascent / descent / baseline lines
    parts.push(`<line x1="${X(left)}" y1="${Y(0)}" x2="${X(right)}" y2="${Y(0)}" stroke="var(--ink)" stroke-width="0.8"/>`);
    parts.push(`<text x="${X(left)+4}" y="${Y(0)-4}" font-family="var(--mono)" font-size="11" fill="var(--ink-soft)">baseline (y=0)</text>`);

    parts.push(`<line x1="${X(left)}" y1="${Y(hhea.ascender)}" x2="${X(right)}" y2="${Y(hhea.ascender)}" stroke="var(--ink-faint)" stroke-width="0.6" stroke-dasharray="4 3"/>`);
    parts.push(`<text x="${X(left)+4}" y="${Y(hhea.ascender)-4}" font-family="var(--mono)" font-size="10" fill="var(--ink-faint)">ascender (${hhea.ascender})</text>`);

    parts.push(`<line x1="${X(left)}" y1="${Y(hhea.descender)}" x2="${X(right)}" y2="${Y(hhea.descender)}" stroke="var(--ink-faint)" stroke-width="0.6" stroke-dasharray="4 3"/>`);
    parts.push(`<text x="${X(left)+4}" y="${Y(hhea.descender)+12}" font-family="var(--mono)" font-size="10" fill="var(--ink-faint)">descender (${hhea.descender})</text>`);

    // origin (0) and advance width
    parts.push(`<line x1="${X(0)}" y1="${PAD/2}" x2="${X(0)}" y2="${H-PAD/2}" stroke="var(--ink)" stroke-width="0.8"/>`);
    parts.push(`<text x="${X(0)+4}" y="${PAD/2+10}" font-family="var(--mono)" font-size="10" fill="var(--ink-soft)">origin (x=0)</text>`);
    if (advance > 0) {
      parts.push(`<line x1="${X(advance)}" y1="${PAD/2}" x2="${X(advance)}" y2="${H-PAD/2}" stroke="var(--accent)" stroke-width="0.8"/>`);
      parts.push(`<text x="${X(advance)-4}" y="${PAD/2+10}" text-anchor="end" font-family="var(--mono)" font-size="10" fill="var(--accent)">advanceWidth = ${advance}</text>`);
      parts.push(`<line x1="${X(0)}" y1="${Y(hhea.descender)+12}" x2="${X(advance)}" y2="${Y(hhea.descender)+12}" stroke="var(--accent)" stroke-width="0.7" marker-start="url(#tickL)" marker-end="url(#tickR)"/>`);
    }
  }

  // The path
  if (glyph.kind === 'simple' && glyph.contours.length > 0) {
    let d = '';
    for (const contour of glyph.contours) {
      d += contourToSVGPath(contour, X, Y);
    }
    parts.push(`<path d="${d}" fill="oklch(22% 0.02 60 / 0.85)" fill-rule="nonzero" stroke="none"/>`);
  } else if (glyph.kind === 'composite') {
    parts.push(`<text x="${W/2}" y="${H/2}" text-anchor="middle" font-family="var(--mono)" font-size="14" fill="var(--accent)">composite glyph — references other glyphs</text>`);
  } else if (glyph.empty) {
    parts.push(`<text x="${W/2}" y="${H/2}" text-anchor="middle" font-family="var(--mono)" font-size="14" fill="var(--ink-faint)">(empty outline)</text>`);
  }

  // Points
  if (showPoints && glyph.kind === 'simple') {
    let pIdx = 0;
    for (const contour of glyph.contours) {
      for (let i = 0; i < contour.length; i++) {
        const p = contour[i];
        if (p.onCurve) {
          parts.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3.5" fill="var(--paper)" stroke="var(--accent)" stroke-width="1.5"/>`);
        } else {
          parts.push(`<rect x="${X(p.x)-3}" y="${Y(p.y)-3}" width="6" height="6" fill="var(--paper)" stroke="var(--hl-blue)" stroke-width="1.5"/>`);
        }
        if (showNumbers) {
          parts.push(`<text x="${X(p.x)+6}" y="${Y(p.y)-4}" font-family="var(--mono)" font-size="9" fill="var(--ink-faint)">${pIdx}</text>`);
        }
        pIdx++;
      }
      // implicit on-curve mid-points between consecutive off-curves
      if (showImplicit) {
        for (let i = 0; i < contour.length; i++) {
          const a = contour[i], b = contour[(i + 1) % contour.length];
          if (!a.onCurve && !b.onCurve) {
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            parts.push(`<circle cx="${X(mx)}" cy="${Y(my)}" r="2" fill="var(--accent)" opacity="0.75"/>`);
          }
        }
      }
    }
  }

  // Arrow markers for advance width tick
  parts.push(`<defs>
    <marker id="tickL" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
      <line x1="3" y1="0" x2="3" y2="6" stroke="var(--accent)" stroke-width="1"/>
    </marker>
    <marker id="tickR" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
      <line x1="3" y1="0" x2="3" y2="6" stroke="var(--accent)" stroke-width="1"/>
    </marker>
  </defs>`);

  parts.push('</svg>');
  target.innerHTML = parts.join('');

  // Side panel
  const m = hmtx[glyph.glyphIndex] || {advanceWidth: '?', lsb: '?'};
  let sideHtml = `<h4>Glyph #${glyph.glyphIndex}</h4>`;
  if (glyph.kind === 'composite') {
    sideHtml += `<p class="muted">This is a <em>composite</em> glyph — its shape is built from references to other glyphs (typical for accented letters). The outline rendered here is its computed bounding box only; rendering composite parts is out of scope for this page.</p>`;
  } else if (glyph.empty) {
    sideHtml += `<p class="muted">This glyph has no outline — it's used for whitespace or unmapped characters.</p>`;
  }
  sideHtml += `<div class="row"><span class="k">kind</span><span class="v">${glyph.kind === 'simple' ? 'simple' : (glyph.kind === 'composite' ? 'composite' : 'empty')}</span></div>`;
  sideHtml += `<div class="row"><span class="k">numberOfContours</span><span class="v">${glyph.numberOfContours}</span></div>`;
  if (glyph.kind === 'simple') {
    sideHtml += `<div class="row"><span class="k">total points</span><span class="v">${glyph.points.length}</span></div>`;
    let onC = 0, offC = 0;
    for (const p of glyph.points) (p.onCurve ? onC++ : offC++);
    sideHtml += `<div class="row"><span class="k">on-curve</span><span class="v">${onC}</span></div>`;
    sideHtml += `<div class="row"><span class="k">off-curve</span><span class="v">${offC}</span></div>`;
  }
  sideHtml += `<div class="row"><span class="k">xMin, yMin</span><span class="v">${glyph.xMin}, ${glyph.yMin}</span></div>`;
  sideHtml += `<div class="row"><span class="k">xMax, yMax</span><span class="v">${glyph.xMax}, ${glyph.yMax}</span></div>`;
  sideHtml += `<div class="row"><span class="k">advanceWidth</span><span class="v">${m.advanceWidth}</span></div>`;
  sideHtml += `<div class="row"><span class="k">leftSideBearing</span><span class="v">${m.lsb}</span></div>`;
  sideHtml += `<div class="row"><span class="k">unitsPerEm</span><span class="v">${upem}</span></div>`;
  sideHtml += `<h4 style="margin-top: 1.25rem;">Legend</h4>`;
  sideHtml += `<div class="row"><span class="k"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;border:1.5px solid var(--accent);background:var(--paper);margin-right:6px;vertical-align:-1px"></span>on-curve</span></div>`;
  sideHtml += `<div class="row"><span class="k"><span style="display:inline-block;width:8px;height:8px;border:1.5px solid var(--hl-blue);background:var(--paper);margin-right:6px;vertical-align:-1px"></span>off-curve (Bézier control)</span></div>`;
  sideHtml += `<div class="row"><span class="k"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);opacity:0.75;margin-right:6px;vertical-align:-1px"></span>implicit on-curve midpoint</span></div>`;
  side.innerHTML = sideHtml;

  // Hex of the glyph bytes
  if (glyph.glyphStart !== undefined) {
    const o = glyph.glyphStart;
    const len = Math.min(glyph.glyphEnd - o, 256); // cap shown bytes
    const highlights = [];
    if (glyph.kind === 'simple') {
      highlights.push({ start: o, length: 2, className: 'hl-red',    label: 'numberOfContours' });
      highlights.push({ start: o + 2, length: 8, className: 'hl-blue',   label: 'glyph bbox (xMin,yMin,xMax,yMax)' });
      const epEnd = o + 10 + glyph.numberOfContours * 2;
      if (epEnd - o <= len) highlights.push({ start: o + 10, length: glyph.numberOfContours * 2, className: 'hl-green', label: 'endPtsOfContours' });
      if (glyph.flagsStart - o <= len) {
        highlights.push({ start: glyph.flagsStart - 2, length: 2, className: 'hl-amber', label: 'instructionLength' });
      }
      if (glyph.flagsStart - o < len) {
        const flagsLen = glyph.xCoordsStart - glyph.flagsStart;
        highlights.push({ start: glyph.flagsStart, length: Math.min(flagsLen, len - (glyph.flagsStart - o)), className: 'hl-purple', label: 'flags (RLE)' });
      }
      if (glyph.xCoordsStart - o < len) {
        const xLen = glyph.yCoordsStart - glyph.xCoordsStart;
        highlights.push({ start: glyph.xCoordsStart, length: Math.min(xLen, len - (glyph.xCoordsStart - o)), className: 'hl-teal', label: 'x deltas' });
      }
      if (glyph.yCoordsStart - o < len) {
        const yLen = glyph.glyphEnd - glyph.yCoordsStart;
        highlights.push({ start: glyph.yCoordsStart, length: Math.min(yLen, len - (glyph.yCoordsStart - o)), className: 'hl-blue', label: 'y deltas' });
      }
    } else if (glyph.kind === 'composite') {
      highlights.push({ start: o, length: 2, className: 'hl-red',  label: 'numberOfContours = -1 (composite)' });
      highlights.push({ start: o + 2, length: 8, className: 'hl-blue', label: 'bbox' });
    }
    renderHexView($('#hex-glyph'), parser, o, o + len, highlights);
  } else {
    $('#hex-glyph').innerHTML = '';
  }
}

// Build the SVG path data for one contour, following TrueType's quadratic
// rules and inserting implicit on-curve midpoints between consecutive
// off-curve points.
function contourToSVGPath(contour, X, Y) {
  if (contour.length === 0) return '';

  // Find a starting on-curve point. If the first point is off-curve, we
  // either use the last point (if it's on-curve) or the implicit midpoint
  // between the last and first.
  let first = contour[0];
  let startIndex = 0;
  let pts = contour.slice();
  if (!first.onCurve) {
    const last = contour[contour.length - 1];
    if (last.onCurve) {
      pts = [last, ...contour];
    } else {
      const mid = { x: (last.x + first.x) / 2, y: (last.y + first.y) / 2, onCurve: true, implicit: true };
      pts = [mid, ...contour];
    }
  }

  let d = '';
  d += `M ${X(pts[0].x).toFixed(2)} ${Y(pts[0].y).toFixed(2)} `;
  let i = 1;
  while (i < pts.length) {
    const p = pts[i];
    if (p.onCurve) {
      d += `L ${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)} `;
      i++;
    } else {
      // off-curve — quadratic control. Find the next "endpoint" — either
      // the next on-curve point, or the implicit midpoint between this
      // off-curve and the next off-curve.
      const next = pts[i + 1];
      if (next && next.onCurve) {
        d += `Q ${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)} ${X(next.x).toFixed(2)} ${Y(next.y).toFixed(2)} `;
        i += 2;
      } else if (next) {
        const mx = (p.x + next.x) / 2, my = (p.y + next.y) / 2;
        d += `Q ${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)} ${X(mx).toFixed(2)} ${Y(my).toFixed(2)} `;
        i++;
      } else {
        // last point and it's off-curve — close back to the start
        d += `Q ${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)} ${X(pts[0].x).toFixed(2)} ${Y(pts[0].y).toFixed(2)} `;
        i++;
      }
    }
  }
  d += 'Z ';
  return d;
}

// =====================================================================
//  Glyph minigrid — small previews for navigation
// =====================================================================

function renderGlyphMini(parser, head, hhea, hmtx, locaOffsets, fmt4, currentGid, onPick) {
  const grid = $('#glyph-mini');
  grid.innerHTML = '';
  // Pick a stable set of common ASCII letters + punctuation
  const charset = 'AaBbCcEeGgRrSs0123!?,@&';
  const seen = new Set();
  const items = [];
  for (const ch of charset) {
    const cp = ch.codePointAt(0);
    const r = fmt4.lookup(cp);
    if (r.gid === 0 || seen.has(r.gid)) continue;
    seen.add(r.gid);
    items.push({ ch, gid: r.gid });
  }

  const W = 100, H = 100, PAD = 8;
  for (const it of items) {
    const g = parser.parseGlyph(it.gid, locaOffsets);
    const fw = head.xMax - head.xMin, fh = head.yMax - head.yMin;
    const sc = Math.min((W - PAD * 2) / fw, (H - PAD * 2) / fh);
    const cx = PAD + ((W - PAD * 2) - fw * sc) / 2;
    const cy = PAD + ((H - PAD * 2) - fh * sc) / 2;
    const X = (x) => cx + (x - head.xMin) * sc;
    const Y = (y) => cy + (head.yMax - y) * sc;
    let svgInner = '';
    if (g.kind === 'simple' && g.contours.length > 0) {
      let d = '';
      for (const ct of g.contours) d += contourToSVGPath(ct, X, Y);
      svgInner = `<path d="${d}" fill="var(--ink)" fill-rule="nonzero"/>`;
    } else if (g.kind === 'composite') {
      svgInner = `<text x="50" y="55" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--ink-faint)">+</text>`;
    }
    const cellHtml = `<svg viewBox="0 0 ${W} ${H}">${svgInner}</svg><span class="gid">${it.gid}</span>`;
    const cell = el('div', { class: 'cell' + (it.gid === currentGid ? ' active' : ''),
      title: `'${it.ch}'  →  gid ${it.gid}`,
      onclick: () => onPick(it.gid),
    });
    cell.innerHTML = cellHtml;
    grid.appendChild(cell);
  }
}

// =====================================================================
//  Main app — boot, parse, wire up interaction
// =====================================================================

const App = {
  parser: null,
  head: null,
  hhea: null,
  hmtx: null,
  maxp: null,
  cmap: null,
  fmt4: null,
  loca: null,
  filename: '',
  filesize: 0,

  // user state
  currentChar: 'A',
  currentGid: -1,
  glyphOpts: { showPoints: true, showImplicit: true, showMetrics: true, showNumbers: false },

  loadBuffer(buffer, filename) {
    this.filename = filename;
    this.filesize = buffer.byteLength;
    try {
      this.parser = new FontParser(buffer);
    } catch (e) {
      this.error('Could not parse the font file: ' + e.message);
      console.error(e);
      return;
    }

    if (this.parser.flavour === 'cff') {
      this.error('This is a CFF-flavored OpenType font (' + filename + ') — outlines are stored in the <span class="tag">CFF</span> table, which is out of scope for this page. The container, directory, and most metric tables are still parseable below — but the glyph outline section will be empty.');
    } else if (this.parser.flavour !== 'truetype') {
      this.error('Unrecognised font flavour 0x' + this.parser.sfntVersion.toString(16).toUpperCase().padStart(8, '0') + '.');
    } else {
      $('#err-box').innerHTML = '';
    }

    this.head = this.parser.parseHead();
    this.hhea = this.parser.parseHhea();
    this.maxp = this.parser.parseMaxp();
    if (!this.head || !this.hhea || !this.maxp) {
      this.error('Font is missing one of the required tables (head / hhea / maxp).');
      return;
    }
    this.hmtx = this.parser.parseHmtx(this.hhea.numberOfHMetrics, this.maxp.numGlyphs);
    this.cmap = this.parser.parseCmap();
    this.fmt4 = null;
    if (this.cmap) {
      // Prefer Unicode BMP format 4: platform 3, encoding 1 — or platform 0
      const candidates = this.cmap.encodings.filter(e => e.format === 4);
      let pick = candidates.find(e => e.platformID === 3 && e.encodingID === 1)
              || candidates.find(e => e.platformID === 0)
              || candidates[0];
      if (pick) this.fmt4 = this.parser.parseCmapFormat4(pick.absoluteSubtableOffset);
    }
    if (this.parser.hasTable('loca') && this.parser.hasTable('glyf')) {
      this.loca = this.parser.parseLoca(this.maxp.numGlyphs, this.head.indexToLocFormat);
    }

    // Initial glyph: 'g' (lots of curves), then 'a', then any non-empty glyph
    this.currentGid = 1;
    if (this.fmt4) {
      for (const ch of ['g', 'a', 'A', 'O']) {
        const r = this.fmt4.lookup(ch.codePointAt(0));
        if (r.gid > 0) { this.currentGid = r.gid; break; }
      }
    }

    this.renderAll();
  },

  error(html) {
    $('#err-box').innerHTML = `<div class="error-box">${html}</div>`;
  },

  renderAll() {
    // loader bar
    $('#loader-name').textContent = this.filename;
    $('#loader-meta').textContent =
      `${fmtBytes(this.filesize)} · ${this.parser.numTables} tables · ${this.parser.flavour === 'truetype' ? 'TrueType' : (this.parser.flavour === 'cff' ? 'CFF/OTF' : 'unknown')} outlines · ${this.maxp ? this.maxp.numGlyphs + ' glyphs' : '?'}`;

    renderHeader(this.parser, this.head, this.hhea, this.maxp);
    renderTableDirectory(this.parser);
    renderMaxp(this.parser, this.maxp);
    renderHead(this.parser, this.head);
    renderHheaHmtx(this.parser, this.head, this.hhea, this.hmtx, this.maxp.numGlyphs);
    if (this.fmt4) {
      renderCmap(this.parser, this.cmap, this.fmt4, this.currentChar);
    }
    this.renderGlyfSection();
  },

  renderGlyfSection() {
    if (!this.loca) {
      $('#hex-glyph').innerHTML = '<div class="error-box">No <span class="tag">glyf</span>/<span class="tag">loca</span> tables — outlines for this font are stored elsewhere (likely <span class="tag">CFF</span>).</div>';
      $('#glyph-svg').innerHTML = '';
      $('#glyph-side').innerHTML = '';
      $('#glyph-mini').innerHTML = '';
      return;
    }
    const gid = Math.max(0, Math.min(this.currentGid, this.maxp.numGlyphs - 1));
    this.currentGid = gid;
    const glyph = this.parser.parseGlyph(gid, this.loca);
    renderGlyph(this.parser, this.head, this.hhea, this.hmtx, glyph, this.glyphOpts);
    if (this.fmt4) {
      renderGlyphMini(this.parser, this.head, this.hhea, this.hmtx, this.loca, this.fmt4, gid, (g) => this.setGid(g));
    }

    // Sync inputs
    $('#gid-input').value = gid;
    $('#gid-input').max   = this.maxp.numGlyphs - 1;
  },

  setChar(ch) {
    if (!ch) return;
    this.currentChar = ch;
    if (this.fmt4) {
      const r = this.fmt4.lookup(ch.codePointAt(0));
      renderCmap(this.parser, this.cmap, this.fmt4, ch);
      // Also drive the glyph view if user typed in the char-input-glyph field
    }
  },

  setGid(g) {
    this.currentGid = g;
    this.renderGlyfSection();
  },
};

// ----- boot -----------------------------------------------------------

async function tryFetchDefaultFont() {
  try {
    const r = await fetch('./SpaceGrotesk-Regular.ttf');
    if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
    const buf = await r.arrayBuffer();
    return { buf, name: 'SpaceGrotesk-Regular.ttf' };
  } catch (e) {
    console.warn('Default font fetch failed:', e);
    return null;
  }
}

function readFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

async function boot() {
  // Wire up loader
  const loader = $('#font-loader');
  const btn = $('#loader-btn');
  const input = $('#loader-input');

  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const buf = await readFile(f);
    App.loadBuffer(buf, f.name);
  });

  // Drag and drop on the whole document
  ['dragenter','dragover'].forEach(ev => {
    document.addEventListener(ev, (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        e.preventDefault();
        loader.classList.add('drag');
      }
    });
  });
  ['dragleave','drop'].forEach(ev => {
    document.addEventListener(ev, (e) => {
      loader.classList.remove('drag');
    });
  });
  document.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    const buf = await readFile(f);
    App.loadBuffer(buf, f.name);
  });

  // cmap input
  $('#cmap-input').addEventListener('input', (e) => {
    const v = e.target.value;
    if (!v) return;
    App.setChar(v[v.length - 1]);
  });

  // glyph controls
  $('#gid-input').addEventListener('input', (e) => {
    const g = parseInt(e.target.value, 10);
    if (!isNaN(g)) App.setGid(g);
  });
  $('#char-input-glyph').addEventListener('input', (e) => {
    const v = e.target.value;
    if (!v) return;
    const ch = v[v.length - 1];
    if (App.fmt4) {
      const r = App.fmt4.lookup(ch.codePointAt(0));
      App.setGid(r.gid);
    }
  });
  $('#gid-prev').addEventListener('click', () => App.setGid(App.currentGid - 1));
  $('#gid-next').addEventListener('click', () => App.setGid(App.currentGid + 1));

  $('#opt-points').addEventListener('change', (e) => { App.glyphOpts.showPoints = e.target.checked; App.renderGlyfSection(); });
  $('#opt-implicit').addEventListener('change', (e) => { App.glyphOpts.showImplicit = e.target.checked; App.renderGlyfSection(); });
  $('#opt-metrics').addEventListener('change', (e) => { App.glyphOpts.showMetrics = e.target.checked; App.renderGlyfSection(); });
  $('#opt-numbers').addEventListener('change', (e) => { App.glyphOpts.showNumbers = e.target.checked; App.renderGlyfSection(); });

  // Try to load the bundled font
  const def = await tryFetchDefaultFont();
  if (def) {
    App.loadBuffer(def.buf, def.name);
  } else {
    $('#loader-name').textContent = '(no font loaded)';
    $('#loader-meta').textContent = 'drop a .ttf or .otf to begin';
    App.error('Could not auto-load the bundled font. Drop a TrueType file on the page (or use the button) to start.');
  }
}

boot();
