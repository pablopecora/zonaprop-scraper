const { chromium } = require('playwright');
const { exportToExcel } = require('./exporter');

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay(min = 1500, max = 3500) {
  return sleep(Math.floor(Math.random() * (max - min) + min));
}

/**
 * Extrae un número de un string. Ej: "130 m² cub." → 130
 */
function extractNumber(text) {
  if (!text) return null;
  const match = text.replace(/\./g, '').match(/[\d,]+/);
  if (!match) return null;
  return parseFloat(match[0].replace(',', '.'));
}

/**
 * Calcula m² totales y USD/m²
 * Criterio: m² tot = cub + desc*0.5  (m² descubierto vale 50% del cubierto)
 * Si no hay descubiertos, m² tot = cub
 * Si zonaprop publica m² tot directamente, se usa ese valor.
 */
function calcularMetros(cub, desc, totPublicado) {
  const cubiertos  = cub  || 0;
  const descubiertos = desc || 0;

  let totales;
  if (totPublicado) {
    totales = totPublicado;
  } else if (cubiertos > 0) {
    totales = cubiertos + descubiertos * 0.5;
  } else {
    totales = null;
  }
  return totales;
}

function calcularUsdM2(precio, totales) {
  if (!precio || !totales || totales === 0) return null;
  return Math.round(precio / totales);
}

// ─── Scraping de una sola propiedad (página de detalle) ─────────────────────

async function scrapearDetalle(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(800, 1800);

    const data = await page.evaluate(() => {
      const txt = (sel, root = document) => {
        const el = root.querySelector(sel);
        return el ? el.innerText.trim() : null;
      };
      const txtAll = (sel, root = document) =>
        Array.from(root.querySelectorAll(sel)).map(e => e.innerText.trim()).filter(Boolean);

      // ── Dirección / Nombre ───────────────────────────────────────────────
      const nombre =
        txt('h1.title-type-sup-property') ||
        txt('h2.title-location') ||
        txt('[class*="title"]') ||
        txt('h1') ||
        null;

      // ── Precio ──────────────────────────────────────────────────────────
      const precioRaw =
        txt('[class*="price-value"]') ||
        txt('.price') ||
        txt('[class*="Price"]') ||
        null;

      // ── Superficie ──────────────────────────────────────────────────────
      // ZonaProp muestra algo como "130 m² cub." / "53 m² desc." / "183 m² tot."
      const features = txtAll('[class*="icon-feature"] span, [class*="feature"] li, .section-icon-feature-property span');
      let m2Cub = null, m2Desc = null, m2Tot = null;
      features.forEach(f => {
        const lower = f.toLowerCase();
        if (lower.includes('cub')) m2Cub = f;
        else if (lower.includes('desc')) m2Desc = f;
        else if (lower.includes('tot')) m2Tot = f;
      });

      // ── Barrio ──────────────────────────────────────────────────────────
      const barrio =
        txt('[class*="location-main"]') ||
        txt('.barrio') ||
        null;

      // ── Expensas ────────────────────────────────────────────────────────
      const expensasRaw =
        txt('[class*="expenses"]') ||
        txt('[class*="expensas"]') ||
        (() => {
          const all = txtAll('li, p, span');
          const found = all.find(t => t.toLowerCase().includes('expensas') || t.toLowerCase().includes('expense'));
          return found || null;
        })();

      // ── Features / características ──────────────────────────────────────
      const amenities = txtAll(
        '[class*="amenity"], [class*="feature-name"], [class*="tag"], ' +
        '.section-amenities li, [class*="Amenities"] li, [class*="amenities"] li, ' +
        '[class*="characteristics"] li, [class*="Characteristic"] li'
      );

      // ── Cochera y Baulera (de features generales) ────────────────────────
      const allText = [...features, ...amenities].map(t => t.toLowerCase());
      const cochera = allText.some(t => t.includes('cochera') || t.includes('garage') || t.includes('garaje'));
      const baulera = allText.some(t => t.includes('baulera') || t.includes('bóveda') || t.includes('storage'));

      return {
        nombre,
        precioRaw,
        m2CubRaw: m2Cub,
        m2DescRaw: m2Desc,
        m2TotRaw: m2Tot,
        barrio,
        expensasRaw,
        amenities,
        cochera,
        baulera,
      };
    });

    return data;
  } catch (err) {
    console.error(`  ⚠️  Error scrapeando detalle ${url}: ${err.message}`);
    return null;
  }
}

// ─── Scraping del listado (una página) ──────────────────────────────────────

async function scrapearPagina(page) {
  await randomDelay(1000, 2500);

  const props = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(
      '[class*="posting-card"], [class*="PostingCard"], [data-posting-id], article[class*="posting"]'
    ));

    return cards.map(card => {
      const txt = (sel) => {
        const el = card.querySelector(sel);
        return el ? el.innerText.trim() : null;
      };

      // URL
      const linkEl = card.querySelector('a[href*="/propiedades/"], a[href*="zonaprop"]') || card.querySelector('a');
      const href = linkEl ? linkEl.getAttribute('href') : null;
      const url = href
        ? (href.startsWith('http') ? href : 'https://www.zonaprop.com.ar' + href)
        : null;

      // Precio publicado
      const precio =
        txt('[class*="price-value"]') ||
        txt('.price') ||
        txt('[class*="Price"]') ||
        null;

      // Dirección
      const nombre =
        txt('[class*="address"], [class*="location"], [class*="title"]') ||
        txt('h2') || txt('h3') ||
        null;

      // Barrio desde el card
      const barrio =
        txt('[class*="location-main"]') ||
        txt('[class*="Neighborhood"]') ||
        null;

      // Superficies desde el card (a veces ya vienen en el listado)
      const features = Array.from(card.querySelectorAll('[class*="icon-feature"] span, [class*="feature"] li'))
        .map(e => e.innerText.trim());
      let m2CubRaw = null, m2DescRaw = null, m2TotRaw = null;
      features.forEach(f => {
        const lower = f.toLowerCase();
        if (lower.includes('cub')) m2CubRaw = f;
        else if (lower.includes('desc')) m2DescRaw = f;
        else if (lower.includes('tot')) m2TotRaw = f;
      });

      return { url, precio, nombre, barrio, m2CubRaw, m2DescRaw, m2TotRaw };
    }).filter(p => p.url);
  });

  return props;
}

// ─── Detectar total de páginas ───────────────────────────────────────────────

async function detectarTotalPaginas(page) {
  try {
    const total = await page.evaluate(() => {
      // Busca el último número en la paginación
      const paginationItems = Array.from(document.querySelectorAll(
        '[class*="pagination"] a, [class*="Pagination"] a, nav a[href*="pagina"]'
      ));
      const nums = paginationItems
        .map(a => parseInt(a.innerText.trim()))
        .filter(n => !isNaN(n));
      return nums.length > 0 ? Math.max(...nums) : 1;
    });
    return total;
  } catch {
    return 1;
  }
}

// ─── Construir URL de página N ───────────────────────────────────────────────

function buildPageUrl(baseUrl, pageNum) {
  if (pageNum === 1) return baseUrl;

  // ZonaProp usa "-pagina-N" antes de ".html"
  const cleanUrl = baseUrl.replace(/-pagina-\d+\.html/, '.html').replace(/\.html$/, '');
  return `${cleanUrl}-pagina-${pageNum}.html`;
}

// ─── Procesar una propiedad: combinar datos de card + detalle ────────────────

function procesarPropiedad(cardData, detalleData, url) {
  const fuente = detalleData || cardData;

  // Precio
  const precioRaw = fuente.precioRaw || cardData.precio || '';
  const esDolar = precioRaw.toLowerCase().includes('u') || precioRaw.includes('$') && precioRaw.toLowerCase().includes('usd');
  // Extraemos número
  const precioNum = extractNumber(precioRaw);

  // m²
  const m2CubRaw  = (detalleData && detalleData.m2CubRaw)  || cardData.m2CubRaw  || null;
  const m2DescRaw = (detalleData && detalleData.m2DescRaw) || cardData.m2DescRaw || null;
  const m2TotRaw  = (detalleData && detalleData.m2TotRaw)  || cardData.m2TotRaw  || null;

  const m2Cub  = extractNumber(m2CubRaw);
  const m2Desc = extractNumber(m2DescRaw);
  const m2Tot  = extractNumber(m2TotRaw);

  const m2Totales = calcularMetros(m2Cub, m2Desc, m2Tot);
  const usdM2     = calcularUsdM2(precioNum, m2Totales);

  // Expensas
  const expensasRaw = detalleData ? detalleData.expensasRaw : null;
  const expensasNum = extractNumber(expensasRaw);

  // Amenities
  const amenities = detalleData ? (detalleData.amenities || []) : [];
  const featuresStr = amenities.filter(a => {
    const l = a.toLowerCase();
    return !l.includes('cochera') && !l.includes('baulera') && !l.includes('garage');
  }).join(', ');

  const cochera = detalleData ? detalleData.cochera : false;
  const baulera = detalleData ? detalleData.baulera : false;

  return {
    'Nombre / Dirección': fuente.nombre || cardData.nombre || '',
    'URL': url,
    'Precio Publicado (USD)': precioNum || precioRaw,
    'm² Cubiertos': m2Cub,
    'm² Descubiertos': m2Desc,
    'm² Totales': m2Tot || (m2Cub ? m2Totales : null),
    'USD/m² (calc)': usdM2,
    'Barrio': (detalleData && detalleData.barrio) || cardData.barrio || '',
    'Expensas ($)': expensasNum || expensasRaw || '',
    'Cochera': cochera ? 'Sí' : 'No',
    'Baulera': baulera ? 'Sí' : 'No',
    'Features': featuresStr,
  };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('❌  Uso: node scraper.js <URL_de_zonaprop> [--sin-detalle]');
    console.error('   Ejemplo:');
    console.error('   node scraper.js "https://www.zonaprop.com.ar/departamentos-venta-belgrano-r..."');
    console.error('');
    console.error('   --sin-detalle  Solo extrae datos del listado (más rápido, menos datos)');
    process.exit(1);
  }

  const baseUrl = args[0];
  const sinDetalle = args.includes('--sin-detalle');

  console.log('🚀  Iniciando ZonaProp Scraper...');
  console.log(`🔗  URL base: ${baseUrl}`);
  if (sinDetalle) console.log('⚡  Modo rápido: sin entrar al detalle de cada propiedad');

  const browser = await chromium.launch({
    headless: false,  // false = browser visible (ayuda a evitar bloqueos)
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
  });

  const page = await context.newPage();

  // Ir a la primera página
  console.log('\n📄  Cargando página 1...');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await randomDelay(2000, 4000);

  // Detectar cuántas páginas hay
  const totalPaginas = await detectarTotalPaginas(page);
  console.log(`📚  Total de páginas detectadas: ${totalPaginas}`);

  const todasLasPropiedades = [];

  for (let pagNum = 1; pagNum <= totalPaginas; pagNum++) {
    if (pagNum > 1) {
      const urlPag = buildPageUrl(baseUrl, pagNum);
      console.log(`\n📄  Cargando página ${pagNum}/${totalPaginas}: ${urlPag}`);
      await page.goto(urlPag, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await randomDelay(2000, 4000);
    }

    const cards = await scrapearPagina(page);
    console.log(`   ✅  ${cards.length} propiedades encontradas en página ${pagNum}`);

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      console.log(`   🏠  [${i + 1}/${cards.length}] ${card.url}`);

      let detalle = null;
      if (!sinDetalle && card.url) {
        detalle = await scrapearDetalle(page, card.url);
        // Volver al listado
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await randomDelay(1000, 2000);
      }

      const prop = procesarPropiedad(card, detalle, card.url);
      todasLasPropiedades.push(prop);
    }
  }

  await browser.close();

  console.log(`\n📊  Total propiedades recolectadas: ${todasLasPropiedades.length}`);

  // Exportar
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `zonaprop_${timestamp}.xlsx`;
  await exportToExcel(todasLasPropiedades, filename);

  console.log(`\n✅  Listo! Archivo generado: ${filename}`);
}

main().catch(err => {
  console.error('💥  Error fatal:', err);
  process.exit(1);
});
