import React from 'react'
import ReactDOM from 'react-dom/client'
// Global styles first so per-world stylesheets (imported by App) can refine them.
import './styles.css'
import './styles/identity.css'
import './styles/radio.css'
import './styles/collective.css'
import './styles/lab.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)
