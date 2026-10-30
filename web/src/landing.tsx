import { createRoot } from 'react-dom/client';
import { GuidesPage } from './components/landing/GuidesPage';
import { LandingPage } from './components/landing/LandingPage';
import './index.css';

const container = document.getElementById('landing-root');
if (!container) throw new Error('Landing root element not found');

// Один собранный вход на два адреса: главная и /guides.
const path = window.location.pathname.replace(/\/+$/, '');

createRoot(container).render(path === '/guides' ? <GuidesPage /> : <LandingPage />);
