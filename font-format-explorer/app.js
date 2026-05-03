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
      // composite glyph — list of (component, transform) records
      const components = [];
      let p = start + 10;
      const F2DOT14 = (o) => this.i16(o) / 16384;
      while (true) {
        const flags = this.u16(p); p += 2;
        const componentGlyphIndex = this.u16(p); p += 2;
        const ARG_1_AND_2_ARE_WORDS = 0x0001;
        const ARGS_ARE_XY_VALUES   = 0x0002;
        const WE_HAVE_A_SCALE      = 0x0008;
        const MORE_COMPONENTS      = 0x0020;
        const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
        const WE_HAVE_A_TWO_BY_TWO = 0x0080;
        let arg1, arg2;
        if (flags & ARG_1_AND_2_ARE_WORDS) {
          arg1 = this.i16(p); arg2 = this.i16(p + 2); p += 4;
        } else {
          arg1 = this.i8(p);  arg2 = this.i8(p + 1); p += 2;
        }
        let xx = 1, yx = 0, xy = 0, yy = 1, dx = 0, dy = 0;
        if (flags & ARGS_ARE_XY_VALUES) { dx = arg1; dy = arg2; }
        if (flags & WE_HAVE_A_SCALE) {
          xx = yy = F2DOT14(p); p += 2;
        } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
          xx = F2DOT14(p); yy = F2DOT14(p + 2); p += 4;
        } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
          xx = F2DOT14(p); yx = F2DOT14(p + 2);
          xy = F2DOT14(p + 4); yy = F2DOT14(p + 6); p += 8;
        }
        components.push({ glyphIndex: componentGlyphIndex, xx, yx, xy, yy, dx, dy, flags });
        if (!(flags & MORE_COMPONENTS)) break;
      }
      return { glyphIndex, kind: 'composite', numberOfContours, xMin, yMin, xMax, yMax,
               components, glyphStart: start, glyphEnd: end };
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

  // ----- composite glyph resolver -----------------------------------
  // Returns a flat list of contours (each a list of {x,y,onCurve}) with all
  // component transforms applied. Recursion depth is capped at 8 to guard
  // against pathological fonts.
  resolveContours(glyphIndex, locaOffsets, depth = 0) {
    if (depth > 8) return [];
    const g = this.parseGlyph(glyphIndex, locaOffsets);
    if (!g) return [];
    if (g.kind === 'simple') {
      return g.contours.map(c => c.map(p => ({ ...p })));
    }
    if (g.kind === 'composite' && g.components) {
      const out = [];
      for (const c of g.components) {
        const sub = this.resolveContours(c.glyphIndex, locaOffsets, depth + 1);
        for (const contour of sub) {
          out.push(contour.map(p => ({
            x: c.xx * p.x + c.xy * p.y + c.dx,
            y: c.yx * p.x + c.yy * p.y + c.dy,
            onCurve: p.onCurve,
            index: p.index,
          })));
        }
      }
      return out;
    }
    return [];
  }

  // ----- kern (legacy OpenType kern table, format 0) -----------------
  parseKern() {
    const t = this.tables['kern']; if (!t) return null;
    const o = t.offset;
    const version = this.u16(o);
    if (version !== 0) return null; // skip Apple-flavored kern
    const nTables = this.u16(o + 2);
    const subtables = [];
    let p = o + 4;
    for (let i = 0; i < nTables; i++) {
      const subVersion = this.u16(p);
      const subLength = this.u16(p + 2);
      const coverage = this.u16(p + 4);
      const format = (coverage >>> 8) & 0xFF;
      const horizontal = !!(coverage & 0x01);
      const isOverride = !!(coverage & 0x08);
      if (format === 0 && horizontal) {
        const nPairs = this.u16(p + 6);
        const pairs = [];
        let pp = p + 14;
        for (let j = 0; j < nPairs; j++) {
          pairs.push({
            left: this.u16(pp),
            right: this.u16(pp + 2),
            value: this.i16(pp + 4),
          });
          pp += 6;
        }
        subtables.push({ format, horizontal, isOverride, pairs });
      }
      p += subLength;
    }
    const map = new Map();
    for (const sub of subtables) {
      for (const pair of sub.pairs) {
        map.set((pair.left << 16) | pair.right, pair.value);
      }
    }
    return {
      _offset: o,
      _source: 'kern',
      version, nTables, subtables,
      lookup: (left, right) => {
        const v = map.get((left << 16) | right);
        return v === undefined ? 0 : v;
      },
      pairCount: map.size,
    };
  }

  // ----- shared OT layout helpers ------------------------------------
  _parseCoverage(o) {
    const format = this.u16(o);
    const out = [];
    if (format === 1) {
      const glyphCount = this.u16(o + 2);
      for (let i = 0; i < glyphCount; i++) out.push(this.u16(o + 4 + i * 2));
    } else if (format === 2) {
      const rangeCount = this.u16(o + 2);
      for (let i = 0; i < rangeCount; i++) {
        const r = o + 4 + i * 6;
        const start = this.u16(r);
        const end = this.u16(r + 2);
        const startCoverageIndex = this.u16(r + 4);
        for (let g = start; g <= end; g++) {
          out[startCoverageIndex + (g - start)] = g;
        }
      }
    }
    return out;
  }

  // returns Map<glyphID, classNumber>; class 0 is the default.
  _parseClassDef(o) {
    const format = this.u16(o);
    const map = new Map();
    if (format === 1) {
      const startGlyphID = this.u16(o + 2);
      const glyphCount = this.u16(o + 4);
      for (let i = 0; i < glyphCount; i++) {
        map.set(startGlyphID + i, this.u16(o + 6 + i * 2));
      }
    } else if (format === 2) {
      const classRangeCount = this.u16(o + 2);
      for (let i = 0; i < classRangeCount; i++) {
        const r = o + 4 + i * 6;
        const start = this.u16(r);
        const end = this.u16(r + 2);
        const cls = this.u16(r + 4);
        for (let g = start; g <= end; g++) map.set(g, cls);
      }
    }
    return map;
  }

  _valueRecordSize(valueFormat) {
    let n = 0;
    for (let i = 0; i < 8; i++) if (valueFormat & (1 << i)) n++;
    return n * 2;
  }

  // returns x-advance only (the only field we use for kerning)
  _readXAdvance(o, valueFormat) {
    let p = o;
    if (valueFormat & 0x0001) p += 2;        // xPlacement
    if (valueFormat & 0x0002) p += 2;        // yPlacement
    if (valueFormat & 0x0004) return this.i16(p); // xAdvance
    return 0;
  }

  // ----- GPOS — pair-adjustment kerning (LookupType 2) --------------
  parseGPOSKerning() {
    const t = this.tables['GPOS']; if (!t) return null;
    const o = t.offset;
    const major = this.u16(o);
    if (major !== 1) return null;
    const scriptListOff   = this.u16(o + 4);
    const featureListOff  = this.u16(o + 6);
    const lookupListOff   = this.u16(o + 8);

    // 1) collect lookup indices for the 'kern' feature
    const flo = o + featureListOff;
    const featureCount = this.u16(flo);
    const kernLookupIndices = new Set();
    for (let i = 0; i < featureCount; i++) {
      const r = flo + 2 + i * 6;
      const tag = this.ascii(r, 4);
      if (tag !== 'kern') continue;
      const featureOff = this.u16(r + 4);
      const fto = flo + featureOff;
      const lookupIndexCount = this.u16(fto + 2);
      for (let j = 0; j < lookupIndexCount; j++) {
        kernLookupIndices.add(this.u16(fto + 4 + j * 2));
      }
    }
    if (kernLookupIndices.size === 0) return null;

    const llo = o + lookupListOff;
    const lookupCount = this.u16(llo);

    // The format-1 (pair set) data, per-pair.
    const pairMap = new Map();
    // Format-2 entries: {coverage:Set<gid>, classDef1:Map, classDef2:Map, class1Count, class2Count, table:int16[][]}
    const classSubs = [];
    let lookupCountKern = 0;
    let format1Subs = 0;
    let format2Subs = 0;

    for (const li of kernLookupIndices) {
      if (li >= lookupCount) continue;
      const lookupOff = this.u16(llo + 2 + li * 2);
      const lpo = llo + lookupOff;
      const lookupType = this.u16(lpo);
      if (lookupType !== 2) continue; // we handle pair adjustment only
      lookupCountKern++;
      const subTableCount = this.u16(lpo + 4);
      for (let s = 0; s < subTableCount; s++) {
        const sto = lpo + this.u16(lpo + 6 + s * 2);
        const posFormat = this.u16(sto);
        const coverageOff = this.u16(sto + 2);
        const valueFormat1 = this.u16(sto + 4);
        const valueFormat2 = this.u16(sto + 6);
        const vrSize1 = this._valueRecordSize(valueFormat1);
        const vrSize2 = this._valueRecordSize(valueFormat2);
        const coverage = this._parseCoverage(sto + coverageOff);

        if (posFormat === 1) {
          format1Subs++;
          const pairSetCount = this.u16(sto + 8);
          for (let k = 0; k < pairSetCount; k++) {
            const pairSetOff = this.u16(sto + 10 + k * 2);
            const pso = sto + pairSetOff;
            const pairValueCount = this.u16(pso);
            const firstGid = coverage[k];
            if (firstGid === undefined) continue;
            const recSize = 2 + vrSize1 + vrSize2;
            for (let r = 0; r < pairValueCount; r++) {
              const rOff = pso + 2 + r * recSize;
              const secondGid = this.u16(rOff);
              const xAdv = this._readXAdvance(rOff + 2, valueFormat1);
              if (xAdv !== 0) {
                pairMap.set((firstGid << 16) | secondGid, xAdv);
              }
            }
          }
        } else if (posFormat === 2) {
          format2Subs++;
          const classDef1Off = this.u16(sto + 8);
          const classDef2Off = this.u16(sto + 10);
          const class1Count = this.u16(sto + 12);
          const class2Count = this.u16(sto + 14);
          const classDef1 = this._parseClassDef(sto + classDef1Off);
          const classDef2 = this._parseClassDef(sto + classDef2Off);
          const class1RecSize = class2Count * (vrSize1 + vrSize2);
          const recOrigin = sto + 16;
          // table[class1][class2] = xAdvance (class1's value1)
          const table = new Array(class1Count);
          for (let c1 = 0; c1 < class1Count; c1++) {
            table[c1] = new Array(class2Count);
            for (let c2 = 0; c2 < class2Count; c2++) {
              const recOff = recOrigin + c1 * class1RecSize + c2 * (vrSize1 + vrSize2);
              table[c1][c2] = this._readXAdvance(recOff, valueFormat1);
            }
          }
          const coverageSet = new Set(coverage);
          classSubs.push({ coverageSet, classDef1, classDef2, class1Count, class2Count, table });
        }
      }
    }

    return {
      _offset: o,
      _source: 'GPOS',
      pairCount: pairMap.size,
      pairFormat1: format1Subs,
      pairFormat2: format2Subs,
      kernLookupCount: lookupCountKern,
      lookup: (left, right) => {
        const direct = pairMap.get((left << 16) | right);
        if (direct !== undefined) return direct;
        for (const sub of classSubs) {
          if (!sub.coverageSet.has(left)) continue;
          const c1 = sub.classDef1.get(left) || 0;
          const c2 = sub.classDef2.get(right) || 0;
          if (c1 < sub.class1Count && c2 < sub.class2Count) {
            const v = sub.table[c1][c2];
            if (v) return v;
          }
        }
        return 0;
      },
    };
  }

  // ----- GSUB — ligature substitution (LookupType 4) ---------------
  parseGSUBLigatures() {
    const t = this.tables['GSUB']; if (!t) return null;
    const o = t.offset;
    const major = this.u16(o);
    if (major !== 1) return null;
    const featureListOff = this.u16(o + 6);
    const lookupListOff  = this.u16(o + 8);

    // collect liga / clig / rlig lookup indices
    const flo = o + featureListOff;
    const featureCount = this.u16(flo);
    const ligaLookupIndices = new Set();
    const featuresFound = new Set();
    for (let i = 0; i < featureCount; i++) {
      const r = flo + 2 + i * 6;
      const tag = this.ascii(r, 4);
      if (tag !== 'liga' && tag !== 'clig' && tag !== 'rlig') continue;
      featuresFound.add(tag);
      const featureOff = this.u16(r + 4);
      const fto = flo + featureOff;
      const lookupIndexCount = this.u16(fto + 2);
      for (let j = 0; j < lookupIndexCount; j++) {
        ligaLookupIndices.add(this.u16(fto + 4 + j * 2));
      }
    }
    if (ligaLookupIndices.size === 0) return null;

    const llo = o + lookupListOff;
    const lookupCount = this.u16(llo);
    // table entries: { components: number[], ligature: number, source: tag }
    const ligatures = [];

    for (const li of ligaLookupIndices) {
      if (li >= lookupCount) continue;
      const lookupOff = this.u16(llo + 2 + li * 2);
      const lpo = llo + lookupOff;
      const lookupType = this.u16(lpo);
      if (lookupType !== 4) continue;
      const subTableCount = this.u16(lpo + 4);
      for (let s = 0; s < subTableCount; s++) {
        const sto = lpo + this.u16(lpo + 6 + s * 2);
        const substFormat = this.u16(sto);
        if (substFormat !== 1) continue;
        const coverageOff = this.u16(sto + 2);
        const ligatureSetCount = this.u16(sto + 4);
        const coverage = this._parseCoverage(sto + coverageOff);
        for (let k = 0; k < ligatureSetCount; k++) {
          const ligSetOff = this.u16(sto + 6 + k * 2);
          const lso = sto + ligSetOff;
          const firstGid = coverage[k];
          if (firstGid === undefined) continue;
          const ligatureCount = this.u16(lso);
          for (let l = 0; l < ligatureCount; l++) {
            const ligOff = this.u16(lso + 2 + l * 2);
            const lo = lso + ligOff;
            const ligatureGlyph = this.u16(lo);
            const componentCount = this.u16(lo + 2);
            const components = [firstGid];
            for (let m = 0; m < componentCount - 1; m++) {
              components.push(this.u16(lo + 4 + m * 2));
            }
            ligatures.push({ components, ligature: ligatureGlyph });
          }
        }
      }
    }
    // Longer matches first so e.g. "ffi" beats "fi".
    ligatures.sort((a, b) => b.components.length - a.components.length);

    // Index ligatures by first glyph for faster matching.
    const byFirst = new Map();
    for (const lig of ligatures) {
      const key = lig.components[0];
      if (!byFirst.has(key)) byFirst.set(key, []);
      byFirst.get(key).push(lig);
    }

    return {
      _offset: o,
      featuresFound: [...featuresFound],
      ligatureCount: ligatures.length,
      ligatures,
      apply: (gids) => {
        // Each output: { gid, sources: number[], ligaInfo?: {tag, comps:gid[]} }
        const out = [];
        let i = 0;
        while (i < gids.length) {
          const candidates = byFirst.get(gids[i]);
          let matched = null;
          if (candidates) {
            for (const lig of candidates) {
              if (i + lig.components.length > gids.length) continue;
              let ok = true;
              for (let k = 1; k < lig.components.length; k++) {
                if (gids[i + k] !== lig.components[k]) { ok = false; break; }
              }
              if (ok) { matched = lig; break; }
            }
          }
          if (matched) {
            out.push({
              gid: matched.ligature,
              sources: matched.components.map((_, k) => i + k),
              ligaInfo: { comps: matched.components.slice() },
            });
            i += matched.components.length;
          } else {
            out.push({ gid: gids[i], sources: [i] });
            i++;
          }
        }
        return out;
      },
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

  // Scroll the matched row into view *within its scrollable wrapper only*.
  // Using element.scrollIntoView() would also scroll the document, which on
  // initial load yanks the page down to the cmap section.
  if (r.segment >= 0) {
    const matchRow = segT.querySelector('tr.match');
    if (matchRow) {
      const wrap = segT.parentElement;
      const rowTop = matchRow.offsetTop;
      const rowH = matchRow.offsetHeight;
      const viewH = wrap.clientHeight;
      if (rowTop < wrap.scrollTop || rowTop + rowH > wrap.scrollTop + viewH) {
        wrap.scrollTop = rowTop - (viewH - rowH) / 2;
      }
    }
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
//  Sandbox — type a word, see the whole pipeline
// =====================================================================
//
//   text -> codepoints -> gids (via cmap) -> ligatures (GSUB) ->
//   per-glyph advance (hmtx) +/- kern (GPOS) -> SVG layout
//
// The pipeline table mirrors that flow row-by-row.

function shapeText(parser, fmt4, gsubLig, gposKern, text, opts) {
  // 1. characters -> input glyph IDs
  const chars = Array.from(text);
  const inputGids = chars.map(ch => fmt4 ? fmt4.lookup(ch.codePointAt(0)).gid : 0);

  // 2. ligature substitution
  let cluster;  // [{gid, sources:[charIdx...], ligaInfo?}]
  if (opts.ligatures && gsubLig) {
    cluster = gsubLig.apply(inputGids);
  } else {
    cluster = inputGids.map((g, i) => ({ gid: g, sources: [i] }));
  }

  // 3. per-glyph advance + kerning between adjacent glyphs
  const items = [];
  let xPen = 0;
  for (let i = 0; i < cluster.length; i++) {
    const c = cluster[i];
    const m = parser._cachedHmtx[c.gid] || { advanceWidth: 0, lsb: 0 };
    let kern = 0;
    if (opts.kerning && gposKern && i > 0) {
      kern = gposKern.lookup(cluster[i - 1].gid, c.gid);
    }
    xPen += kern;
    items.push({
      ...c,
      chars: c.sources.map(s => chars[s]).join(''),
      codepoints: c.sources.map(s => chars[s].codePointAt(0)),
      advance: m.advanceWidth,
      lsb: m.lsb,
      kern,
      x: xPen,
    });
    xPen += m.advanceWidth;
  }

  return { chars, inputGids, items, totalAdvance: xPen };
}

function renderSandbox(parser, head, hhea, hmtx, locaOffsets, fmt4, gsubLig, gposKern, text, opts) {
  // Cache hmtx as a small map for shapeText (we already have the array)
  parser._cachedHmtx = hmtx;

  const stage = $('#sb-stage');
  const pipeline = $('#sb-pipeline');
  const summary = $('#sb-summary');
  const note = $('#sb-note');

  // Disable toggles whose features aren't present
  const ligaToggle = $('#sb-liga');
  const kernToggle = $('#sb-kern');
  const ligaLabel = $('#sb-liga-label');
  const kernLabel = $('#sb-kern-label');
  if (!gsubLig) { ligaToggle.disabled = true; ligaLabel.classList.add('disabled'); }
  else          { ligaToggle.disabled = false; ligaLabel.classList.remove('disabled'); }
  if (!gposKern) { kernToggle.disabled = true; kernLabel.classList.add('disabled'); }
  else           { kernToggle.disabled = false; kernLabel.classList.remove('disabled'); }

  if (!fmt4 || !locaOffsets) {
    stage.innerHTML = '<p class="muted" style="padding:0.6rem">Sandbox needs <span class="tag">cmap</span>, <span class="tag">loca</span> and <span class="tag">glyf</span> tables.</p>';
    pipeline.innerHTML = '';
    summary.innerHTML = '';
    note.textContent = '';
    return;
  }

  const shaped = shapeText(parser, fmt4, gsubLig, gposKern, text, opts);

  // -------- Summary line --------
  const ligaCount = shaped.items.filter(it => it.ligaInfo).length;
  let kernCount = 0, kernSum = 0;
  for (const it of shaped.items) {
    if (it.kern !== 0) { kernCount++; kernSum += it.kern; }
  }
  summary.innerHTML = `
    <span><strong>${shaped.chars.length}</strong> characters</span>
    <span><strong>${shaped.items.length}</strong> glyphs</span>
    <span><strong>${ligaCount}</strong> ligature${ligaCount===1?'':'s'} applied</span>
    <span><strong>${kernCount}</strong> kern adjustment${kernCount===1?'':'s'} (Σ ${kernSum} units)</span>
    <span><strong>${shaped.totalAdvance}</strong> total advance (font units)</span>`;

  // -------- Stage SVG --------
  // Map font-unit coords to SVG pixels. We pick a height H, scale = H / (ascender-descender),
  // and a bit of horizontal padding.
  const PAD = 24;
  const H_target = 220;
  const designH = (hhea.ascender - hhea.descender);
  const sc = (H_target - PAD * 2) / designH;
  const W = Math.max(420, Math.ceil(shaped.totalAdvance * sc) + PAD * 2);
  const baselineY = PAD + hhea.ascender * sc;

  // helpers to map glyph-local font-unit coords to SVG coords given an origin x
  const scl = sc;
  const parts = [];
  parts.push(`<svg viewBox="0 0 ${W} ${H_target}" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H_target}">`);

  // Faint baseline + x-height + cap-height guides
  parts.push(`<line x1="${PAD}" y1="${baselineY}" x2="${W - PAD/2}" y2="${baselineY}" stroke="var(--ink-faint)" stroke-width="0.6"/>`);
  parts.push(`<text x="${PAD}" y="${baselineY + 12}" font-family="var(--mono)" font-size="9" fill="var(--ink-faint)">baseline</text>`);
  // ascender / descender
  parts.push(`<line x1="${PAD}" y1="${baselineY - hhea.ascender * scl}" x2="${W - PAD/2}" y2="${baselineY - hhea.ascender * scl}" stroke="var(--ink-faint)" stroke-width="0.4" stroke-dasharray="3 3"/>`);
  parts.push(`<line x1="${PAD}" y1="${baselineY - hhea.descender * scl}" x2="${W - PAD/2}" y2="${baselineY - hhea.descender * scl}" stroke="var(--ink-faint)" stroke-width="0.4" stroke-dasharray="3 3"/>`);

  // Each glyph: outline + thin advance markers
  for (const it of shaped.items) {
    const originX = PAD + it.x * scl;
    const g = parser.parseGlyph(it.gid, locaOffsets);

    // origin tick (where glyph starts)
    if (opts.metrics) {
      parts.push(`<line x1="${originX}" y1="${baselineY - hhea.ascender * scl}" x2="${originX}" y2="${baselineY - hhea.descender * scl}" stroke="var(--rule)" stroke-width="0.5"/>`);
    }
    // kerning highlight: shaded vertical slab between the previous glyph's advance end and this glyph's origin
    if (opts.metrics && it.kern !== 0) {
      const x1 = originX - it.kern * scl;
      const x0 = Math.min(originX, x1);
      const w  = Math.abs(it.kern * scl);
      parts.push(`<rect x="${x0}" y="${baselineY - hhea.ascender * scl}" width="${w}" height="${(hhea.ascender - hhea.descender) * scl}" fill="${it.kern < 0 ? 'oklch(70% 0.10 28 / 0.20)' : 'oklch(70% 0.10 240 / 0.20)'}"/>`);
    }

    // path — resolve composites recursively so 'i', 'é' etc. render properly
    const flatContours = (g.kind === 'simple')
      ? g.contours
      : (g.kind === 'composite' ? parser.resolveContours(it.gid, locaOffsets) : []);
    if (flatContours.length > 0) {
      const X = (x) => originX + x * scl;
      const Y = (y) => baselineY - y * scl;
      let d = '';
      for (const ct of flatContours) d += contourToSVGPath(ct, X, Y);
      const fill = it.ligaInfo ? 'var(--accent)' : 'var(--ink)';
      parts.push(`<path d="${d}" fill="${fill}" fill-opacity="${it.ligaInfo ? 0.85 : 0.9}" fill-rule="nonzero"/>`);
    }
  }

  parts.push('</svg>');
  stage.innerHTML = parts.join('');

  // -------- Pipeline table --------
  let html = `<thead><tr>
    <th>#</th><th>chars</th><th>codepoint</th><th>glyph</th><th>gid</th>
    <th>advanceWidth</th><th>lsb</th><th>kern</th><th>x position</th><th>note</th>
  </tr></thead><tbody>`;
  for (let i = 0; i < shaped.items.length; i++) {
    const it = shaped.items[i];
    const rowCls = it.ligaInfo ? ' class="row-liga"' : '';
    const cps = it.codepoints.map(c => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
    const charsHtml = `<span class="ch">${escapeHtml(it.chars)}</span>${it.ligaInfo ? ` <span class="liga-bracket">[${it.ligaInfo.comps.join('+')}]</span>` : ''}`;
    // small thumbnail
    const thumb = renderGlyphThumbSvg(parser, head, hhea, locaOffsets, it.gid, 28);
    const kernCls = it.kern !== 0 ? 'kern-val' : 'kern-val';
    const kernText = it.kern !== 0 ? (it.kern > 0 ? '+' + it.kern : it.kern) : '0';
    const note = it.ligaInfo ? `liga ← ${it.ligaInfo.comps.join(', ')}` : '';
    html += `<tr${rowCls}${it.kern !== 0 ? ' data-has-kern="1"' : ''}>
      <td>${i}</td>
      <td class="src-chars">${charsHtml}</td>
      <td>${cps}</td>
      <td class="glyph-cell">${thumb}</td>
      <td${it.ligaInfo ? ' class="is-liga"' : ''}>${it.gid}</td>
      <td>${it.advance}</td>
      <td>${it.lsb}</td>
      <td class="${kernCls}">${kernText}</td>
      <td>${it.x}</td>
      <td style="text-align:left;color:var(--ink-soft)">${note}</td>
    </tr>`;
  }
  html += '</tbody>';
  pipeline.innerHTML = html;

  // Footnote about which features are active / present
  const noteParts = [];
  if (gsubLig) noteParts.push(`GSUB <code>liga</code>: ${gsubLig.ligatureCount} ligature${gsubLig.ligatureCount===1?'':'s'} defined`);
  else noteParts.push(`No GSUB ligatures in this font`);
  if (gposKern) noteParts.push(`GPOS <code>kern</code>: ${gposKern.pairCount} explicit pairs + ${gposKern.pairFormat2 > 0 ? 'class-based subtable' : 'no class-based table'}`);
  else if (parser.hasTable('kern')) noteParts.push(`Legacy <code>kern</code> table present`);
  else noteParts.push(`No kerning data in this font`);
  note.innerHTML = noteParts.join(' &middot; ');
}

// Tiny inline SVG showing one glyph at a small fixed size (for the pipeline table).
function renderGlyphThumbSvg(parser, head, hhea, locaOffsets, gid, size) {
  if (!locaOffsets) return '';
  const g = parser.parseGlyph(gid, locaOffsets);
  if (!g) return '';
  // Use the font's full ascender/descender range so all thumbnails share a baseline.
  const top = hhea.ascender, bot = hhea.descender;
  const xMin = g.xMin ?? 0, xMax = g.xMax ?? 0;
  const fw = Math.max(xMax - xMin, 1);
  const fh = top - bot;
  const sc = Math.min(size / fw, size / fh) * 0.85;
  const cx = (size - fw * sc) / 2 - xMin * sc;
  const cy = size * 0.86;
  const X = (x) => cx + x * sc;
  const Y = (y) => cy - y * sc;
  const flat = (g.kind === 'simple') ? g.contours : parser.resolveContours(gid, locaOffsets);
  let inner = '';
  if (flat.length > 0) {
    let d = '';
    for (const ct of flat) d += contourToSVGPath(ct, X, Y);
    inner = `<path d="${d}" fill="var(--ink)" fill-rule="nonzero"/>`;
  } else {
    inner = `<text x="${size/2}" y="${size/2+4}" text-anchor="middle" font-family="var(--mono)" font-size="9" fill="var(--ink-faint)">·</text>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${inner}</svg>`;
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
  gsubLig: null,
  gposKern: null,
  kern: null,
  filename: '',
  filesize: 0,

  // user state
  currentChar: 'A',
  currentGid: -1,
  glyphOpts: { showPoints: true, showImplicit: true, showMetrics: true, showNumbers: false },
  sandbox: { text: 'Typography fi', ligatures: true, kerning: true, metrics: true },

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
    // Optional layout tables — for the sandbox
    this.gsubLig = this.parser.parseGSUBLigatures();
    this.gposKern = this.parser.parseGPOSKerning();
    this.kern = this.parser.parseKern();
    // If GPOS doesn't exist but legacy kern does, route the sandbox through it.
    if (!this.gposKern && this.kern) this.gposKern = this.kern;

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
    this.renderSandboxSection();
  },

  renderSandboxSection() {
    renderSandbox(this.parser, this.head, this.hhea, this.hmtx, this.loca,
                  this.fmt4, this.gsubLig, this.gposKern,
                  this.sandbox.text, this.sandbox);
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

  // Sandbox inputs
  $('#sb-input').addEventListener('input', (e) => {
    App.sandbox.text = e.target.value;
    App.renderSandboxSection();
  });
  $('#sb-liga').addEventListener('change', (e) => {
    App.sandbox.ligatures = e.target.checked; App.renderSandboxSection();
  });
  $('#sb-kern').addEventListener('change', (e) => {
    App.sandbox.kerning = e.target.checked; App.renderSandboxSection();
  });
  $('#sb-metrics').addEventListener('change', (e) => {
    App.sandbox.metrics = e.target.checked; App.renderSandboxSection();
  });

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
