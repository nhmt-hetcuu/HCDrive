import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { DriveLayout } from '@/layouts/DriveLayout'
import { HomePage } from '@/pages/HomePage'
import { AllFilesPage } from '@/pages/AllFilesPage'
import { LoginPage } from '@/pages/LoginPage'
import { GoogleAuthPage } from '@/pages/GoogleAuthPage'
import { GoogleConnectedPage } from '@/pages/GoogleConnectedPage'
import { QuotaTrackerPage } from '@/pages/QuotaTrackerPage'
import { RecentPage } from '@/pages/RecentPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SharedPage } from '@/pages/SharedPage'
import { StarredPage } from '@/pages/StarredPage'
import { PublicFilePage } from '@/pages/PublicFilePage'
import { TrashPage } from '@/pages/TrashPage'
import { ApiDocsPage } from '@/pages/ApiDocsPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { UploadProvider } from '@/context/UploadContext'
import { LanguageProvider } from '@/context/LanguageContext'
import { SnackbarProvider } from '@/context/SnackbarContext'
import { DriveFeatureHost } from '@/components/drive/DriveFeatureHost'

function App() {
  return (
    <LanguageProvider>
      <SnackbarProvider>
        <UploadProvider>
          <Routes>
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
            <Route path="google-auth" element={<GoogleAuthPage />} />
            <Route path="google-connected" element={<GoogleConnectedPage />} />
            <Route path="public/files/:token" element={<PublicFilePage />} />
            <Route path="public/files/:token/embed" element={<PublicFilePage embed />} />
            <Route path="api" element={<ApiDocsPage />} />
            <Route path="api-docs" element={<ApiDocsPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<DriveLayout />}>
                <Route index element={<Navigate to="/home" replace />} />
                <Route path="home" element={<HomePage />} />
                <Route path="all-files" element={<AllFilesPage />} />
                <Route path="accounts" element={<QuotaTrackerPage />} />
                <Route path="storage" element={<QuotaTrackerPage />} />
                <Route path="quota" element={<Navigate to="/storage" replace />} />
                <Route path="shared" element={<SharedPage />} />
                <Route path="recent" element={<RecentPage />} />
                <Route path="starred" element={<StarredPage />} />
                <Route path="archived" element={<Navigate to="/trash" replace />} />
                <Route path="trash" element={<TrashPage />} />
                <Route path="activity" element={<Navigate to="/settings?tab=activity" replace />} />
                <Route path="users" element={<Navigate to="/settings?tab=users" replace />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          {/* Dialogs for Google Drive actions started from any page's file menu. */}
          <DriveFeatureHost />
        </UploadProvider>
      </SnackbarProvider>
    </LanguageProvider>
  )
}

export default App
