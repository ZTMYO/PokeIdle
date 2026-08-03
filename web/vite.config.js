import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径打包，可部署到任意子目录
  base: './',
  build: {
    outDir: 'dist',
    // 大文件（安装包等）保持原样拷贝，不做内联
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5174,
    open: false,
  },
});
