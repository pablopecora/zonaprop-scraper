# 🏠 ZonaProp Scraper

Extrae datos de propiedades de [ZonaProp](https://www.zonaprop.com.ar) y los guarda en un archivo Excel listo para abrir en Google Sheets.

---

## 📋 ¿Qué datos extrae?

| Campo | Descripción |
|---|---|
| **Nombre / Dirección** | Título del listing |
| **URL** | Link directo a la propiedad en ZonaProp (clickeable en Excel) |
| **Precio Publicado (USD)** | Precio en dólares |
| **m² Cubiertos** | Metros cubiertos (ej: 130) |
| **m² Descubiertos** | Metros descubiertos — balcón, terraza (ej: 53) |
| **m² Totales** | Publicados por ZonaProp, o calculados (ver metodología) |
| **USD/m² (calc)** | Precio ÷ m² Totales |
| **Barrio** | Barrio de la propiedad |
| **Expensas ($)** | Expensas en pesos ARS |
| **Cochera** | Sí / No |
| **Baulera** | Sí / No |
| **Features** | Características: Balcón, Terraza, SUM, Laundry, Pileta, etc. |

---

## ⚙️ Instalación (primera vez)

### 1. Verificar que tenés Node.js ≥ 18

Abrí una terminal y ejecutá:
```bash
node --version
```
Debería mostrar algo como `v20.x.x`. Si no tenés Node, descargalo de [nodejs.org](https://nodejs.org).

### 2. Clonar o descargar el proyecto

**Opción A — Clonar con Git:**
```bash
git clone https://github.com/TU_USUARIO/zonaprop-scraper.git
cd zonaprop-scraper
```

**Opción B — Descargar ZIP:**
Hacé click en el botón verde "Code" → "Download ZIP", descomprimilo y entrá a la carpeta.

### 3. Instalar dependencias

Dentro de la carpeta del proyecto:
```bash
npm install
```
Esto instala Playwright y ExcelJS. Puede tardar 1-2 minutos la primera vez.

### 4. Instalar el browser de Playwright

```bash
npx playwright install chromium
```
Esto descarga el browser que usa el scraper. Solo se hace una vez.

---

## 🚀 Uso

### Uso básico

```bash
node scraper.js "URL_DE_ZONAPROP"
```

**Ejemplo:**
```bash
node scraper.js "https://www.zonaprop.com.ar/departamentos-venta-belgrano-r-belgrano-con-balcon-3-habitaciones-mas-de-4-ambientes-100-160-m2-cubiertos-orden-precio-ascendente.html"
```

### Modo rápido (sin entrar al detalle de cada propiedad)

Si querés solo los datos del listado (más rápido, menos datos):
```bash
node scraper.js "URL_DE_ZONAPROP" --sin-detalle
```

### Usando los scripts de npm

```bash
# Modo completo
npm run scrape -- "https://www.zonaprop.com.ar/..."

# Modo rápido
npm run scrape:rapido -- "https://www.zonaprop.com.ar/..."
```

---

## 📂 Output

El archivo Excel se guarda en la misma carpeta del proyecto con el nombre:
```
zonaprop_2024-01-15T14-30-00.xlsx
```

Para abrirlo en **Google Sheets**:
1. Abrí [Google Sheets](https://sheets.google.com)
2. Archivo → Importar → Subir → seleccioná el `.xlsx`
3. Listo — todas las columnas, formatos y links quedan

---

## 🔍 Cómo se comporta el scraper

- **Abre Chrome visible** (no en modo oculto) para evitar bloqueos de ZonaProp
- Recorre **todas las páginas** del resultado automáticamente
- Entra a **cada propiedad** para extraer datos completos
- Espera tiempos aleatorios entre requests para no sobrecargar el servidor
- Muestra el progreso en la terminal

---

## 📐 Metodología de cálculo

### m² Totales
- Si ZonaProp publica `m² tot.` directamente → se usa ese valor
- Si no: `m² Totales = m² Cubiertos + (m² Descubiertos × 0.5)`
- Los m² descubiertos (balcón, terraza) se ponderan al **50%**, que es la convención estándar del mercado inmobiliario argentino.

### USD/m²
```
USD/m² = Precio publicado ÷ m² Totales
```

### Cochera y Baulera
Se detectan en las características de cada propiedad. Figura "Sí" si están mencionadas en el listing.

---

## ❓ Preguntas frecuentes

**¿Por qué se abre el browser visible?**
ZonaProp bloquea los scrapers en modo headless (browser invisible). Al abrirlo visible, el sitio lo trata como un usuario normal.

**¿Cuánto tarda?**
Depende de la cantidad de propiedades. Aprox. 3-5 segundos por propiedad (incluyendo la página de detalle). Para 50 propiedades, unos 3-4 minutos.

**¿Puedo dejar correr el scraper sin mirar?**
Sí. La terminal muestra el progreso. Cuando termina imprime `✅ Listo!` y el nombre del archivo.

**ZonaProp me bloquea / muestra captcha**
Si ves un captcha en el browser que se abre, resolvelo manualmente. El scraper esperará y continuará solo.

**¿Cómo filtro solo por un barrio específico?**
Armá la búsqueda directamente en ZonaProp con todos los filtros que quieras (barrio, precio, m², etc.) y copiá esa URL. El scraper respeta todos esos filtros.

---

## 🛠 Estructura del proyecto

```
zonaprop-scraper/
├── scraper.js      ← Lógica principal: Playwright, navegación, extracción
├── exporter.js     ← Genera el Excel con formato
├── package.json    ← Dependencias
├── .gitignore      ← Excluye node_modules y archivos generados
└── README.md       ← Este archivo
```

---

## 📦 Dependencias

| Paquete | Versión | Para qué |
|---|---|---|
| [playwright](https://playwright.dev) | ^1.44 | Controla Chrome para scraping |
| [exceljs](https://github.com/exceljs/exceljs) | ^4.4 | Genera archivos .xlsx |

---

## 📝 Licencia

MIT — libre para uso personal y comercial.
