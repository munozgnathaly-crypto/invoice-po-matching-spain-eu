// ===================== CONFIG =====================
// Which invoice figure is compared with the PO "Amount" column:
//   'tax_base' = amount before VAT (usual for purchase orders)
//   'total'    = invoice total
const COMPARE_FIELD = 'tax_base';
const TOLERANCE_PCT = 0.01;   // 1 %
const TOLERANCE_MAX = 5;      // but never more than 5 €
// ==================================================

const clean = (v) => String(v ?? '').toUpperCase().replace(/[\s.\-\/]/g, '').replace(/^ES/, '');
const toNum = (v) => {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[€\s]/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};
const r2 = (n) => Math.round(n * 100) / 100;

// Open purchase orders read from Google Sheets (columns: PO Number, Supplier NIF, Supplier Name, Amount, Status)
const pos = $('Read Open Purchase Orders').all()
  .map((i) => i.json)
  .filter((r) => r && r['PO Number'] !== undefined && String(r['Status'] ?? '').trim().toLowerCase() === 'open');

const invoices = $('Normalize & Validate').all();

return invoices.map((item) => {
  const inv = item.json;
  const reasons = [...(inv.check_reasons || [])];
  let po = null;
  let lookup_method = '';

  if (inv.po_number) {
    po = pos.find((p) => clean(p['PO Number']) === clean(inv.po_number)) || null;
    if (po) lookup_method = 'PO number';
  }
  if (!po) {
    const bySupplier = pos.filter((p) => clean(p['Supplier NIF']) === clean(inv.supplier_nif));
    if (bySupplier.length === 1) { po = bySupplier[0]; lookup_method = 'supplier NIF (only open PO)'; }
    else if (bySupplier.length > 1) reasons.push(`Supplier has ${bySupplier.length} open POs and the invoice gives no PO number`);
  }

  let po_amount = 0, po_diff = 0, po_tolerance = 0, po_match = false;
  if (po) {
    po_amount = toNum(po['Amount']);
    const invoiceAmount = toNum(inv[COMPARE_FIELD]);
    po_tolerance = r2(Math.min(Math.abs(po_amount) * TOLERANCE_PCT, TOLERANCE_MAX));
    po_diff = r2(invoiceAmount - po_amount);
    po_match = Math.abs(po_diff) <= po_tolerance;
    if (!po_match) reasons.push(`Invoice ${COMPARE_FIELD} ${invoiceAmount} € vs PO ${String(po['PO Number']).trim()} ${po_amount} € (difference ${po_diff} €, tolerance ±${po_tolerance} €)`);
    if (clean(po['Supplier NIF']) && clean(po['Supplier NIF']) !== clean(inv.supplier_nif)) {
      reasons.push(`PO ${String(po['PO Number']).trim()} belongs to supplier ${clean(po['Supplier NIF'])}, invoice is from ${inv.supplier_nif}`);
      po_match = false;
    }
  } else if (!reasons.some((r) => r.includes('open POs'))) {
    reasons.push(inv.po_number ? `PO ${inv.po_number} not found or not open` : 'No PO number and no single open PO for this supplier');
  }

  const notes = [];
  if (inv.multi_vat) notes.push('Several VAT rates on this invoice');
  if (inv.due_date_estimated) notes.push(`Due date estimated (issue date + default days)`);

  const needs_review = reasons.length > 0;
  return {
    json: {
      ...inv,
      po_found: !!po,
      po_number_matched: po ? String(po['PO Number']).trim() : '',
      po_lookup_method: lookup_method,
      po_amount,
      po_difference: po_diff,
      po_tolerance,
      po_match,
      needs_review,
      review_reasons: reasons.join(' | '),
      notes: notes.join(' | '),
    },
    pairedItem: { item: 0 },
  };
});
