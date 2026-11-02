import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { connectEngine } from './api'
import './styles/tokens.css'
import './styles.css'
import './styles/shell.css'
import './styles/library.css'

if (window.vnstudio) connectEngine()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
