// Row for the "Review" sheet (column names must match the sheet headers)
const i = $('Match Purchase Order').item.json;
return {
  json: {
    'Submitted At': new Date().toISOString(),
    'Source': i.source,
    'File': i.fileName,
    'Email From': i.emailFrom,
    'Supplier Name': i.supplier_name,
    'Supplier NIF': i.supplier_nif,
    'Invoice Number': i.invoice_number,
    'Issue Date': i.issue_date,
    'Total': i.total,
    'PO Number (invoice)': i.po_number,
    'Review Reasons': i.review_reasons,
    'Notes': i.notes,
  },
};
