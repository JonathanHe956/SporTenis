import fs from 'fs';
import path from 'path';

function walk(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walk(dirPath, callback) : callback(path.join(dir, f));
  });
}

walk('./src/pages', (filePath) => {
  if (filePath.endsWith('.astro')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // Integer inputs
    content = content.replace(/(<input[^>]*name="(?:stock|stock_minimo|cantidad|telefono)"[^>]*)(\/?>)/gi, (match, p1, p2) => {
      if (p1.includes('oninput')) return match;
      return `${p1} oninput="this.value = this.value.replace(/[^0-9]/g, '')" ${p2}`;
    });

    // Decimal inputs
    content = content.replace(/(<input[^>]*name="(?:costo|precio_venta|precio_base)"[^>]*)(\/?>)/gi, (match, p1, p2) => {
      if (p1.includes('oninput')) return match;
      return `${p1} oninput="this.value = this.value.replace(/[^0-9.]/g, '').replace(/(\\..*)\\./g, '$1')" ${p2}`;
    });

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Updated', filePath);
    }
  }
});
