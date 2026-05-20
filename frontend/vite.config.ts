import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    optimizeDeps: {
        include: ['react-window'],
    },
    resolve: {
        dedupe: ['react', 'react-dom'],       // 确保整个应用使用单一 React 实例
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) return undefined
                    const normalizedId = id.replace(/\\/g, '/')
                    const nodeModulePath = normalizedId.split('/node_modules/')[1] ?? ''
                    const parts = nodeModulePath.split('/')
                    const packageName = parts[0]?.startsWith('@')
                        ? `${parts[0]}/${parts[1]}`
                        : parts[0]

                    if (['react', 'react-dom', 'react-router-dom', 'scheduler'].includes(packageName)) {
                        return 'react-vendor'
                    }
                    if (
                        packageName === 'react-markdown'
                        || packageName.startsWith('remark-')
                        || packageName.startsWith('rehype-')
                        || packageName.startsWith('micromark')
                        || packageName.startsWith('mdast-util')
                        || packageName.startsWith('hast-util')
                        || packageName.startsWith('unist-util')
                        || ['unified', 'vfile', 'bail', 'trough', 'devlop', 'zwitch'].includes(packageName)
                    ) {
                        return 'markdown'
                    }
                    if (['@xyflow/react', '@xyflow/system', 'dagre', 'yjs', 'y-websocket'].includes(packageName)) {
                        return 'flow'
                    }
                    if (packageName === 'recharts') {
                        return 'charts'
                    }
                    if (packageName === 'html-to-image') {
                        return 'image-export'
                    }
                    if (packageName === 'jszip' || ['pako', 'lie', 'setimmediate'].includes(packageName)) {
                        return 'zip'
                    }
                    if (
                        packageName === 'mammoth'
                        || [
                            '@xmldom/xmldom',
                            'argparse',
                            'base64-js',
                            'bluebird',
                            'dingbat-to-unicode',
                            'lop',
                            'path-is-absolute',
                            'underscore',
                            'xmlbuilder',
                        ].includes(packageName)
                    ) {
                        return 'doc-preview'
                    }
                    if (packageName === 'lucide-react') {
                        return 'icons'
                    }
                    return undefined
                },
            },
        },
    },
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
            '/learning-space-design': 'http://localhost:8000',
            '/jobs': 'http://localhost:8000',
            '/notifications': 'http://localhost:8000',
            '/mindmaps': 'http://localhost:8000',
            '/healthz': 'http://localhost:8000',
            '/readyz': 'http://localhost:8000',
            '/metrics': 'http://localhost:8000',
            '/ws': {
                target: 'http://localhost:8000',
                ws: true,
                changeOrigin: true,
                secure: false,
                timeout: 60000,
            },
            '/yjs': {
                target: 'http://localhost:1234',
                ws: true,
                changeOrigin: true,
                secure: false,
            }
        }
    }
})
