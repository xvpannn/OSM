import { useState, useEffect } from 'react'
import type { View } from './types'
import LandingView    from './views/LandingView'
import LibraryView    from './views/LibraryView'
import DashboardView  from './views/DashboardView'
import AccessView     from './views/AccessView'

interface RouteInfo {
  view: View
  country: 'us' | 'uk'
}

function getRouteFromPath(path: string): RouteInfo {
  if (path.startsWith('/dashboard/uk')) return { view: 'dashboard', country: 'uk' }
  if (path.startsWith('/dashboard/us')) return { view: 'dashboard', country: 'us' }
  if (path === '/dashboard') return { view: 'dashboard', country: 'us' }
  if (path === '/library') return { view: 'library', country: 'us' }
  return { view: 'landing', country: 'us' }
}

export default function App() {
  const [routeInfo, setRouteInfo] = useState<RouteInfo>(() => getRouteFromPath(window.location.pathname))
  const [targetCountry, setTargetCountry] = useState<'us' | 'uk'>('us')

  useEffect(() => {
    const handlePopState = () => {
      setRouteInfo(getRouteFromPath(window.location.pathname))
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Check authentication status on startup
  useEffect(() => {
    const token = localStorage.getItem('osm_session_token')
    if (!token && (routeInfo.view === 'dashboard' || routeInfo.view === 'library')) {
      // Force redirect to the secure access screen
      setTargetCountry(routeInfo.country)
      setRouteInfo({ view: 'access', country: routeInfo.country })
    }
  }, [routeInfo])

  const handleNavigate = (newView: View, countryCode?: 'us' | 'uk') => {
    const activeCountry = countryCode || routeInfo.country
    
    // Check if token exists before permitting navigation
    const token = localStorage.getItem('osm_session_token')
    if (!token && (newView === 'dashboard' || newView === 'library')) {
      setTargetCountry(activeCountry)
      setRouteInfo({ view: 'access', country: activeCountry })
      return
    }

    let newPath = '/'
    if (newView === 'library') {
      newPath = '/library'
    } else if (newView === 'dashboard') {
      newPath = `/dashboard/${activeCountry}`
    } else if (newView === 'access') {
      newPath = '/'
    }
    if (window.location.pathname !== newPath) {
      window.history.pushState(null, '', newPath)
    }
    setRouteInfo({ view: newView, country: activeCountry })
  }

  return (
    <div className={`w-screen bg-black text-osm-text font-sans select-none relative ${
      routeInfo.view === 'landing' || routeInfo.view === 'access' ? 'min-h-screen' : 'h-screen overflow-hidden'
    }`}>
      {routeInfo.view === 'landing'   && <LandingView   onNavigate={handleNavigate} />}
      {routeInfo.view === 'access'    && <AccessView    onNavigate={handleNavigate} targetCountry={targetCountry} />}
      {routeInfo.view === 'library'   && <LibraryView   onNavigate={handleNavigate} />}
      {routeInfo.view === 'dashboard' && (
        <DashboardView 
          onNavigate={handleNavigate} 
          initialCountry={routeInfo.country} 
        />
      )}
    </div>
  )
}

