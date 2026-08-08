import { resolve } from 'node:path'
import { defineConfig } from 'tsup'

// Builds the design-system component library (used by /design-sync). The app
// itself imports these from '@/components/ui' directly; this is the packaged
// surface: one ESM entry + a bundled .d.ts, with React kept external.
export default defineConfig({
  entry: { index: 'src/renderer/src/components/ui/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  treeshake: true,
  tsconfig: 'tsconfig.build.json',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  esbuildOptions(options) {
    options.alias = { '@': resolve(import.meta.dirname, 'src/renderer/src') }
  },
})
