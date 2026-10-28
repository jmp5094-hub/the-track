import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import './base.css'

// The pitch route deliberately does not import Firebase or the live account app.
const isShowcase = window.location.pathname.replace(/\/$/, '') === '/showcase' || new URLSearchParams(window.location.search).has('showcase') || import.meta.env.VITE_SHOWCASE_ONLY === 'true'
const App = isShowcase
  ? lazy(() => import('./cinematic/Showcase'))
  : lazy(() => import('./the-track'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Suspense fallback={<div style={{ background: '#101a16', color: '#e2c58d', padding: 40, minHeight: '100vh', fontFamily: 'Georgia, serif' }}>The Track · Preparing the clubhouse…</div>}><App /></Suspense>
  </React.StrictMode>
)
