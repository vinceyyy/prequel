import { Navigate, Route, Routes } from 'react-router-dom'
import AuthGate from './components/AuthGate'
import Navigation from './components/Navigation'
import AdminPage from './pages/AdminPage'
import ApiKeyActivatePage from './pages/ApiKeyActivatePage'
import ApiKeysPage from './pages/ApiKeysPage'
import ChallengesPage from './pages/ChallengesPage'
import InterviewsPage from './pages/InterviewsPage'
import LoginPage from './pages/LoginPage'
import TakeHomeActivatePage from './pages/TakeHomeActivatePage'
import TakeHomesPage from './pages/TakeHomesPage'

function App() {
  return (
    <AuthGate>
      <Navigation />
      <Routes>
        <Route path="/" element={<Navigate to="/interviews" replace />} />
        <Route path="/interviews" element={<InterviewsPage />} />
        <Route path="/takehomes" element={<TakeHomesPage />} />
        <Route path="/apikeys" element={<ApiKeysPage />} />
        <Route path="/challenges" element={<ChallengesPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/apikey/:token" element={<ApiKeyActivatePage />} />
        <Route path="/takehome/:token" element={<TakeHomeActivatePage />} />
      </Routes>
    </AuthGate>
  )
}

export default App
