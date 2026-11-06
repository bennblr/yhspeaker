import { createRoot } from 'react-dom/client';
import { GuidesPage } from './components/landing/GuidesPage';
import { LandingPage } from './components/landing/LandingPage';
import './index.css';

const container = document.getElementById('landing-root');
if (!container) throw new Error('Landing root element not found');

// Один собранный вход на два адреса: главная и /guides.
const path = window.location.pathname.replace(/\/+$/, '');

createRoot(container).render(path === '/guides' ? <GuidesPage /> : <LandingPage />);

// Лендинг живёт на корневом домене, поэтому установка PWA начинается здесь,
// а приложение открывается по /app (см. start_url в манифесте).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
