import React, {lazy, Suspense} from 'react'
import ReactDOM from 'react-dom/client'
import Exhibition from './broadcast/Exhibition'
const App = lazy(() => import('./the-track'))
const SitePreview = lazy(() => import('./site/SitePreview'))
const demo = new URLSearchParams(window.location.search).get('demo') === '1'
const sitePreview = new URLSearchParams(window.location.search).get('preview') === 'site'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {demo ? <Exhibition /> : <Suspense fallback={<p style={{color:'#f6efe4',padding:24}}>Opening The Track…</p>}>{sitePreview ? <SitePreview/> : <App />}</Suspense>}
  </React.StrictMode>
)
