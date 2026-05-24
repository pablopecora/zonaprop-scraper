const { chromium } = require('playwright');
const { exportToExcel } = require('./exporter');

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay(min = 1500, max = 3500) {
  return sleep(Math.floor(Math.random() * (max - min) + min));
}

function extractNumber(text) {
  if (!text) return null;
  const clean = String(text).replace(/\./g, '').replace(/,/g, '.');
  const match = clean.match(/-?[\d]+\.?\d*/);
  return match ? parseFloat(match[0]) : null;
}

function calcularUsdM2(precio, totales) {
  if (!precio || !totales || totales === 0) return null;
  return Math.round(precio / totales);
}

// ─── Scraping de detalle (en pestaña separada) ───────────────────────────────

async function scrapearDetalle(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(800, 1500);

    const data = await page.evaluate(() => {

      // Recorre los text nodes de un <li> buscando el primer número puro
      function getNumeroByIcon(iconClass) {
        const icon = document.querySelector(`li.icon-feature i.${iconClass}`);
        if (!icon) return null;
        const li = icon.closest('li.icon-feature');
        if (!li) return null;
        const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const txt = node.textContent.trim().replace(/\./g, '').replace(',', '.');
          if (/^\d+(\.\d+)?$/.test(txt)) return parseFloat(txt);
        }
        return null;
      }

      const m2Tot = getNumeroByIcon('icon-stotal');    // 171
      const m2Cub = getNumeroByIcon('icon-scubierta'); // 152
      const cochNum = getNumeroByIcon('icon-cochera');

      // Título
      const titulo =
        document.querySelector('h1.title-property')?.innerText.trim() ||
        document.querySelector('h2.title-type-sup-property')?.innerText.trim() ||
        null;

      // Precio
      const precioEl = document.querySelector('.price-value');
      const precioRaw = precioEl ? precioEl.innerText.trim() : null;

      // Barrio: buscar en el h4 de localización de la ficha
      const barrioEl =
        document.querySelector('h4.title-location-property') ||
        document.querySelector('.section-location-property h4') ||
        document.querySelector('h4[class*="location"]');
      const barrio = barrioEl ? barrioEl.innerText.trim() : null;

      // Expensas
      const expensasEl = document.querySelector('[data-qa="expensas"]');
      const expensasRaw = expensasEl ? expensasEl.innerText.trim() : null;

      // Descripción
      const descEl = document.querySelector('#longDescription');
      const descripcion = descEl ? descEl.innerText.replace(/\s+/g, ' ').trim() : null;

      // Baulera / cochera en texto libre
      const featText = (document.querySelector('#section-icon-features-property')?.innerText || '').toLowerCase();
      const descText = (descripcion || '').toLowerCase();
      const allText  = featText + ' ' + descText;

      const baulera = allText.includes('baulera') || allText.includes('baúl');
      const cochera = !!cochNum || allText.includes('cochera') || allText.includes('garage');

      // De pozo / entrega
      const devEl = document.querySelector('[class*="developmentStage"]');
      const devText = devEl ? devEl.innerText.trim() : null;
      const esPozo = devText
        ? (devText.toLowerCase().includes('pozo') || devText.toLowerCase().includes('construcción'))
        : false;
      const entregaMatch = devText ? devText.match(/entrega[:\s·\-]+([^\n·]+)/i) : null;
      const entrega = entregaMatch ? entregaMatch[1].trim() : null;

      // Amenities generales
      const amenityEls = document.querySelectorAll('[class*="generalFeaturesProperty"] [class*="description-text"]');
      const amenities = Array.from(amenityEls).map(e => e.innerText.trim()).filter(Boolean);

      return { titulo, precioRaw, m2Tot, m2Cub, barrio, expensasRaw, descripcion, baulera, cochera, esPozo, entrega, amenities };
    });

    return data;
  } catch (err) {
    console.error(`  ⚠️  Error en detalle ${url}: ${err.message}`);
    return null;
  } finally {
    await page.close();
  }
}

// ─── Scraping de cards del listado ───────────────────────────────────────────

async function scrapearCards(page) {
  // Scroll para forzar lazy-load de todos los cards
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);

  const cards = await page.evaluate(() => {
    // SOLO resultados reales — excluye "posting null" (sección Recomendaciones)
    const contenedores = Array.from(document.querySelectorAll(
      '[data-qa="posting PROPERTY"], [data-qa="posting DEVELOPMENT"]'
    ));

    return contenedores.map(card => {
      const txt = sel => card.querySelector(sel)?.innerText.trim() || null;

      // URL limpia (sin tracking params)
      const dataTo = card.getAttribute('data-to-posting');
      let url = null;
      if (dataTo) {
        try {
          const u = new URL(dataTo.startsWith('http') ? dataTo : 'https://www.zonaprop.com.ar' + dataTo);
          url = u.origin + u.pathname;
        } catch(e) { url = dataTo.split('?')[0]; }
      }
      if (!url) {
        const linkEl = card.querySelector('[data-qa="POSTING_CARD_DESCRIPTION"] a');
        if (linkEl) {
          try { url = new URL(linkEl.href).origin + new URL(linkEl.href).pathname; }
          catch(e) { url = linkEl.href?.split('?')[0]; }
        }
      }

      // Precio y expensas — vienen en el card del listado
      const precioRaw    = txt('[data-qa="POSTING_CARD_PRICE"]');
      const expensasRaw  = txt('[data-qa="expensas"]');
      const direccion    = txt('[class*="location-address"]');
      const barrio       = txt('[data-qa="POSTING_CARD_LOCATION"]');

      // m² total del card (ej: "111 m² tot.")
      const featuresEl = card.querySelector('[data-qa="POSTING_CARD_FEATURES"]');
      let m2TotCard = null;
      if (featuresEl) {
        Array.from(featuresEl.querySelectorAll('span')).forEach(s => {
          const t = s.innerText.trim().toLowerCase();
          if (t.includes('m²') || t.includes('m2')) m2TotCard = s.innerText.trim();
        });
      }

      // De pozo
      const devEl = card.querySelector('[class*="developmentStage"]');
      const devText = devEl ? devEl.innerText.trim() : null;
      const esPozo = devText ? devText.toLowerCase().includes('pozo') : false;
      const entregaMatch = devText ? devText.match(/entrega[:\s·\-]+([^\n·]+)/i) : null;
      const entrega = entregaMatch ? entregaMatch[1].trim() : null;

      // Baulera / cochera en texto del card
      const cardText = (card.innerText || '').toLowerCase();
      const baulera = cardText.includes('baul') || cardText.includes('baulera');
      const cochera = cardText.includes('coch') || cardText.includes('cochera');

      return { url, precioRaw, expensasRaw, direccion, barrio, m2TotCard, esPozo, entrega, baulera, cochera };
    }).filter(c => c.url);
  });

  return cards;
}

// ─── Construir URL de página N ───────────────────────────────────────────────
// Patrón ZonaProp: insertar "-pagina-N" antes del ".html"
// Página 1: .../orden-precio-ascendente.html
// Página 2: .../orden-precio-ascendente-pagina-2.html

function buildPageUrl(baseUrl, pageNum) {
  if (pageNum === 1) return baseUrl;
  // Quitar cualquier -pagina-N previo y agregar el nuevo
  const clean = baseUrl.replace(/-pagina-\d+\.html$/, '.html');
  return clean.replace(/\.html$/, `-pagina-${pageNum}.html`);
}

// Detecta cuántas páginas hay en total
async function detectarTotalPaginas(page) {
  try {
    return await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[class*="paging-module__page-item"]'));
      const nums  = items.map(el => parseInt(el.innerText.trim())).filter(n => !isNaN(n) && n > 0);
      return nums.length > 0 ? Math.max(...nums) : 1;
    });
  } catch {
    return 1;
  }
}

// ─── Procesar una propiedad ──────────────────────────────────────────────────

function procesarPropiedad(card, detalle) {
  const url = card.url;

  // Precio — del detalle o del card
  const precioRaw = (detalle?.precioRaw) || card.precioRaw || '';
  const precioNum = extractNumber(precioRaw.replace(/\./g, '').replace(',', '.'));

  // m² — del detalle (números exactos) o del card (string "111 m² tot.")
  const m2Cub  = detalle?.m2Cub  ?? null;
  const m2Tot  = detalle?.m2Tot  ?? extractNumber(card.m2TotCard);
  const m2Desc = (m2Tot != null && m2Cub != null && m2Tot > m2Cub)
    ? Math.round((m2Tot - m2Cub) * 10) / 10
    : null;
  const usdM2 = calcularUsdM2(precioNum, m2Tot);

  // Expensas — del card del listado (más confiable) o del detalle
  const expensasRaw = card.expensasRaw || detalle?.expensasRaw || null;
  const expensasNum = extractNumber((expensasRaw || '').replace(/\./g, ''));

  // Barrio — del detalle o del card
  const barrio = detalle?.barrio || card.barrio || '';

  // Nombre / dirección
  const nombre = detalle?.titulo || card.direccion || '';

  // De pozo
  const esPozo  = card.esPozo  || detalle?.esPozo  || false;
  const entrega = card.entrega || detalle?.entrega || '';

  // Cochera y baulera
  const cochera = card.cochera || detalle?.cochera || false;
  const baulera = card.baulera || detalle?.baulera || false;

  // Features
  const amenities = detalle?.amenities || [];
  const features  = amenities.join(', ');

  // Descripción
  const descripcion = detalle?.descripcion || '';

  return {
    'Nombre / Dirección':      nombre,
    'URL':                     url,
    'Precio Publicado (USD)':  precioNum || precioRaw,
    'De Pozo':                 esPozo ? 'Sí' : 'No',
    'Fecha de Entrega':        esPozo ? entrega : '',
    'm² Cubiertos':            m2Cub,
    'm² Descubiertos':         m2Desc,
    'm² Totales':              m2Tot,
    'USD/m² (calc)':           usdM2,
    'Barrio':                  barrio,
    'Expensas ($)':            expensasNum || expensasRaw || '',
    'Cochera':                 cochera ? 'Sí' : 'No',
    'Baulera':                 baulera ? 'Sí' : 'No',
    'Features':                features,
    'Descripción ZonaProp':    descripcion,
  };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('❌  Uso: node scraper.js <URL_de_zonaprop> [--sin-detalle]');
    console.error('   Ejemplo:');
    console.error('   node scraper.js "https://www.zonaprop.com.ar/departamentos-venta-belgrano..."');
    console.error('');
    console.error('   --sin-detalle  Solo usa datos del listado (más rápido, menos datos)');
    process.exit(1);
  }

  const baseUrl    = args[0];
  const sinDetalle = args.includes('--sin-detalle');

  console.log('🚀  ZonaProp Scraper iniciado');
  console.log(`🔗  URL: ${baseUrl}`);
  if (sinDetalle) console.log('⚡  Modo rápido: sin entrar al detalle de cada propiedad');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
  });

  // Pestaña principal — queda SIEMPRE en el listado
  const paginaListado = await context.newPage();

  console.log('\n📄  Cargando listado...');
  await paginaListado.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await randomDelay(2000, 4000);

  const totalPaginas = await detectarTotalPaginas(paginaListado);
  console.log(`📚  Total páginas detectadas: ${totalPaginas}`);

  const todasLasPropiedades = [];
  const urlsVistas = new Set();

  for (let paginaActual = 1; paginaActual <= totalPaginas; paginaActual++) {
    const urlPagina = buildPageUrl(baseUrl, paginaActual);
    console.log(`\n📄  Página ${paginaActual}/${totalPaginas}: ${urlPagina}`);

    if (paginaActual > 1) {
      await paginaListado.goto(urlPagina, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await randomDelay(2000, 4000);
    }

    const cards = await scrapearCards(paginaListado);
    console.log(`   ✅  ${cards.length} propiedades en esta página`);

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];

      if (!card.url || urlsVistas.has(card.url)) {
        console.log(`   ⏭️  [${i + 1}/${cards.length}] Duplicado, saltando`);
        continue;
      }
      urlsVistas.add(card.url);

      console.log(`   🏠  [${i + 1}/${cards.length}] ${card.url}`);

      let detalle = null;
      if (!sinDetalle) {
        // Abre el detalle en una pestaña nueva — el listado no se toca
        detalle = await scrapearDetalle(context, card.url);
        await randomDelay(800, 1500);
      }

      todasLasPropiedades.push(procesarPropiedad(card, detalle));
    }
  }

  await browser.close();

  console.log(`\n📊  Total propiedades: ${todasLasPropiedades.length}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename  = `zonaprop_${timestamp}.xlsx`;
  await exportToExcel(todasLasPropiedades, filename);

  console.log(`\n✅  Listo! Archivo: ${filename}`);
}

main().catch(err => {
  console.error('💥  Error fatal:', err);
  process.exit(1);
});
