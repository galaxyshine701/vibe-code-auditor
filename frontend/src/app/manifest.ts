import type { MetadataRoute } from 'next';
import { PROJECT_DESCRIPTION, PROJECT_NAME } from '../lib/brand';

// The web app manifest (R59). Colours are --bg of the dark theme, the theme the
// app opens in (R55). The icons are drawn by scripts/make-icons.mjs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: PROJECT_NAME,
    short_name: PROJECT_NAME,
    description: PROJECT_DESCRIPTION,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0f1114',
    theme_color: '#0f1114',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
