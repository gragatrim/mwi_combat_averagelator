import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/mwi_combat_averagelator/',
  plugins: [react(), tailwindcss()],
})
