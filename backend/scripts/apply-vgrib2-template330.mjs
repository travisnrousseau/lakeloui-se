#!/usr/bin/env node
/**
 * Injects Template 3.30 (Lambert Conformal) into vgrib2 dist so NAM CONUS Nest parses without fallback.
 * Run after postinstall; idempotent.
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const devPath = join(__dirname, "..", "node_modules", "vgrib2", "dist", "vgrib2.cjs.development.js");

let content = readFileSync(devPath, "utf8");
if (content.includes("var template330 = function template330")) {
  process.exit(0);
}

// Add case 30 to getTemplate3
content = content.replace(
  /(case 1:\s+return template31;)\s+(\s+default:)/,
  "$1\n    case 30:\n      return template330;$2"
);

// Add case 30 to lookupTemplate3
content = content.replace(
  /(case 1:\s+return lookupTemplate31;)\s+(\s+default:)/,
  "$1\n    case 30:\n      return lookupTemplate330;$2"
);

const block = `
/** Grid Definition Template 3.30 - Lambert Conformal (NAM CONUS Nest) */
var template330 = function template330(section) {
  var ratio = 1e-6;
  var readLat = function(off) {
    var v = section.readInt32BE(off);
    return (v < 0 ? -(v ^ 0x80000000) : v) * ratio;
  };
  var readLon = function(off) { return section.readInt32BE(off) * ratio; };
  var dxM = section.readUInt32BE(36) * 0.001;
  var dyM = section.readUInt32BE(40) * 0.001;
  var latin1 = section.length >= 54 ? readLat(46) : 25;
  var latin2 = section.length >= 58 ? readLat(50) : 25;
  return {
    shape: section.readUInt8(14),
    nx: section.readUInt32BE(16),
    ny: section.readUInt32BE(20),
    la1: readLat(24),
    lo1: readLon(28),
    lov: readLon(32),
    dx: dxM,
    dy: dyM,
    projectionCenter: section.readUInt8(44),
    scanMode: section.readUInt8(45),
    latin1: latin1,
    latin2: latin2,
    gridUnits: 'lambert'
  };
};

var lookupTemplate330 = function lookupTemplate330(templateValues) {
  return _extends({}, templateValues, {
    shape: lookupTable32(templateValues.shape)
  });
};

`;

// Insert after lookupTemplate31 }; before "Grid Definition Section"
const anchor = "/**\n *  Grid Definition Section";
const idx = content.indexOf(anchor);
if (idx > 0 && !content.includes("var template330 = function template330")) {
  content = content.slice(0, idx) + block + content.slice(idx);
  writeFileSync(devPath, content);
}
