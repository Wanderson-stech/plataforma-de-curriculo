const windows1252 = new Map([
  ['€', 128], ['…', 133], ['‘', 145], ['’', 146], ['“', 147], ['”', 148],
  ['•', 149], ['–', 150], ['—', 151], ['™', 153]
]);

function pdfString(text) {
  return Array.from(text, character => {
    const point = character.codePointAt(0);
    const byte = windows1252.get(character) ?? (point < 256 ? point : 63);
    return byte < 32 || byte > 126 || [40, 41, 92].includes(byte)
      ? '\\' + byte.toString(8).padStart(3, '0')
      : character;
  }).join('');
}

function wrap(text, width) {
  return text.split(/\r?\n/).flatMap(paragraph => {
    const words = paragraph.trim().split(/\s+/).flatMap(word => word.match(new RegExp('.{1,' + width + '}', 'gu')) ?? []);
    return words.reduce((lines, word) => {
      const last = lines.at(-1);
      if (last && last.length + word.length + 1 <= width) lines[lines.length - 1] += ' ' + word;
      else lines.push(word);
      return lines;
    }, []);
  });
}

export function createPdf(rows) {
  const streams = [[]];
  let y = 790;
  for (const row of rows) {
    const size = row.size ?? 11;
    y -= row.gap ?? 0;
    for (const line of wrap(row.text, Math.floor(84 * 11 / size))) {
      if (y < 53) {
        streams.push([]);
        y = 790;
      }
      streams.at(-1).push('BT /' + (row.bold ? 'F2' : 'F1') + ' ' + size + ' Tf 1 0 0 1 46 ' + y + ' Tm (' + pdfString(line) + ') Tj ET');
      y -= size + 4;
    }
  }

  const pages = streams.map((_, i) => (5 + i * 2) + ' 0 R').join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [' + pages + '] /Count ' + streams.length + ' >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  ];
  for (const [index, commands] of streams.entries()) {
    const stream = commands.join('\n') + '\n';
    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (6 + index * 2) + ' 0 R >>',
      '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream'
    );
  }
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = pdf.length;
    pdf += (i + 1) + ' 0 obj\n' + object + '\nendobj\n';
    return offset;
  });
  const xref = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  pdf += offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return new Blob([pdf], { type: 'application/pdf' });
}
