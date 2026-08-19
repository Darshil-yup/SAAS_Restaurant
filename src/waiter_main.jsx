import React from 'react';
import ReactDOM from 'react-dom/client';
import { PosProvider } from './context/PosContext';
import { WaiterApp } from './waiter_mobile/WaiterApp';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PosProvider>
      <WaiterApp />
    </PosProvider>
  </React.StrictMode>
);
