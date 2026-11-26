// Runs the workflow's Code-node scripts outside n8n with mocked $input / $() to check the logic.
// Usage: node tests/run_tests.js   (Node 18+, no dependencies)
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '../src/');
const SAMPLES = path.join(__dirname, '../samples/');

function runEach(file, item, refs) {
  const code = fs.readFileSync(SRC + file, 'utf8').replace(/const OUR_NIF = '[^']*'/, "const OUR_NIF = 'B76543214'");
  const fn = new Function('$input', '$', code);
  return fn({ item }, (name) => ({ item: refs[name], all: () => [refs[name]] }));
}
function runAll(file, inputs, refs) {
  const code = fs.readFileSync(SRC + file, 'utf8');
  const fn = new Function('$input', '$', code);
  return fn({ all: () => inputs }, (name) => ({ all: () => refs[name] }));
}
async function xmlNode(file) {
  // what the 'Extract XML Text' node outputs: the raw XML in json.data
  return { data: fs.readFileSync(file, 'utf8') };
}

(async () => {
  const results = [];
  let failures = 0;
  const expect = (label, cond) => { if (!cond) { failures++; console.log('  FAIL:', label); } else console.log('  ok  :', label); };

  // --- detect attachments
  const det = runAll('detect_attachments.js', [{
    json: { id: 'msg1', subject: 'Factura', from: { value: [{ address: 'proveedor@ejemplo.es' }] } },
    binary: { attachment_0: { fileName: 'factura.xml', mimeType: 'text/xml' }, attachment_1: { fileName: 'logo.png', mimeType: 'image/png' }, attachment_2: { fileName: 'Factura.PDF', mimeType: 'application/pdf' } },
  }], {});
  console.log('Detect attachments');
  expect('2 items (xml + pdf, png skipped)', det.length === 2);
  expect('types XML/PDF', det[0].json.invoiceType === 'XML' && det[1].json.invoiceType === 'PDF');
  expect('from address', det[0].json.emailFrom === 'proveedor@ejemplo.es');

  const srcMeta = (f, t) => ({ json: { messageId: 'm-' + f, emailFrom: 'x@y.z', emailSubject: 's', fileName: f, invoiceType: t } });

  for (const ignoreAttrs of ['raw']) {
    console.log(`\nFacturae `);
    const fe = runEach('normalize_validate.js', { json: await xmlNode(SAMPLES + 'factura_facturae_ok.xml', ignoreAttrs) }, { 'Detect Attachments': srcMeta('factura_facturae_ok.xml', 'XML') }).json;
    expect('supplier B12345674 valid CIF', fe.supplier_nif === 'ESB12345674' && fe.supplier_nif_valid && fe.supplier_nif_type === 'CIF');
    expect('customer matches our NIF', fe.customer_nif_valid);
    expect('number A2026-0457', fe.invoice_number === 'A2026-0457');
    expect('base 1000 / VAT 210 / IRPF 150 / total 1060', fe.tax_base === 1000 && fe.vat_amount === 210 && fe.irpf_withholding === 150 && fe.total === 1060);
    expect('totals valid', fe.totals_valid);
    expect('PO number read', fe.po_number === 'PO-2026-001');
    expect('due date from XML', fe.due_date === '2026-12-20' && !fe.due_date_estimated);
    expect('no check reasons', fe.check_reasons.length === 0);
    if (ignoreAttrs === 'raw') results.push({ json: fe });

    console.log(`\nUBL `);
    const ubl = runEach('normalize_validate.js', { json: await xmlNode(SAMPLES + 'invoice_ubl_eu_mismatch.xml', ignoreAttrs) }, { 'Detect Attachments': srcMeta('invoice_ubl_eu_mismatch.xml', 'XML') }).json;
    expect('supplier FR VAT format-only', ubl.supplier_nif_valid && ubl.supplier_nif_type.startsWith('EU VAT'));
    expect('base 500 / VAT 0 / total 500', ubl.tax_base === 500 && ubl.vat_amount === 0 && ubl.total === 500);
    expect('totals valid', ubl.totals_valid);
    expect('PO PO-2026-002', ubl.po_number === 'PO-2026-002');
    expect('customer ok', ubl.customer_nif_valid);
    if (ignoreAttrs === 'raw') results.push({ json: ubl });
  }

  console.log('\nPDF via AI (multi-VAT, Spanish number format, DD/MM/YYYY, no PO, no due date)');
  const pdf = runEach('normalize_validate.js', { json: { output: {
    supplier_name: 'Juan Ejemplo Pérez', supplier_nif: '12.345.678-Z', customer_nif: 'ES B-76543214',
    invoice_series_number: '2026/31', issue_date: '15/11/2026', due_date: '', po_number: '',
    vat_lines: [{ rate: 21, base: '200,00', amount: '42,00' }, { rate: 10, base: '100,00', amount: '10,00' }],
    equivalence_surcharge: 0, irpf_withholding: 0, total: '352,00', verifactu_qr_present: true,
  } } }, { 'Detect Attachments': srcMeta('factura_pdf.pdf', 'PDF') }).json;
  expect('DNI 12345678Z valid', pdf.supplier_nif === '12345678Z' && pdf.supplier_nif_valid && pdf.supplier_nif_type === 'NIF (DNI)');
  expect('customer normalised', pdf.customer_nif === 'B76543214' && pdf.customer_nif_valid);
  expect('multi VAT, base 300, VAT 52, total 352', pdf.multi_vat && pdf.tax_base === 300 && pdf.vat_amount === 52 && pdf.total === 352 && pdf.totals_valid);
  expect('issue date converted', pdf.issue_date === '2026-11-15');
  expect('due date estimated +30', pdf.due_date === '2026-12-15' && pdf.due_date_estimated);
  expect('verifactu flag', pdf.verifactu_qr_present === true);
  results.push({ json: pdf });

  console.log('\nBad invoice (wrong CIF control, wrong totals, wrong customer)');
  const bad = runEach('normalize_validate.js', { json: { output: {
    supplier_name: 'Proveedor Malo SL', supplier_nif: 'B12345675', customer_nif: 'B11111111',
    invoice_series_number: 'X-1', issue_date: '2026-11-01', po_number: 'PO-9999',
    vat_lines: [{ rate: 21, base: 100, amount: 21 }], irpf_withholding: 0, total: 125,
  } } }, { 'Detect Attachments': srcMeta('bad.pdf', 'PDF') }).json;
  expect('CIF rejected', !bad.supplier_nif_valid);
  expect('totals rejected', !bad.totals_valid);
  expect('customer rejected', !bad.customer_nif_valid);
  expect('3 reasons', bad.check_reasons.length === 3);
  results.push({ json: bad });

  console.log('\nTax ID edge cases');
  const ids = { 'X1234567L': true, 'Y1234567X': true, 'A88818505': true, 'P1234567D': true, 'P12345674': false, '12345678A': false, 'DE123456789': true, 'ABC': false };
  for (const [id, want] of Object.entries(ids)) {
    const r = runEach('normalize_validate.js', { json: { output: { supplier_nif: id, vat_lines: [], total: 0 } } }, { 'Detect Attachments': srcMeta('t', 'PDF') }).json;
    expect(`${id} -> ${want}`, r.supplier_nif_valid === want);
  }

  console.log('\nMatch purchase orders');
  const csv = fs.readFileSync(SAMPLES + 'purchase_orders.csv', 'utf8').trim().split('\n');
  const head = csv[0].split(',');
  const pos = csv.slice(1).map((l) => ({ json: Object.fromEntries(l.split(',').map((v, i) => [head[i], v])) }));
  const matched = runAll('match_po.js', pos, { 'Read Open Purchase Orders': pos, 'Normalize & Validate': results });
  const [mFe, mUbl, mPdf, mBad] = matched.map((m) => m.json);
  expect('Facturae: PO-2026-001 by number, OK path', mFe.po_match && mFe.po_lookup_method === 'PO number' && !mFe.needs_review);
  expect('UBL: 500 vs 520 -> review', !mUbl.po_match && mUbl.needs_review && /520/.test(mUbl.review_reasons));
  expect('PDF: PO-2026-003 by supplier NIF, OK path', mPdf.po_match && mPdf.po_lookup_method.startsWith('supplier') && !mPdf.needs_review);
  expect('PDF: notes mention multi VAT + estimated due date', /VAT/.test(mPdf.notes) && /estimated/.test(mPdf.notes));
  expect('Bad: review with PO not found', mBad.needs_review && /not found/.test(mBad.review_reasons));
  expect('Closed PO-2026-004 ignored', !matched.some((m) => m.json.po_number_matched === 'PO-2026-004'));

  console.log('\nRow builders');
  const row = runEach('build_processed_row.js', { json: mFe }, {}).json;
  expect('processed row has Total 1060', row['Total'] === 1060 && row['PO Number'] === 'PO-2026-001');
  const rrow = runEach('build_review_row.js', { json: {} }, { 'Match Purchase Order': { json: mUbl } }).json;
  expect('review row has reasons', rrow['Review Reasons'].includes('PO'));

  console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURE(S)'}`);
  console.log('\nSample review reasons:\n -', mUbl.review_reasons, '\n -', mBad.review_reasons);
  process.exit(failures ? 1 : 0);
})();
