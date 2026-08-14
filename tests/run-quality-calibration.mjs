import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outputDirectory = path.join(root, '.test-build');
const outputFile = path.join(outputDirectory, 'qualityCalibration.test.mjs');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

try {
  await build({
    entryPoints: [path.join(root, 'tests/qualityCalibration.test.ts')],
    outfile: outputFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    tsconfig: path.join(root, 'tsconfig.app.json'),
    alias: { '@': path.join(root, 'src') },
    logLevel: 'warning',
  });
  await import(`${pathToFileURL(outputFile).href}?cacheBust=${Date.now()}`);
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
