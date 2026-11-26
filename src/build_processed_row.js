// Row for the "Processed Invoices" sheet (column names must match the sheet headers)
const i = $input.item.json;
return {
  json: {
    'Processed At': new Date().toISOString(),
    'Source': i.source,
    'File': i.fileName,
    'Supplier Name': i.supplier_name,
    'Supplier NIF': i.supplier_nif,
    'Invoice Number': i.invoice_number,
    'Issue Date': i.issue_date,
    'Due Date': i.due_date,
    'Due Date Estimated': i.due_date_estimated ? 'Yes' : 'No',
    'Tax Base': i.tax_base,
    'VAT Rates': i.vat_rates,
    'VAT Amount': i.vat_amount,
    'Equivalence Surcharge': i.surcharge,
    'IRPF Withholding': i.irpf_withholding,
    'Total': i.total,
    'PO Number': i.po_number_matched,
    'PO Amount': i.po_amount,
    'PO Lookup': i.po_lookup_method,
    'Notes': i.notes,
  },
};
