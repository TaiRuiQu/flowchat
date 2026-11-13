import React from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { Toaster } from 'sonner'
import { TooltipProvider } from './components/ui/primitives'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={400}>
        <App />
        <Toaster
          position="bottom-right"
          closeButton
          duration={2200}
          style={
            {
              '--normal-bg': 'var(--background)',
              '--normal-text': 'var(--foreground)',
              '--normal-border': 'var(--border)',
            } as React.CSSProperties
          }
        />
      </TooltipProvider>
    </MotionConfig>
  </React.StrictMode>,
)
