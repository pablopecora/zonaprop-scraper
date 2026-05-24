const ExcelJS = require('exceljs');
const path = require('path');

const COLUMNS = [
  { header: 'Nombre / Dirección',    key: 'Nombre / Dirección',    width: 40 },
  { header: 'URL',                   key: 'URL',                   width: 60 },
  { header: 'Precio Publicado (USD)',key: 'Precio Publicado (USD)', width: 22 },
  { header: 'm² Cubiertos',          key: 'm² Cubiertos',           width: 14 },
  { header: 'm² Descubiertos',       key: 'm² Descubiertos',        width: 16 },
  { header: 'm² Totales',            key: 'm² Totales',             width: 13 },
  { header: 'USD/m² (calc)',         key: 'USD/m² (calc)',          width: 14 },
  { header: 'Barrio',               key: 'Barrio',                 width: 20 },
  { header: 'Expensas ($)',          key: 'Expensas ($)',           width: 14 },
  { header: 'Cochera',              key: 'Cochera',                width: 10 },
  { header: 'Baulera',              key: 'Baulera',                width: 10 },
  { header: 'Features',             key: 'Features',               width: 60 },
];

// Colores
const COLOR_HEADER_BG   = 'FF1A3C6E';  // azul oscuro
const COLOR_HEADER_FONT = 'FFFFFFFF';  // blanco
const COLOR_ROW_ALT     = 'FFF0F4FA';  // azul muy claro (filas alternas)
const COLOR_SI          = 'FF C8E6C9'.replace(/ /g,''); // verde claro
const COLOR_NO          = 'FFFCE4EC';  // rojo muy claro

async function exportToExcel(data, filename) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ZonaProp Scraper';
  wb.created = new Date();

  const ws = wb.addWorksheet('Propiedades', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // ── Columnas ────────────────────────────────────────────────────────────
  ws.columns = COLUMNS;

  // ── Header ──────────────────────────────────────────────────────────────
  const headerRow = ws.getRow(1);
  headerRow.height = 28;
  COLUMNS.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: COLOR_HEADER_FONT }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER_BG } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF0D47A1' } },
    };
  });

  // ── Filas de datos ───────────────────────────────────────────────────────
  data.forEach((prop, rowIdx) => {
    const row = ws.addRow(COLUMNS.map(c => prop[c.key] ?? ''));
    const isAlt = rowIdx % 2 === 1;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const colKey = COLUMNS[colNumber - 1].key;

      // Fondo alternado
      if (isAlt) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ROW_ALT } };
      }

      // Alineaciones y formatos por columna
      if (colKey === 'URL') {
        // URL como hipervínculo clicable
        const urlVal = prop['URL'];
        if (urlVal) {
          cell.value = { text: urlVal, hyperlink: urlVal };
          cell.font = { color: { argb: 'FF1565C0' }, underline: true, size: 10 };
        }
        cell.alignment = { vertical: 'middle', wrapText: false };
      } else if (colKey === 'Precio Publicado (USD)') {
        if (typeof prop[colKey] === 'number') {
          cell.numFmt = '"USD "#,##0';
        }
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (['m² Cubiertos', 'm² Descubiertos', 'm² Totales', 'USD/m² (calc)', 'Expensas ($)'].includes(colKey)) {
        if (typeof prop[colKey] === 'number') {
          cell.numFmt = colKey === 'Expensas ($)' ? '"$"#,##0' : '#,##0';
        }
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (colKey === 'Cochera' || colKey === 'Baulera') {
        const val = prop[colKey];
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (val === 'Sí') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_SI } };
          cell.font = { bold: true, color: { argb: 'FF1B5E20' } };
        } else if (val === 'No') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_NO } };
          cell.font = { color: { argb: 'FFB71C1C' } };
        }
      } else if (colKey === 'Features') {
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.font = { size: 9 };
      } else {
        cell.alignment = { vertical: 'middle', wrapText: false };
      }

      // Borde inferior suave en todas
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFCFD8DC' } },
      };
    });

    row.height = 20;
  });

  // ── Filtro automático en header ──────────────────────────────────────────
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: 1, column: COLUMNS.length },
  };

  // ── Segunda hoja: Notas / Metodología ───────────────────────────────────
  const wsInfo = wb.addWorksheet('Metodología');
  wsInfo.getColumn(1).width = 80;
  const info = [
    ['ZonaProp Scraper — Metodología de cálculo'],
    [''],
    ['m² Totales:'],
    ['  Si ZonaProp publica "m² tot." directamente, se usa ese valor.'],
    ['  Si no, se calcula: m² cub + (m² desc × 0.5)'],
    ['  El m² descubierto (balcón, terraza) se pondera al 50% según la'],
    ['  convención del mercado inmobiliario argentino.'],
    [''],
    ['USD/m²:'],
    ['  Precio publicado ÷ m² Totales (calculados según criterio arriba)'],
    [''],
    ['Cochera / Baulera:'],
    ['  Se detectan en las características y amenities de cada propiedad.'],
    ['  Sí = figura mencionada. No = no figura en el listing.'],
    [''],
    ['Expensas:'],
    ['  Se extrae el valor en $ ARS publicado en el listing de detalle.'],
    [''],
    [`Generado: ${new Date().toLocaleString('es-AR')}`],
  ];
  info.forEach((row, i) => {
    const r = wsInfo.addRow(row);
    if (i === 0) r.getCell(1).font = { bold: true, size: 13 };
  });

  // ── Guardar ──────────────────────────────────────────────────────────────
  const outPath = path.resolve(filename);
  await wb.xlsx.writeFile(outPath);
  console.log(`💾  Archivo guardado en: ${outPath}`);
}

module.exports = { exportToExcel };
