import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getAccessToken, rememberReturnPath } from '@/lib/auth'

export function ProtectedRoute() {
  const location = useLocation()
  if (getAccessToken()) return <Outlet />
  // Back to this page after signing in (e.g. a course share link opened while signed out).
  rememberReturnPath(location.pathname + location.search)
  return <Navigate to="/login" replace />
}
