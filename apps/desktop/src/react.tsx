import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { Buffer } from 'buffer';

window.Buffer = Buffer;
const root = createRoot(document.getElementById('root'));
root.render(<App />);
