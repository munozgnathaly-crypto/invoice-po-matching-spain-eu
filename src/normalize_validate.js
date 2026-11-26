// ===================== CONFIG =====================
const OUR_NIF = 'B00000000';      // <-- your company NIF/CIF (with or without "ES")
const DEFAULT_PAYMENT_DAYS = 30;  // used when the invoice has no due date
const TOTAL_TOLERANCE = 0.02;     // € allowed between calculated and stated total
// ==================================================

const src = $('Detect Attachments').item.json;
const j = $input.item.json;

// ---------- helpers ----------
const toNum = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v._ !== undefined) v = v._;
  let s = String(v).replace(/[€\s%]/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')   // 1.234,56
      : s.replace(/,/g, '');                      // 1,234.56
  } else if (s.includes(',')) {
    s = s.replace(',', '.');                      // 1234,56
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};
const r2 = (n) => Math.round(n * 100) / 100;
const text = (v) => (v === null || v === undefined) ? '' : (typeof v === 'object' ? String(v._ ?? '') : String(v)).trim();
const cleanId = (v) => text(v).toUpperCase().replace(/[\s.\-\/]/g, '');
const arr = (v) => (v === undefined || v === null) ? [] : (Array.isArray(v) ? v : [v]);
const get = (o, path) => path.split('.').reduce((a, k) => {
  if (a === null || a === undefined) return undefined;
  if (Array.isArray(a)) a = a[0];
  return a[k];
}, o);
// remove XML namespace prefixes: "fe:Facturae" -> "Facturae", "cbc:ID" -> "ID"
const strip = (o) => Array.isArray(o) ? o.map(strip)
  : (o && typeof o === 'object')
    ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k.includes(':') ? k.split(':').pop() : k, strip(v)]))
    : o;
const isoDate = (v) => {
  const s = text(v);
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);   // DD/MM/YYYY (Spanish)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
};


// small XML reader (no external libraries in the n8n Code node)
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function parseXml(xml) {
  xml = String(xml).replace(/^﻿/, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const root = {};
  const stack = [{ name: '#root', obj: root, text: '' }];
  const add = (parent, name, val) => {
    if (parent[name] === undefined) parent[name] = val;
    else { if (!Array.isArray(parent[name])) parent[name] = [parent[name]]; parent[name].push(val); }
  };
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s\/>!]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (stack.length < 2) break;
      const n = stack.pop();
      add(stack[stack.length - 1].obj, n.name, Object.keys(n.obj).length ? n.obj : decode(n.text.trim()));
    } else if (m[3]) {
      if (m[5] === '/') add(top.obj, m[3], '');
      else stack.push({ name: m[3], obj: {}, text: '' });
    } else if (m[6]) top.text += m[6];
  }
  return root;
}

// ---------- Spanish NIF / NIE / CIF and EU VAT ----------
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
function checkTaxId(raw) {
  let id = cleanId(raw);
  if (!id) return { valid: false, kind: 'empty', note: 'No tax ID found' };
  if (id.startsWith('ES')) id = id.slice(2);
  if (/^\d{8}[A-Z]$/.test(id)) {                                   // DNI
    const ok = DNI_LETTERS[parseInt(id.slice(0, 8), 10) % 23] === id[8];
    return { valid: ok, kind: 'NIF (DNI)', note: ok ? '' : 'Wrong NIF control letter' };
  }
  if (/^[XYZ]\d{7}[A-Z]$/.test(id)) {                              // NIE
    const num = 'XYZ'.indexOf(id[0]) + id.slice(1, 8);
    const ok = DNI_LETTERS[parseInt(num, 10) % 23] === id[8];
    return { valid: ok, kind: 'NIE', note: ok ? '' : 'Wrong NIE control letter' };
  }
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(id)) {             // CIF
    const d = id.slice(1, 8);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      let n = parseInt(d[i], 10);
      if (i % 2 === 0) { n *= 2; n = Math.floor(n / 10) + (n % 10); }
      sum += n;
    }
    const digit = (10 - (sum % 10)) % 10;
    const letter = 'JABCDEFGHI'[digit];
    const ctrl = id[8];
    let ok;
    if ('PQRSNW'.includes(id[0])) ok = ctrl === letter;            // letter control only
    else if ('ABEH'.includes(id[0])) ok = ctrl === String(digit);  // digit control only
    else ok = ctrl === letter || ctrl === String(digit);
    return { valid: ok, kind: 'CIF', note: ok ? '' : 'Wrong CIF control character' };
  }
  const eu = /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)[0-9A-Z]{2,13}$/;
  if (eu.test(cleanId(raw))) {
    return { valid: true, kind: 'EU VAT (format only)', note: 'EU VAT number: format checked only, confirm in VIES' };
  }
  return { valid: false, kind: 'unknown', note: 'Tax ID format not recognised' };
}

// ---------- read the invoice ----------
let inv;
if (j.output) {
  // PDF path: data comes from the Information Extractor (AI)
  const o = j.output;
  inv = {
    source: 'PDF (AI extraction)',
    supplier_name: text(o.supplier_name),
    supplier_nif: o.supplier_nif,
    customer_nif: o.customer_nif,
    invoice_number: text(o.invoice_series_number),
    issue_date: o.issue_date,
    due_date: o.due_date,
    po_number: text(o.po_number),
    vat_lines: arr(o.vat_lines).map((l) => ({ rate: toNum(l.rate), base: toNum(l.base), amount: toNum(l.amount) })),
    surcharge: toNum(o.equivalence_surcharge),
    irpf: toNum(o.irpf_withholding),
    total: toNum(o.total),
    verifactu_qr: o.verifactu_qr_present === true,
  };
} else {
  // XML path: Facturae (Spain) or UBL (EU / Peppol)
  const x = strip(typeof j.data === 'string' ? parseXml(j.data) : j);
  const fe = x.Facturae;
  const ubl = x.Invoice;
  if (fe) {
    const seller = get(fe, 'Parties.SellerParty');
    const buyer = get(fe, 'Parties.BuyerParty');
    const invc = arr(get(fe, 'Invoices.Invoice'))[0] || {};
    const taxes = arr(get(invc, 'TaxesOutputs.Tax'));
    const lines = arr(get(invc, 'Items.InvoiceLine'));
    const po = lines.map((l) => text(l.ReceiverTransactionReference) || text(l.ReceiverContractReference)).find(Boolean) || '';
    inv = {
      source: 'XML (Facturae)',
      supplier_name: text(get(seller, 'LegalEntity.CorporateName')) ||
        [get(seller, 'Individual.Name'), get(seller, 'Individual.FirstSurname')].map(text).filter(Boolean).join(' '),
      supplier_nif: get(seller, 'TaxIdentification.TaxIdentificationNumber'),
      customer_nif: get(buyer, 'TaxIdentification.TaxIdentificationNumber'),
      invoice_number: [get(invc, 'InvoiceHeader.InvoiceSeriesCode'), get(invc, 'InvoiceHeader.InvoiceNumber')].map(text).filter(Boolean).join('-'),
      issue_date: get(invc, 'InvoiceIssueData.IssueDate'),
      due_date: get(invc, 'PaymentDetails.Installment.InstallmentDueDate'),
      po_number: po,
      vat_lines: taxes.map((t) => ({
        rate: toNum(t.TaxRate),
        base: toNum(get(t, 'TaxableBase.TotalAmount')),
        amount: toNum(get(t, 'TaxAmount.TotalAmount')),
      })),
      surcharge: taxes.reduce((s, t) => s + toNum(get(t, 'EquivalenceSurchargeAmount.TotalAmount')), 0),
      irpf: toNum(get(invc, 'InvoiceTotals.TotalTaxesWithheld')),
      total: toNum(get(invc, 'InvoiceTotals.InvoiceTotal')),
      verifactu_qr: false,
    };
  } else if (ubl) {
    const sp = get(ubl, 'AccountingSupplierParty.Party');
    const cp = get(ubl, 'AccountingCustomerParty.Party');
    const subs = arr(ubl.TaxTotal).flatMap((t) => arr(t.TaxSubtotal));
    const irpf = arr(ubl.WithholdingTaxTotal).reduce((s, t) => s + toNum(t.TaxAmount), 0);
    const payable = toNum(get(ubl, 'LegalMonetaryTotal.PayableAmount'));
    const inclusive = toNum(get(ubl, 'LegalMonetaryTotal.TaxInclusiveAmount'));
    inv = {
      source: 'XML (UBL)',
      supplier_name: text(get(sp, 'PartyLegalEntity.RegistrationName')) || text(get(sp, 'PartyName.Name')),
      supplier_nif: get(sp, 'PartyTaxScheme.CompanyID') || get(sp, 'PartyLegalEntity.CompanyID'),
      customer_nif: get(cp, 'PartyTaxScheme.CompanyID') || get(cp, 'PartyLegalEntity.CompanyID'),
      invoice_number: text(ubl.ID),
      issue_date: ubl.IssueDate,
      due_date: ubl.DueDate || get(ubl, 'PaymentMeans.PaymentDueDate'),
      po_number: text(get(ubl, 'OrderReference.ID')),
      vat_lines: subs.map((s) => ({
        rate: toNum(get(s, 'TaxCategory.Percent')),
        base: toNum(s.TaxableAmount),
        amount: toNum(s.TaxAmount),
      })),
      surcharge: 0,
      irpf,
      total: payable || r2(inclusive - irpf),
      verifactu_qr: false,
    };
  } else {
    inv = { source: 'XML (format not recognised)', vat_lines: [], total: 0 };
  }
}

// ---------- checks ----------
const reasons = [];
const tax_base = r2(inv.vat_lines.reduce((s, l) => s + l.base, 0));
const vat_amount = r2(inv.vat_lines.reduce((s, l) => s + l.amount, 0));
const surcharge = r2(inv.surcharge || 0);
const irpf = r2(inv.irpf || 0);
const total = r2(inv.total || 0);
const calculated_total = r2(tax_base + vat_amount + surcharge - irpf);
const totals_valid = total > 0 && Math.abs(calculated_total - total) <= TOTAL_TOLERANCE;
if (!totals_valid) reasons.push(`Totals do not add up: base ${tax_base} + VAT ${vat_amount} + surcharge ${surcharge} - IRPF ${irpf} = ${calculated_total} €, invoice says ${total} €`);

// each VAT line: amount = base x rate (±0.02 €)
inv.vat_lines.forEach((l) => {
  if (Math.abs(r2(l.base * l.rate / 100) - l.amount) > TOTAL_TOLERANCE) {
    reasons.push(`VAT line ${l.rate}% does not match: ${l.base} x ${l.rate}% ≠ ${l.amount} €`);
  }
});

const supplier = checkTaxId(inv.supplier_nif);
if (!supplier.valid) reasons.push(`Supplier tax ID: ${supplier.note} (${text(inv.supplier_nif) || 'empty'})`);

const ourNif = cleanId(OUR_NIF).replace(/^ES/, '');
const customerNif = cleanId(inv.customer_nif).replace(/^ES/, '');
const customer_nif_valid = customerNif === ourNif;
if (!customer_nif_valid) reasons.push(`Invoice is not addressed to our NIF (${ourNif}); found ${customerNif || 'none'}`);

const issue_date = isoDate(inv.issue_date);
if (!issue_date) reasons.push('Issue date missing or unreadable');
let due_date = isoDate(inv.due_date);
let due_date_estimated = false;
if (!due_date && issue_date) {
  const d = new Date(issue_date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + DEFAULT_PAYMENT_DAYS);
  due_date = d.toISOString().slice(0, 10);
  due_date_estimated = true;
}
if (!text(inv.invoice_number)) reasons.push('Invoice number missing');

const vat_rates = inv.vat_lines.map((l) => l.rate);

return {
  json: {
    messageId: src.messageId,
    emailFrom: src.emailFrom,
    emailSubject: src.emailSubject,
    fileName: src.fileName,
    source: inv.source,
    supplier_name: text(inv.supplier_name),
    supplier_nif: cleanId(inv.supplier_nif),
    supplier_nif_type: supplier.kind,
    supplier_nif_valid: supplier.valid,
    customer_nif: customerNif,
    customer_nif_valid,
    invoice_number: text(inv.invoice_number),
    issue_date,
    due_date,
    due_date_estimated,
    po_number: text(inv.po_number),
    tax_base,
    vat_rates: vat_rates.join(' / '),
    multi_vat: new Set(vat_rates).size > 1,
    vat_amount,
    surcharge,
    irpf_withholding: irpf,
    total,
    calculated_total,
    totals_valid,
    verifactu_qr_present: inv.verifactu_qr === true,
    check_reasons: reasons,
  },
};
