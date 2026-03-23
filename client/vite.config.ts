import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import fs from 'fs'
import path from 'path'

// Custom plugin to serve .onnx and .wasm files with correct MIME type
function wasmMimeTypePlugin(): Plugin {
  return {
    name: 'wasm-mime-type',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.endsWith('.onnx') || req.url?.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm')
        }
        next()
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), wasmMimeTypePlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true
      }
    },
    fs: {
      strict: false,
      allow: ['..']
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
})
