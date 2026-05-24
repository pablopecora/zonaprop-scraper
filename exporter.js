const ExcelJS = require('exceljs');
const path    = require('path');

const COLUMNS = [
  { header: 'Nombre / Dirección',     key: 'Nombre / Dirección',     width: 38 },
  { header: 'URL',                    key: 'URL',                    width: 55 },
  { header: 'Precio Publicado (USD)', key: 'Precio Publicado (USD)', width: 22 },
  { header: 'De Pozo',               key: 'De Pozo',                width: 10 },
  { header: 'Fecha de Entrega',      key: 'Fecha de Entrega',       width: 18 },
  { header: 'm² Cubiertos',          key: 'm² Cubiertos',           width: 14 },
  { header: 'm² Descubiertos',       key: 'm² Descubiertos',        width: 16 },
  { header: 'm² Totales',            key: 'm² Totales',             width: 13 },
  { header: 'USD/m² (calc)',         key: 'USD/m² (calc)',          width: 14 },
  { header: 'Barrio',               key: 'Barrio',                  width: 20 },
  { header: 'Expensas ($)',          key: 'Expensas ($)',            width: 15 },
  { header: 'Cochera',              key: 'Cochera',                 width: 10 },
  { header: 'Baulera',              key: 'Baulera',                 width: 10 },
  { header: 'Features',             key: 'Features',                width: 50 },
  { header: 'Descripción ZonaProp', key: 'Descripción ZonaProp',   width: 80 },
];

const C_HEADER_BG    = 'FF1A3C6E';
const C_HEADER_FONT  = 'FFFFFFFF';
const C_ROW_ALT      = 'FFF0F4FA';
const C_SI_GREEN     = 'FFC8E6C9';
const C_NO_RED       = 'FFFCE4EC';
const C_POZO_YELLOW  = 'FFFFF9C4';

async function exportToExcel(data, filename) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ZonaProp Scraper';
  wb.created = new Date();

  const ws = wb.addWorksheet('Propiedades', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = COLUMNS;

  // ── Header ────────────────────────────────────────────────────────────────
  const hRow = ws.getRow(1);
  hRow.height = 30;
  COLUMNS.forEach((col, idx) => {
    const cell = hRow.getCell(idx + 1);
    cell.value     = col.header;
    cell.font      = { bold: true, color: { argb: C_HEADER_FONT }, size: 11 };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HEADER_BG } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border    = { bottom: { style: 'medium', color: { argb: 'FF0D47A1' } } };
  });

  // ── Filas de datos ────────────────────────────────────────────────────────
  data.forEach((prop, rowIdx) => {
    const row   = ws.addRow(COLUMNS.map(c => prop[c.key] ?? ''));
    const isAlt = rowIdx % 2 === 1;

    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const key = COLUMNS[colNum - 1].key;

      if (isAlt) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_ROW_ALT } };
      }

      if (key === 'URL') {
        const v = prop['URL'];
        if (v) {
          cell.value = { text: v, hyperlink: v };
          cell.font  = { color: { argb: 'FF1565C0' }, underline: true, size: 10 };
        }
        cell.alignment = { vertical: 'middle', wrapText: false };

      } else if (key === 'Precio Publicado (USD)') {
        if (typeof prop[key] === 'number') cell.numFmt = '"USD "#,##0';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };

      } else if (['m² Cubiertos','m² Descubiertos','m² Totales','USD/m² (calc)'].includes(key)) {
        if (typeof prop[key] === 'number') cell.numFmt = '#,##0';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };

      } else if (key === 'Expensas ($)') {
        if (typeof prop[key] === 'number') cell.numFmt = '"$"#,##0';
        else cell.numFmt = '@'; // texto
        cell.alignment = { vertical: 'middle', horizontal: 'right' };

      } else if (key === 'Cochera' || key === 'Baulera') {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (prop[key] === 'Sí') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_SI_GREEN } };
          cell.font = { bold: true, color: { argb: 'FF1B5E20' } };
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_NO_RED } };
          cell.font = { color: { argb: 'FFB71C1C' } };
        }

      } else if (key === 'De Pozo') {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (prop[key] === 'Sí') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_POZO_YELLOW } };
          cell.font = { bold: true, color: { argb: 'FFF57F17' } };
        }

      } else if (key === 'Descripción ZonaProp') {
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.font = { size: 9 };

      } else if (key === 'Features') {
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.font = { size: 9 };

      } else {
        cell.alignment = { vertical: 'middle', wrapText: false };
      }

      cell.border = { bottom: { style: 'hair', color: { argb: 'FFCFD8DC' } } };
    });

    row.height = 22;
  });

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: 1, column: COLUMNS.length },
  };

  // ── Hoja metodología ──────────────────────────────────────────────────────
  const wsInfo = wb.addWorksheet('Metodología');
  wsInfo.getColumn(1).width = 80;
  [
    ['ZonaProp Scraper — Metodología'],
    [''],
    ['m² Cubiertos / Totales:'],
    ['  Extraídos directamente de los íconos icon-scubierta / icon-stotal en la ficha.'],
    [''],
    ['m² Descubiertos:'],
    ['  Calculado como: m² Totales - m² Cubiertos.'],
    [''],
    ['USD/m²:'],
    ['  Precio publicado ÷ m² Totales.'],
    [''],
    ['Cochera / Baulera:'],
    ['  Detectados en features del listado y en la descripción de la ficha.'],
    [''],
    ['De Pozo / Entrega:'],
    ['  Detectado desde el badge de etapa del card (En Pozo, En Construcción...).'],
    [''],
    ['Expensas:'],
    ['  Extraídas del card del listado (data-qa="expensas").'],
    [''],
    [`Generado: ${new Date().toLocaleString('es-AR')}`],
  ].forEach((r, i) => {
    const row = wsInfo.addRow(r);
    if (i === 0) row.getCell(1).font = { bold: true, size: 13 };
  });

  const outPath = path.resolve(filename);
  await wb.xlsx.writeFile(outPath);
  console.log(`💾  Guardado en: ${outPath}`);
}

module.exports = { exportToExcel };
