var QR = (function () {
  'use strict';

  // GF(256) with primitive polynomial 0x11D
  var EXP = new Uint8Array(256);
  var LOG = new Uint8Array(256);
  var x = 1;
  for (var i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11D : 0);
  }
  EXP[255] = EXP[0];

  function gfMul(a, b) {
    return (a === 0 || b === 0) ? 0 : EXP[(LOG[a] + LOG[b]) % 255];
  }

  function rsEncode(data, ecLen) {
    var gen = new Uint8Array(ecLen + 1);
    gen[0] = 1;
    for (var i = 0; i < ecLen; i++) {
      var ng = new Uint8Array(ecLen + 1);
      for (var j = 0; j <= i; j++) {
        ng[j] ^= gen[j];
        ng[j + 1] ^= gfMul(gen[j], EXP[i]);
      }
      gen = ng;
    }
    var rem = new Uint8Array(ecLen);
    for (var i = 0; i < data.length; i++) {
      var f = data[i] ^ rem[0];
      for (var j = 0; j < ecLen - 1; j++) rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], f);
      rem[ecLen - 1] = gfMul(gen[ecLen], f);
    }
    return rem;
  }

  // EC params for level M: [ecPerBlock, g1Blocks, g1DataCw, g2Blocks, g2DataCw]
  var EC_M = [
    null,
    [10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],
    [16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44],
    [30,1,50,4,51],[22,6,36,2,37],[22,8,37,1,38],[24,4,40,5,41],[24,5,41,5,42],
    [28,7,45,3,46],[28,10,46,1,47],[26,9,43,4,44],[26,3,44,11,45],[26,3,41,13,42],
    [28,17,42,0,0],[28,17,46,0,0],[28,4,47,14,48],[28,6,45,14,46],[28,8,47,13,48],
    [28,19,46,4,47],[28,22,45,3,46],[28,3,45,23,46],[28,21,45,7,46],[28,19,47,10,48],
    [28,2,46,29,47],[28,10,46,23,47],[28,14,46,21,47],[28,14,46,23,47],[28,12,47,26,48],
    [28,6,47,34,48],[28,29,46,14,47],[28,13,46,32,47],[28,40,47,7,48],[28,18,47,31,48]
  ];

  // Alignment pattern center coords per version
  var ALIGN = [
    null,null,
    [6,18],[6,22],[6,26],[6,30],[6,34],
    [6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],
    [6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],
    [6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],
    [6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],
    [6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],
    [6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],
    [6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166]
  ];

  function getVersion(dataLen) {
    for (var v = 1; v <= 40; v++) {
      var p = EC_M[v];
      var cap = p[1] * p[2] + p[3] * p[4];
      var overhead = v < 10 ? 2 : 3;
      if (dataLen + overhead <= cap) return v;
    }
    return -1;
  }

  function encodeData(bytes, version) {
    var p = EC_M[version];
    var totalDataCw = p[1] * p[2] + p[3] * p[4];
    var charCountBits = version < 10 ? 8 : 16;

    var bits = [];
    function pushBits(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    }

    pushBits(4, 4); // byte mode
    pushBits(bytes.length, charCountBits);
    for (var i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);
    pushBits(0, Math.min(4, totalDataCw * 8 - bits.length)); // terminator
    while (bits.length % 8 !== 0) bits.push(0);
    while (bits.length < totalDataCw * 8) {
      pushBits(0xEC, 8);
      if (bits.length < totalDataCw * 8) pushBits(0x11, 8);
    }

    var codewords = new Uint8Array(totalDataCw);
    for (var i = 0; i < totalDataCw; i++) {
      codewords[i] = (bits[i*8]<<7)|(bits[i*8+1]<<6)|(bits[i*8+2]<<5)|(bits[i*8+3]<<4)|
                     (bits[i*8+4]<<3)|(bits[i*8+5]<<2)|(bits[i*8+6]<<1)|bits[i*8+7];
    }
    return codewords;
  }

  function interleave(dataCw, version) {
    var p = EC_M[version];
    var ecLen = p[0], g1 = p[1], g1d = p[2], g2 = p[3], g2d = p[4];
    var blocks = [], ecBlocks = [];
    var offset = 0;
    for (var i = 0; i < g1; i++) {
      blocks.push(dataCw.slice(offset, offset + g1d));
      ecBlocks.push(rsEncode(blocks[blocks.length-1], ecLen));
      offset += g1d;
    }
    for (var i = 0; i < g2; i++) {
      blocks.push(dataCw.slice(offset, offset + g2d));
      ecBlocks.push(rsEncode(blocks[blocks.length-1], ecLen));
      offset += g2d;
    }

    var result = [];
    var maxData = Math.max(g1d, g2d);
    for (var i = 0; i < maxData; i++) {
      for (var b = 0; b < blocks.length; b++) {
        if (i < blocks[b].length) result.push(blocks[b][i]);
      }
    }
    for (var i = 0; i < ecLen; i++) {
      for (var b = 0; b < ecBlocks.length; b++) {
        result.push(ecBlocks[b][i]);
      }
    }
    return result;
  }

  function createMatrix(version) {
    var size = 17 + version * 4;
    var m = [];
    var reserved = [];
    for (var r = 0; r < size; r++) {
      m[r] = new Uint8Array(size);
      reserved[r] = new Uint8Array(size);
    }

    function setModule(r, c, val) {
      if (r >= 0 && r < size && c >= 0 && c < size) {
        m[r][c] = val ? 1 : 0;
        reserved[r][c] = 1;
      }
    }

    function finderPattern(row, col) {
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var r = row + dr, c = col + dc;
          if (r < 0 || r >= size || c < 0 || c >= size) continue;
          var inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          var inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          var onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
          setModule(r, c, inInner || (inOuter && onBorder));
        }
      }
    }

    finderPattern(0, 0);
    finderPattern(0, size - 7);
    finderPattern(size - 7, 0);

    if (ALIGN[version]) {
      var pos = ALIGN[version];
      for (var i = 0; i < pos.length; i++) {
        for (var j = 0; j < pos.length; j++) {
          if ((i === 0 && j === 0) || (i === 0 && j === pos.length-1) || (i === pos.length-1 && j === 0)) continue;
          var cr = pos[i], cc = pos[j];
          for (var dr = -2; dr <= 2; dr++) {
            for (var dc = -2; dc <= 2; dc++) {
              setModule(cr+dr, cc+dc, Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0));
            }
          }
        }
      }
    }

    // Timing patterns
    for (var i = 8; i < size - 8; i++) {
      setModule(6, i, i % 2 === 0);
      setModule(i, 6, i % 2 === 0);
    }

    // Dark module
    setModule(size - 8, 8, 1);

    // Reserve format info areas
    for (var i = 0; i < 9; i++) {
      if (!reserved[8][i]) { reserved[8][i] = 1; m[8][i] = 0; }
      if (!reserved[i][8]) { reserved[i][8] = 1; m[i][8] = 0; }
      if (i < 8) {
        if (!reserved[8][size-1-i]) { reserved[8][size-1-i] = 1; m[8][size-1-i] = 0; }
        if (!reserved[size-1-i][8]) { reserved[size-1-i][8] = 1; m[size-1-i][8] = 0; }
      }
    }

    // Reserve version info areas (version >= 7)
    if (version >= 7) {
      for (var i = 0; i < 6; i++) {
        for (var j = 0; j < 3; j++) {
          reserved[i][size-11+j] = 1;
          reserved[size-11+j][i] = 1;
        }
      }
    }

    return { modules: m, reserved: reserved, size: size };
  }

  function placeData(matrix, dataBits) {
    var size = matrix.size;
    var m = matrix.modules;
    var res = matrix.reserved;
    var bitIdx = 0;
    var upward = true;

    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      var rows = upward ? Array.from({length: size}, function(_, i) { return size - 1 - i; }) :
                          Array.from({length: size}, function(_, i) { return i; });
      for (var ri = 0; ri < rows.length; ri++) {
        var row = rows[ri];
        for (var c = 0; c < 2; c++) {
          var col = right - c;
          if (col < 0 || col >= size) continue;
          if (res[row][col]) continue;
          m[row][col] = bitIdx < dataBits.length ? dataBits[bitIdx++] : 0;
        }
      }
      upward = !upward;
    }
  }

  function applyMask(matrix, maskIdx) {
    var size = matrix.size;
    var m = matrix.modules;
    var res = matrix.reserved;
    var fns = [
      function(r,c){return(r+c)%2===0},
      function(r){return r%2===0},
      function(r,c){return c%3===0},
      function(r,c){return(r+c)%3===0},
      function(r,c){return(Math.floor(r/2)+Math.floor(c/3))%2===0},
      function(r,c){return(r*c)%2+(r*c)%3===0},
      function(r,c){return((r*c)%2+(r*c)%3)%2===0},
      function(r,c){return((r+c)%2+(r*c)%3)%2===0}
    ];
    var fn = fns[maskIdx];
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (!res[r][c] && fn(r, c)) m[r][c] ^= 1;
      }
    }
  }

  function penalty(matrix) {
    var size = matrix.size;
    var m = matrix.modules;
    var score = 0;

    // Rule 1: consecutive same-color modules
    for (var r = 0; r < size; r++) {
      var cnt = 1;
      for (var c = 1; c < size; c++) {
        if (m[r][c] === m[r][c-1]) { cnt++; }
        else { if (cnt >= 5) score += cnt - 2; cnt = 1; }
      }
      if (cnt >= 5) score += cnt - 2;
    }
    for (var c = 0; c < size; c++) {
      var cnt = 1;
      for (var r = 1; r < size; r++) {
        if (m[r][c] === m[r-1][c]) { cnt++; }
        else { if (cnt >= 5) score += cnt - 2; cnt = 1; }
      }
      if (cnt >= 5) score += cnt - 2;
    }

    // Rule 2: 2x2 blocks
    for (var r = 0; r < size - 1; r++) {
      for (var c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c+1] && v === m[r+1][c] && v === m[r+1][c+1]) score += 3;
      }
    }

    // Rule 3: finder-like patterns
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size - 10; c++) {
        if (m[r][c]===1&&m[r][c+1]===0&&m[r][c+2]===1&&m[r][c+3]===1&&m[r][c+4]===1&&
            m[r][c+5]===0&&m[r][c+6]===1&&m[r][c+7]===0&&m[r][c+8]===0&&m[r][c+9]===0&&m[r][c+10]===0) score += 40;
        if (m[r][c]===0&&m[r][c+1]===0&&m[r][c+2]===0&&m[r][c+3]===0&&m[r][c+4]===1&&
            m[r][c+5]===0&&m[r][c+6]===1&&m[r][c+7]===1&&m[r][c+8]===1&&m[r][c+9]===0&&m[r][c+10]===1) score += 40;
      }
    }
    for (var c = 0; c < size; c++) {
      for (var r = 0; r < size - 10; r++) {
        if (m[r][c]===1&&m[r+1][c]===0&&m[r+2][c]===1&&m[r+3][c]===1&&m[r+4][c]===1&&
            m[r+5][c]===0&&m[r+6][c]===1&&m[r+7][c]===0&&m[r+8][c]===0&&m[r+9][c]===0&&m[r+10][c]===0) score += 40;
        if (m[r][c]===0&&m[r+1][c]===0&&m[r+2][c]===0&&m[r+3][c]===0&&m[r+4][c]===1&&
            m[r+5][c]===0&&m[r+6][c]===1&&m[r+7][c]===1&&m[r+8][c]===1&&m[r+9][c]===0&&m[r+10][c]===1) score += 40;
      }
    }

    // Rule 4: dark/light ratio
    var dark = 0;
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) if (m[r][c]) dark++;
    var pct = dark * 100 / (size * size);
    score += Math.abs(Math.floor(pct / 5) * 5 - 50) * 2;

    return score;
  }

  function writeFormatInfo(matrix, maskIdx) {
    var size = matrix.size;
    var m = matrix.modules;
    // EC level M = 00, mask = maskIdx (3 bits) → 5 data bits
    var data = (0 << 3) | maskIdx; // M=00
    var bits = data;
    for (var i = 0; i < 10; i++) {
      bits = (bits << 1) ^ ((bits >> 9) * 0x537);
    }
    var format = ((data << 10) | bits) ^ 0x5412;

    var positions0 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    var positions1 = [[8,size-1],[8,size-2],[8,size-3],[8,size-4],[8,size-5],[8,size-6],[8,size-7],[8,size-8],
                      [size-7,8],[size-6,8],[size-5,8],[size-4,8],[size-3,8],[size-2,8],[size-1,8]];

    for (var i = 0; i < 15; i++) {
      var bit = (format >> (14 - i)) & 1;
      m[positions0[i][0]][positions0[i][1]] = bit;
      m[positions1[i][0]][positions1[i][1]] = bit;
    }
  }

  function writeVersionInfo(matrix, version) {
    if (version < 7) return;
    var size = matrix.size;
    var m = matrix.modules;
    var data = version;
    var bits = data;
    for (var i = 0; i < 12; i++) {
      bits = (bits << 1) ^ ((bits >> 11) * 0x1F25);
    }
    var info = (data << 12) | bits;

    for (var i = 0; i < 18; i++) {
      var bit = (info >> i) & 1;
      var r = Math.floor(i / 3);
      var c = i % 3;
      m[r][size - 11 + c] = bit;
      m[size - 11 + c][r] = bit;
    }
  }

  function encode(text) {
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) { bytes.push(0xC0|(code>>6)); bytes.push(0x80|(code&0x3F)); }
      else { bytes.push(0xE0|(code>>12)); bytes.push(0x80|((code>>6)&0x3F)); bytes.push(0x80|(code&0x3F)); }
    }

    var version = getVersion(bytes.length);
    if (version < 0) return null;

    var dataCw = encodeData(new Uint8Array(bytes), version);
    var allCw = interleave(dataCw, version);

    var dataBits = [];
    for (var i = 0; i < allCw.length; i++) {
      for (var b = 7; b >= 0; b--) dataBits.push((allCw[i] >> b) & 1);
    }

    // Remainder bits
    var remBits = [0,0,7,7,7,7,7,0,0,0,0,0,0,0,3,3,3,3,3,3,3,4,4,4,4,4,4,4,3,3,3,3,3,3,3,0,0,0,0,0,0];
    for (var i = 0; i < (remBits[version] || 0); i++) dataBits.push(0);

    var bestMask = 0, bestScore = Infinity;
    var bestModules = null;

    for (var mask = 0; mask < 8; mask++) {
      var mat = createMatrix(version);
      placeData(mat, dataBits);
      applyMask(mat, mask);
      writeFormatInfo(mat, mask);
      writeVersionInfo(mat, version);
      var s = penalty(mat);
      if (s < bestScore) {
        bestScore = s;
        bestMask = mask;
        bestModules = mat.modules;
      }
    }

    return { modules: bestModules, size: 17 + version * 4, version: version };
  }

  function toCanvas(qr, canvas, cellSize, darkColor, lightColor) {
    cellSize = cellSize || 8;
    darkColor = darkColor || '#1C1B1A';
    lightColor = lightColor || '#EDE6D6';
    var quiet = 4;
    var total = qr.size + quiet * 2;
    canvas.width = total * cellSize;
    canvas.height = total * cellSize;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = lightColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = darkColor;
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) {
          ctx.fillRect((c + quiet) * cellSize, (r + quiet) * cellSize, cellSize, cellSize);
        }
      }
    }
  }

  return { encode: encode, toCanvas: toCanvas };
})();
