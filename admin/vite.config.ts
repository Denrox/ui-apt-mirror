import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import commonjs from 'vite-plugin-commonjs';

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths(), commonjs()],
  /**
  build: {
    rollupOptions: {
      external: (id) => {
        if (id.includes('server-auth')) return true;
        if (id === 'jsonwebtoken' || id === 'bcrypt') return true;
        return false;
      }
    }
  },
  ssr: {
    noExternal: ['bcrypt', 'jsonwebtoken']
  }
  */
});
