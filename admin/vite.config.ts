import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  build: {
    rollupOptions: {
      external: (id) => {
        if (id.includes('server-auth')) return true;
        if (id === 'jsonwebtoken') return true;
        return false;
      }
    }
  },
  ssr: {
    noExternal: ['jsonwebtoken']
  }
});
