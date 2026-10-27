import { createRoot } from 'react-dom/client';
import { PlatformApp } from './components/platform/PlatformApp';
import './index.css';

const container = document.getElementById('platform-root');
if (!container) throw new Error('Platform root element not found');

createRoot(container).render(<PlatformApp />);
