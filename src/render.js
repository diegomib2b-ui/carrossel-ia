// Renderiza HTML -> PNG com um Chrome invisível (headless). Um navegador só, reaproveitado entre gerações.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { slideHTML } = require('./templates');

let browserPromise;
function browser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true
    }).then(b => { b.on('disconnected', () => { browserPromise = null; }); return b; })
      .catch(e => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

async function renderSlides(slides, opts, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await browser();
  const page = await b.newPage();
  await page.setViewport({ width: 1080, height: 1350 });
  const arquivos = [];
  try {
    for (let i = 0; i < slides.length; i++) {
      await page.setContent(slideHTML({ slide: slides[i], i, total: slides.length, ...opts }), { waitUntil: 'load' });
      const file = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      arquivos.push(path.basename(file));
    }
  } finally { await page.close(); }
  return arquivos;
}

module.exports = { renderSlides, browser };
