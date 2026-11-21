/* =====================================================================
   A small ZIP writer for the EPUB export: store method only (no
   compression), CRC-32, one central directory. No ZIP64, so it is for
   archives under 4 GB with fewer than 65,535 files.

     P.zip([{ name, data }], { type, date }) -> Blob
       name: path inside the archive, with forward slashes
       data: a string (written as UTF-8) or a Uint8Array

   Entries are written in the order given, so an EPUB's "mimetype" file
   can come first, stored and without an extra field, as EPUB requires.
   ===================================================================== */
(function () {
  'use strict';
  const P = (window.Primer = window.Primer || {});
  const enc = new TextEncoder();

  let table = null;
  function crc32(bytes) {
    if (!table) {
      table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ZIP keeps MS-DOS local times: two seconds' resolution, years from 1980.
  function dosTime(d) {
    const year = Math.min(2107, Math.max(1980, d.getFullYear()));
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      day: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  P.zip = function zip(files, opts = {}) {
    if (files.length > 0xffff) throw new Error('Too many files for one archive.');
    const when = dosTime(opts.date || new Date());
    const body = [];
    const dir = [];
    let offset = 0;
    let dirSize = 0;

    files.forEach((f) => {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const flags = /[^\x20-\x7e]/.test(f.name) ? 0x0800 : 0; // bit 11: the name is UTF-8
      if (offset + 30 + name.length + data.length > 0xffffffff) throw new Error('The archive is too large.');

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // local file header
      local.setUint16(4, 10, true);         // version needed: 1.0 (stored)
      local.setUint16(6, flags, true);
      local.setUint16(8, 0, true);          // method 0: stored
      local.setUint16(10, when.time, true);
      local.setUint16(12, when.day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); // compressed size
      local.setUint32(22, data.length, true); // uncompressed size
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);         // no extra field
      body.push(local, name, data);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);   // central directory header
      cen.setUint16(4, 20, true);           // made by: MS-DOS, spec 2.0
      cen.setUint16(6, 10, true);
      cen.setUint16(8, flags, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, when.time, true);
      cen.setUint16(14, when.day, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      // extra length, comment length, disk number, internal and external attributes stay 0
      cen.setUint32(42, offset, true);      // where the local header starts
      dir.push(cen, name);
      dirSize += 46 + name.length;

      offset += 30 + name.length + data.length;
    });

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);     // end of central directory
    end.setUint16(8, files.length, true);   // entries on this disk
    end.setUint16(10, files.length, true);  // entries in total
    end.setUint32(12, dirSize, true);
    end.setUint32(16, offset, true);        // where the central directory starts
    return new Blob(body.concat(dir, [end]), { type: opts.type || 'application/zip' });
  };
  P.zip.crc32 = crc32;
})();
