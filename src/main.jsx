import React, {lazy, Suspense} from 'react'
import ReactDOM from 'react-dom/client'
import Exhibition from './broadcast/Exhibition'
const App = lazy(() => import('./the-track'))
const demo = new URLSearchParams(window.location.search).get('demo') === '1'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {demo ? <Exhibition /> : <Suspense fallback={<p style={{color:'#f6efe4',padding:24}}>Opening The Track…</p>}><App /></Suspense>}
  </React.StrictMode>
)
