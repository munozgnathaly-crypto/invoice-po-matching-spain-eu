// One output item per PDF or XML attachment in each email.
// The file is passed on as binary property "data".
const out = [];
for (const item of $input.all()) {
  const bin = item.binary || {};
  const from = item.json.from;
  const fromAddress =
    (from && from.value && from.value[0] && from.value[0].address) ||
    (typeof from === 'string' ? from : '');
  for (const b of Object.values(bin)) {
    const name = (b.fileName || '').toLowerCase();
    const mime = (b.mimeType || '').toLowerCase();
    const isXml = name.endsWith('.xml') || name.endsWith('.xsig') || mime.includes('xml');
    const isPdf = name.endsWith('.pdf') || mime === 'application/pdf';
    if (!isXml && !isPdf) continue;
    out.push({
      json: {
        messageId: item.json.id,
        emailFrom: fromAddress,
        emailSubject: item.json.subject || '',
        fileName: b.fileName || '',
        invoiceType: isXml ? 'XML' : 'PDF',
      },
      binary: { data: b },
    });
  }
}
return out;
