import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { SettingsProvider } from './context/SettingsContext';
import { GamificationProvider } from './context/GamificationContext';
import PrivateRoute from './components/PrivateRoute';
import XPToast from './components/XPToast';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ProjectView from './pages/ProjectView';
import Settings from './pages/Settings';
import BookStore from './pages/BookStore';


function App() {
    return (
        <AuthProvider>
            <SettingsProvider>
                <GamificationProvider>
                    <ToastProvider>
                        <Router>
                            <Routes>
                                <Route path="/login" element={<Login />} />
                                
                                {/* Protected Routes */}
                                <Route element={<PrivateRoute />}>
                                    <Route path="/dashboard" element={<Dashboard />} />
                                    <Route path="/project/:projectId" element={<ProjectView />} />
                                    <Route path="/settings" element={<Settings />} />
                                    <Route path="/bookstore" element={<BookStore />} />
                                </Route>

                                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                            </Routes>
                        </Router>
                        <XPToast />
                    </ToastProvider>
                </GamificationProvider>
            </SettingsProvider>
        </AuthProvider>
    );
}

export default App;
