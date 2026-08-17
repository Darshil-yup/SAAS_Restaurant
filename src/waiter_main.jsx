import React from 'react';
import ReactDOM from 'react-dom/client';
import { PosProvider } from './context/PosContext';
import { WaiterApp } from './waiter_mobile/WaiterApp';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PosProvider>
      <div style={{ minHeight: '100vh', background: '#090d16', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px 8px' }}>
        <WaiterApp />
      </div>
    </PosProvider>
  </React.StrictMode>
);
