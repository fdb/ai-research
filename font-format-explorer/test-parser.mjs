// Standalone smoke test for the parsing logic in app.js.
// Pulls FontParser out of app.js by `eval`ing the class block.

import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
// Extract everything from `class FontParser` to the next `// =====` divider
const m = src.match(/class FontParser \{[\s\S]*?\n\}\n/);
if (!m) { console.error('FontParser not found'); process.exit(1); }
eval(m[0] + '; globalThis.FontParser = FontParser;');

const buf = fs.readFileSync(new URL('./SpaceGrotesk-Regular.ttf', import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const p = new FontParser(ab);

console.log('flavour:', p.flavour);
console.log('numTables:', p.numTables);
console.log('tables:', p.tableRecords.map(r => `${r.tag}@${r.offset}+${r.length}`).slice(0, 6).join(', '), '...');

const head = p.parseHead();
console.log('head.unitsPerEm:', head.unitsPerEm);
console.log('head.magicNumber:', '0x' + head.magicNumber.toString(16));
console.log('head.indexToLocFormat:', head.indexToLocFormat);
console.log('head bbox:', head.xMin, head.yMin, head.xMax, head.yMax);

const hhea = p.parseHhea();
console.log('hhea.ascender:', hhea.ascender, 'descender:', hhea.descender, 'numberOfHMetrics:', hhea.numberOfHMetrics);

const maxp = p.parseMaxp();
console.log('maxp.numGlyphs:', maxp.numGlyphs);

const hmtx = p.parseHmtx(hhea.numberOfHMetrics, maxp.numGlyphs);
console.log('hmtx[0..4]:', hmtx.slice(0, 5));

const cmap = p.parseCmap();
console.log('cmap subtables:', cmap.encodings.map(e => `${e.platformID}/${e.encodingID} fmt=${e.format}`).join(', '));

const fmt4Enc = cmap.encodings.find(e => e.format === 4 && e.platformID === 3);
const fmt4 = p.parseCmapFormat4(fmt4Enc.absoluteSubtableOffset);
console.log('fmt4 segCount:', fmt4.segCount);
const lookups = ['A','a','0','!','é','€','你'];
for (const c of lookups) {
  const r = fmt4.lookup(c.codePointAt(0));
  console.log(`  '${c}' (U+${c.codePointAt(0).toString(16)}): gid=${r.gid} via ${r.method}`);
}

const loca = p.parseLoca(maxp.numGlyphs, head.indexToLocFormat);
console.log('loca[0..4]:', Array.from(loca.slice(0, 5)));

// Try parsing a known glyph
const aGid = fmt4.lookup('A'.codePointAt(0)).gid;
const aGlyph = p.parseGlyph(aGid, loca);
console.log('Glyph A (gid', aGid, '):');
console.log('  kind:', aGlyph.kind);
console.log('  numberOfContours:', aGlyph.numberOfContours);
console.log('  bbox:', aGlyph.xMin, aGlyph.yMin, aGlyph.xMax, aGlyph.yMax);
if (aGlyph.kind === 'simple') {
  console.log('  total points:', aGlyph.points.length);
  let on=0, off=0; for (const pt of aGlyph.points) (pt.onCurve?on++:off++);
  console.log('  on-curve / off-curve:', on, '/', off);
  console.log('  first 5 points:', aGlyph.points.slice(0,5));
}

// Try a few more
for (const ch of ['B','O','o','g','&']) {
  const gid = fmt4.lookup(ch.codePointAt(0)).gid;
  const g = p.parseGlyph(gid, loca);
  console.log(`  '${ch}' gid=${gid} kind=${g.kind} contours=${g.numberOfContours} pts=${g.points?g.points.length:0}`);
}

// ---- new: layout features ----
const kern = p.parseKern();
const gpos = p.parseGPOSKerning();
const gsub = p.parseGSUBLigatures();
console.log('kern table:', kern ? `version ${kern.version}, ${kern.subtables.length} subtables` : 'absent');
console.log('GPOS kern:', gpos ? `${gpos.pairCount} explicit pairs, fmt1=${gpos.pairFormat1}, fmt2=${gpos.pairFormat2}` : 'absent');
console.log('GSUB liga:', gsub ? `features=[${gsub.featuresFound}], ${gsub.ligatureCount} ligatures` : 'absent');

if (gpos) {
  for (const [a, b] of [['A','V'],['T','o'],['V','a'],['f','i'],['w','o']]) {
    const ga = fmt4.lookup(a.codePointAt(0)).gid;
    const gb = fmt4.lookup(b.codePointAt(0)).gid;
    console.log(`  kern '${a}${b}' (gid ${ga},${gb}) =`, gpos.lookup(ga, gb));
  }
}
if (gsub) {
  for (const word of ['fi','fl','ffi','ff','cat','office']) {
    const gids = [];
    for (const ch of word) gids.push(fmt4.lookup(ch.codePointAt(0)).gid);
    const out = gsub.apply(gids);
    console.log(`  shape '${word}': ${gids.length} -> ${out.length} glyph(s)`,
                out.map(o => o.ligaInfo ? `liga(${o.ligaInfo.comps.join('+')})=${o.gid}` : `${o.gid}`).join(' '));
  }
}
