const esbuild = require('esbuild');
const path = require('node:path');
esbuild.build({
  entryPoints: [path.join(__dirname, 'smoke.jsx')], outfile: path.join(__dirname, 'bundle.cjs'),
  bundle: true, platform: 'node', jsx: 'automatic', external: ['react', 'react-dom/server'],
  loader: { '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl' },
  define: { 'import.meta.env.VITE_API_BASE_URL': '"http://preview.invalid"' },
  plugins: [{ name: 'server-portal-smoke', setup(build) {
    build.onResolve({ filter: /^react-dom$/ }, () => ({ path: path.join(__dirname, 'portal.jsx') }));
  } }],
}).then(() => require('./bundle.cjs')).catch(error => { console.error(error); process.exitCode = 1; });
