import { defineConfig } from 'vite'
import terser from '@rollup/plugin-terser'


const httpsConfig = false

export default defineConfig({
  server: {
    host: 'localhost',
    port: 3011,
    cors: true,
    https: httpsConfig, // Set to true or cert object if using HTTPS
    hmr: {
      host: 'localhost',
      protocol: 'ws', // Change to 'wss' if using HTTPS
    },
  },
  build: {
    minify: false, // We'll handle minification per output
    manifest: true,
    rollupOptions: {
      input: './src/main.js',
      output: [
        // Unminified version (for debugging)
        {
          format: 'umd',
          entryFileNames: 'main.js',
          esModule: false,
          compact: false,
          globals: {
            jquery: '$',
            gsap: 'gsap',
            three: 'THREE',
          },
        },
        // Minified version (for production)
        {
          format: 'umd',
          entryFileNames: 'main.min.js',
          esModule: false,
          compact: true,
          plugins: [
            terser({
              compress: {
                drop_console: false, // Set to true to remove console.logs
              },
            }),
          ],
          globals: {
            jquery: '$',
            gsap: 'gsap',
            three: 'THREE',
          },
        },
      ],
      // Externalize dependencies that should be loaded from CDN
      external: ['jquery', 'gsap', 'three'],
    },
  },
})
