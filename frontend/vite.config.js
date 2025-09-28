import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: {
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
  },
  server: {
    port: 5173,
    host: true
  }
});
