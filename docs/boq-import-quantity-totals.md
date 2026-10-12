# BOQ import: quantity totals

A synthetic XLSX reproduces a summary row with a description (`Total carried to summary` or `المجموع`),
no unit, quantity 25 and amount 500. Before this fix, the extractor treated the summary as an item:
two priced items totalling 500 plus the summary produced package amount 1000 and lost the stated-total check.

Recognise the existing total labels on rows without a unit before classifying numeric quantities as items.
The source values and cell provenance stay unchanged. A real item with a unit and `Total` in its description
continues to be an item. The shared classifier also serves PDF text extraction.

`test_excel_quantity_total_is_not_a_procurement_item` generates the workbook in memory, uploads it through
the project API, waits for the real reader, lays out the sheet and places the extracted items in a package.
It checks package amount 500 and zero difference against the stated total for both languages. It also checks
repeated English/Arabic headers, an incomplete row, Arabic digits, and an invalid quantity retained as text
on a rate-only item. No customer data or provider calls are used.

Boundary: totals with a unit still follow the existing item classification; this change does not invent a
new heuristic for them. Invalid quantities are retained as text with no parsed quantity, as before.
No UI, identity, installer, authentication, or release changes. Windows installation is outside this check.
