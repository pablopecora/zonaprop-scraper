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
  if (text == null) return null;
  const clean = String(text).replace(/\./g, '').replace(',', '.');
  const match = clean.match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function calcularUsdM2(precio, totales) {
  if (!precio || !totales || totales === 0) return null;
  return Math.round(precio / totales);
}

// Siempre trabaja desde la URL de página 1, sin importar qué URL pasó el usuario
function limpiarUrlBase(url) {
  return url.replace(/-pagina-\d+\.html$/, '.html');
}

function buildPageUrl(baseUrl, pageNum) {
  const base = limpiarUrlBase(baseUrl);
  if (pageNum === 1) return base;
  return base.replace(/\.html$/, `-pagina-${pageNum}.html`);
}

// ─── Esperar a que los cards del listado estén en el DOM ─────────────────────

async function esperarCards(page) {
  try {
    await page.waitForSelector('[data-qa="posting PROPERTY"]', { timeout: 15000 });
  } catch {
    // Si no aparecen en 15s, seguimos igual (puede ser página sin resultados)
  }
  await randomDelay(1000, 2000);
  // Scroll para forzar lazy-load
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
}

// ─── Scraping de detalle (pestaña separada) ──────────────────────────────────

async function scrapearDetalle(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Esperar que carguen las features (m², etc.)
    await page.waitForSelector('li.icon-feature', { timeout: 10000 }).catch(() => {});
    await sleep(800);

    const data = await page.evaluate(() => {

      function getNumeroByIcon(iconClass) {
        const icon = document.querySelector(`li.icon-feature i.${iconClass}`);
        if (!icon) return null;
        const li = icon.closest('li.icon-feature');
        if (!li) return null;
        // Recorrer text nodes buscando el primer número puro
        const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const txt = node.textContent.trim().replace(/\./g, '').replace(',', '.');
          if (/^\d+(\.\d+)?$/.test(txt)) return parseFloat(txt);
        }
        return null;
      }

      const m2Tot  = getNumeroByIcon('icon-stotal');
      const m2Cub  = getNumeroByIcon('icon-scubierta');
      const cochNum = getNumeroByIcon('icon-cochera');

      // Título
      const titulo =
        document.querySelector('h1.title-property')?.innerText.trim() ||
        document.querySelector('h2.title-type-sup-property')?.innerText.trim() ||
        null;

      // Precio
      const precioEl  = document.querySelector('.price-value');
      const precioRaw = precioEl ? precioEl.innerText.trim() : null;

      // Barrio
      const barrioEl =
        document.querySelector('h4.title-location-property') ||
        document.querySelector('.section-location-property h4') ||
        document.querySelector('h4[class*="location"]');
      const barrio = barrioEl ? barrioEl.innerText.trim() : null;

      // Expensas
      const expensasEl  = document.querySelector('[data-qa="expensas"]');
      const expensasRaw = expensasEl ? expensasEl.innerText.trim() : null;

      // Descripción completa
      const descEl     = document.querySelector('#longDescription');
      const descripcion = descEl ? descEl.innerText.replace(/\s+/g, ' ').trim() : null;

      // Baulera / cochera en texto libre
      const featText = (document.querySelector('#section-icon-features-property')?.innerText || '').toLowerCase();
      const descText = (descripcion || '').toLowerCase();
      const allText  = featText + ' ' + descText;
      const baulera  = allText.includes('baulera') || allText.includes('baúl');
      const cochera  = !!cochNum || allText.includes('cochera') || allText.includes('garage');

      // De pozo / entrega
      const devEl    = document.querySelector('[class*="developmentStage"]');
      const devText  = devEl ? devEl.innerText.trim() : null;
      const esPozo   = devText ? (devText.toLowerCase().includes('pozo') || devText.toLowerCase().includes('construcción')) : false;
      const entregaM = devText ? devText.match(/entrega[:\s·\-]+([^\n·]+)/i) : null;
      const entrega  = entregaM ? entregaM[1].trim() : null;

      // Amenities generales
      const amenityEls = document.querySelectorAll('[class*="generalFeaturesProperty"] [class*="description-text"]');
      const amenities  = Array.from(amenityEls).map(e => e.innerText.trim()).filter(Boolean);

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
  const cards = await page.evaluate(() => {
    // SOLO resultados reales — excluye "posting null" (Recomendaciones)
    const contenedores = Array.from(document.querySelectorAll(
      '[data-qa="posting PROPERTY"], [data-qa="posting DEVELOPMENT"]'
    ));

    return contenedores.map(card => {
      const txt = sel => card.querySelector(sel)?.innerText.trim() || null;

      // URL limpia sin params de tracking
      const dataTo = card.getAttribute('data-to-posting');
      let url = null;
      if (dataTo) {
        try {
          const u = new URL(dataTo.startsWith('http') ? dataTo : 'https://www.zonaprop.com.ar' + dataTo);
          url = u.origin + u.pathname;
        } catch { url = dataTo.split('?')[0]; }
      }
      if (!url) {
        const a = card.querySelector('[data-qa="POSTING_CARD_DESCRIPTION"] a');
        if (a) {
          try { url = new URL(a.href).origin + new URL(a.href).pathname; }
          catch { url = a.href?.split('?')[0]; }
        }
      }

      const precioRaw   = txt('[data-qa="POSTING_CARD_PRICE"]');
      const expensasRaw = txt('[data-qa="expensas"]');
      const direccion   = txt('[class*="location-address"]');
      const barrio      = txt('[data-qa="POSTING_CARD_LOCATION"]');

      // m² total del card (ej: "111 m² tot.")
      let m2TotCard = null;
      const featEl = card.querySelector('[data-qa="POSTING_CARD_FEATURES"]');
      if (featEl) {
        Array.from(featEl.querySelectorAll('span')).forEach(s => {
          const t = s.innerText.trim().toLowerCase();
          if (t.includes('m²') || t.includes('m2')) m2TotCard = s.innerText.trim();
        });
      }

      // De pozo
      const devEl    = card.querySelector('[class*="developmentStage"]');
      const devText  = devEl ? devEl.innerText.trim() : null;
      const esPozo   = devText ? devText.toLowerCase().includes('pozo') : false;
      const entregaM = devText ? devText.match(/entrega[:\s·\-]+([^\n·]+)/i) : null;
      const entrega  = entregaM ? entregaM[1].trim() : null;

      const cardText = (card.innerText || '').toLowerCase();
      const baulera  = cardText.includes('baul');
      const cochera  = cardText.includes('coch');

      return { url, precioRaw, expensasRaw, direccion, barrio, m2TotCard, esPozo, entrega, baulera, cochera };
    }).filter(c => c.url);
  });

  return cards;
}

// ─── Detectar total de páginas ────────────────────────────────────────────────

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
  const precioRaw = detalle?.precioRaw || card.precioRaw || '';
  const precioNum = extractNumber(precioRaw.replace(/\./g, '').replace(',', '.'));

  const m2Cub  = detalle?.m2Cub  ?? null;
  const m2Tot  = detalle?.m2Tot  ?? extractNumber(card.m2TotCard);
  const m2Desc = (m2Tot != null && m2Cub != null && m2Tot > m2Cub)
    ? Math.round((m2Tot - m2Cub) * 10) / 10
    : null;
  const usdM2 = calcularUsdM2(precioNum, m2Tot);

  const expensasRaw = card.expensasRaw || detalle?.expensasRaw || null;
  const expensasNum = extractNumber((expensasRaw || '').replace(/\./g, ''));

  const barrio  = detalle?.barrio  || card.barrio  || '';
  const nombre  = detalle?.titulo  || card.direccion || '';
  const esPozo  = card.esPozo  || detalle?.esPozo  || false;
  const entrega = card.entrega || detalle?.entrega || '';
  const cochera = card.cochera || detalle?.cochera || false;
  const baulera = card.baulera || detalle?.baulera || false;

  const amenities   = detalle?.amenities || [];
  const features    = amenities.join(', ');
  const descripcion = detalle?.descripcion || '';

  return {
    'Nombre / Dirección':      nombre,
    'URL':                     card.url,
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
    process.exit(1);
  }

  const inputUrl   = args[0];
  const sinDetalle = args.includes('--sin-detalle');
  const baseUrl    = limpiarUrlBase(inputUrl); // siempre empezar desde página 1

  console.log('🚀  ZonaProp Scraper iniciado');
  console.log(`🔗  URL base: ${baseUrl}`);
  if (sinDetalle) console.log('⚡  Modo rápido: sin entrar al detalle');

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

  const paginaListado = await context.newPage();

  console.log('\n📄  Cargando página 1...');
  await paginaListado.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await esperarCards(paginaListado);

  const totalPaginas = await detectarTotalPaginas(paginaListado);
  console.log(`📚  Total páginas: ${totalPaginas}`);

  const todasLasPropiedades = [];
  const urlsVistas = new Set();

  for (let pag = 1; pag <= totalPaginas; pag++) {
    const urlPag = buildPageUrl(baseUrl, pag);
    console.log(`\n📄  Página ${pag}/${totalPaginas}: ${urlPag}`);

    if (pag > 1) {
      await paginaListado.goto(urlPag, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await esperarCards(paginaListado);
    }

    const cards = await scrapearCards(paginaListado);
    console.log(`   ✅  ${cards.length} propiedades encontradas`);

    if (cards.length === 0) {
      console.log('   ⚠️  Sin resultados en esta página, saltando');
      continue;
    }

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];

      if (!card.url || urlsVistas.has(card.url)) {
        console.log(`   ⏭️  [${i + 1}/${cards.length}] Duplicado`);
        continue;
      }
      urlsVistas.add(card.url);
      console.log(`   🏠  [${i + 1}/${cards.length}] ${card.url}`);

      let detalle = null;
      if (!sinDetalle) {
        detalle = await scrapearDetalle(context, card.url);
        await randomDelay(600, 1200);
      }

      todasLasPropiedades.push(procesarPropiedad(card, detalle));
    }
  }

  await browser.close();

  console.log(`\n📊  Total propiedades: ${todasLasPropiedades.length}`);

  const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `zonaprop_${ts}.xlsx`;
  await exportToExcel(todasLasPropiedades, filename);
  console.log(`\n✅  Listo! Archivo: ${filename}`);
}

main().catch(err => {
  console.error('💥  Error fatal:', err);
  process.exit(1);
});
