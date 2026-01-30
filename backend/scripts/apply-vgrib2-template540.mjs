#!/usr/bin/env node
/**
 * Ensures vgrib2 development build has template 5.40 (JPEG2000) defined.
 * Run after postinstall; patch may fail if context doesn't match, so we inject the block if missing.
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const devPath = join(__dirname, "..", "node_modules", "vgrib2", "dist", "vgrib2.cjs.development.js");

let content = readFileSync(devPath, "utf8");
if (content.includes("var template540 = function template540")) {
  process.exit(0);
}

const block = `
/** Data Representation Template 5.40 - JPEG 2000 Code Stream */
var template540 = function template540(section) {
  return {
    referenceValue: section.readFloatBE(11),
    binaryScaleFactor: section.readInt16BE(15),
    decimalScaleFactor: section.readInt16BE(17),
    numberOfBits: section.readUInt8(19),
    originalType: section.readUInt8(20),
    typeOfCompressionUsed: section.readUInt8(21),
    targetCompressionRatio: section.readUInt8(22)
  };
};

var lookupTemplate540 = function lookupTemplate540(templateValues) {
  return _extends({}, templateValues, {
    originalType: lookupTable51(templateValues.originalType)
  });
};

`;

// Insert after lookupTemplate50 }; before "Data Representation Section"
const anchor = "/**\n *  Data Representation Section";
const idx = content.indexOf(anchor);
if (idx > 0 && !content.includes("var template540 = function template540")) {
  content = content.slice(0, idx) + block + content.slice(idx);
  // Add case 40 in convertData if missing
  if (!content.includes("case 40:")) {
    content = content.replace(
      /(case 0:\s+return simpleUnpacking\(drs, data\);)\s+(default:)/,
      "$1\n    case 40:\n      return data;\n\n    $2"
    );
  }
  writeFileSync(devPath, content);
}
