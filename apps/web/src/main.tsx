import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'

import { appRoutes } from '@/app/routes'
import { TooltipProvider } from '@/components/ui/tooltip'

import '@/index.css'

const rootElement = document.querySelector('#root')

if (!(rootElement instanceof HTMLElement)) {
  throw new TypeError('The application root element is missing.')
}

const router = createBrowserRouter(appRoutes)

createRoot(rootElement).render(
  <StrictMode>
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  </StrictMode>,
)
