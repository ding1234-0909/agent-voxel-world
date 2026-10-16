import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Connection } from './network/connection';
import './styles/main.css';

const connection = new Connection();
if (import.meta.hot) import.meta.hot.dispose(() => connection.dispose());
createRoot(document.getElementById('root')!).render(
  <App connection={connection} />,
);
