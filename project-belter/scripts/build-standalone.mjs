import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const distRoot = resolve(projectRoot, 'dist');
const spriteRoot = resolve(projectRoot, 'public/assets/sprites');
const outputPath = resolve(distRoot, 'project-belter-vertical-slice-standalone.html');
const rootOutputPath = resolve(projectRoot, 'project-belter-vertical-slice-standalone.html');

const indexHtml = await readFile(resolve(distRoot, 'index.html'), 'utf8');
const scriptMatch = indexHtml.match(/<script[^>]+src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/);
const styleMatch = indexHtml.match(/<link[^>]+href="\.\/(assets\/[^"]+\.css)"[^>]*>/);

if (scriptMatch?.[1] === undefined || styleMatch?.[1] === undefined) {
  throw new Error('Could not locate built JavaScript and CSS assets. Run npm run build first.');
}

const filenames = (await readdir(spriteRoot)).filter((filename) => filename.endsWith('.png'));
const assetData = Object.fromEntries(await Promise.all(filenames.map(async (filename) => {
  const bytes = await readFile(resolve(spriteRoot, filename));
  return [
    `./assets/sprites/${filename}`,
    `data:image/png;base64,${bytes.toString('base64')}`,
  ];
})));

const script = (await readFile(resolve(distRoot, scriptMatch[1]), 'utf8'))
  .replaceAll('</script>', '<\\/script>');
const styles = await readFile(resolve(distRoot, styleMatch[1]), 'utf8');
const assetBootstrap = `<script>window.__BELTER_ASSET_DATA__=${JSON.stringify(assetData)};</script>`;
const standalone = indexHtml
  .replace('<head>', `<head>${assetBootstrap}`)
  .replace(scriptMatch[0], `<script type="module">${script}</script>`)
  .replace(styleMatch[0], `<style>${styles}</style>`);

await writeFile(outputPath, standalone);
await writeFile(rootOutputPath, standalone);
console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${rootOutputPath}`);
