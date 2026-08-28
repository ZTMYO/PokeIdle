import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // 相对路径打包，可部署到任意子目录
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        tutorial: fileURLToPath(new URL('./tutorial.html', import.meta.url)),
        changelog: fileURLToPath(new URL('./changelog.html', import.meta.url)),
        pokedex: fileURLToPath(new URL('./pokedex.html', import.meta.url)),
      },
    },
    // 大文件（安装包等）保持原样拷贝，不做内联
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5174,
    open: false,
  },
});