import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/auth': 'http://localhost:8000',
            '/groups': 'http://localhost:8000',
            '/messages': 'http://localhost:8000',
            '/scaffolds': 'http://localhost:8000',
            '/assignments': 'http://localhost:8000',
            '/upload': 'http://localhost:8000',
            '/analytics': 'http://localhost:8000',
            '/roster': 'http://localhost:8000',
            '/teacher': 'http://localhost:8000',
            '/llm': 'http://localhost:8000',
            '/knowledge': 'http://localhost:8000',
            '/courses': 'http://localhost:8000',
            '/ai-conversations': 'http://localhost:8000',
            '/healthz': 'http://localhost:8000',
            '/readyz': 'http://localhost:8000',
            '/metrics': 'http://localhost:8000',
            '/ws': {
                target: 'http://localhost:8000',
                ws: true,
                changeOrigin: true,
                secure: false,
                timeout: 60000,
            }
        }
    }
})
