import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FloorGrid } from './FloorGrid';
import { RapidOrderBuilder } from './RapidOrderBuilder';
import { OrderDraftDrawer } from './OrderDraftDrawer';
import { WifiOff, LayoutGrid, Utensils, ShoppingBag, ShieldCheck, Server, RefreshCw } from 'lucide-react';
import { usePos } from '../context/PosContext';

export const WaiterApp = () => {
  const { currentRestaurant } = usePos() || {};
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [activeTab, setActiveTab] = useState('floor');

  // Hub Connection & Pairing State
  const defaultHub = typeof window !== 'undefined' 
    ? `${window.location.protocol}//${window.location.hostname}:4000` 
    : 'http://localhost:4000';

  const [hubUrl, setHubUrl] = useState(() => {
    return localStorage.getItem('mejwani_hub_url') || defaultHub;
  });

  const [hubInfo, setHubInfo] = useState(null);
  const [connStatus, setConnStatus] = useState('connecting'); // 'connecting' | 'connected' | 'disconnected'
  const hubConnected = connStatus === 'connected';
  const [showPairModal, setShowPairModal] = useState(false);
  const [manualIpInput, setManualIpInput] = useState('');
  const [pairError, setPairError] = useState('');
  const [isTestingConn, setIsTestingConn] = useState(false);

  // Live Dynamic State from Hub Server
  const [liveTables, setLiveTables] = useState([]);
  const [activeOrders, setActiveOrders] = useState([]);
  const wasConnectedRef = useRef(false);
  const isGracePeriodRef = useRef(true);

  // 1. Fetch Live Tables & Open Orders from Hub Server
  const fetchLiveState = useCallback(async (targetUrl = hubUrl) => {
    const cleanUrl = targetUrl.replace(/\/+$/, '');
    try {
      const [tablesRes, ordersRes] = await Promise.all([
        fetch(`${cleanUrl}/tables`).catch(() => null),
        fetch(`${cleanUrl}/orders/active`).catch(() => null)
      ]);

      if (tablesRes && tablesRes.ok) {
        const data = await tablesRes.json();
        if (data.tables && Array.isArray(data.tables)) {
          setLiveTables(data.tables);
        }
      }

      if (ordersRes && ordersRes.ok) {
        const data = await ordersRes.json();
        if (data.tickets && Array.isArray(data.tickets)) {
          setActiveOrders(data.tickets);
        }
      }
    } catch (err) {
      console.warn('Could not fetch live state from hub:', err);
    }
  }, [hubUrl]);

  const pingFailuresRef = useRef(0);

  // 2. Periodic 5s Health Check & Auto Re-Sync on Reconnect
  const checkHubConnection = useCallback(async (targetUrl = hubUrl) => {
    setIsTestingConn(true);
    setPairError('');
    const cleanUrl = targetUrl.replace(/\/+$/, '');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

      const res = await fetch(`${cleanUrl}/pairing-info`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        setHubInfo(data);
        pingFailuresRef.current = 0; // Reset fail counter on success
        
        // Auto Re-Sync check: if previously disconnected and now connected again
        if (!wasConnectedRef.current) {
          fetchLiveState(cleanUrl);
        }
        wasConnectedRef.current = true;
        setConnStatus('connected');
        setHubUrl(cleanUrl);
        localStorage.setItem('mejwani_hub_url', cleanUrl);
        setIsTestingConn(false);
        return true;
      }
    } catch (err) {
      pingFailuresRef.current += 1;
      // Require 2 consecutive missed pings (or post grace window) before declaring offline state
      if (pingFailuresRef.current >= 2 || !isGracePeriodRef.current) {
        wasConnectedRef.current = false;
        setConnStatus('disconnected');
      }
    }
    setIsTestingConn(false);
    return false;
  }, [hubUrl, fetchLiveState]);

  useEffect(() => {
    isGracePeriodRef.current = true;
    const graceTimer = setTimeout(() => {
      isGracePeriodRef.current = false;
      if (pingFailuresRef.current >= 2) {
        setConnStatus('disconnected');
      }
    }, 3000);

    checkHubConnection(hubUrl);
    fetchLiveState(hubUrl);

    // Periodic 5s health check loop
    const healthInterval = setInterval(() => {
      checkHubConnection(hubUrl);
    }, 5000);

    return () => {
      clearTimeout(graceTimer);
      clearInterval(healthInterval);
    };
  }, [hubUrl, checkHubConnection, fetchLiveState]);

  // 3. WebSocket Real-Time Subscription to WS /live (Bug 1 Fix)
  useEffect(() => {
    if (!hubUrl) return;
    const cleanUrl = hubUrl.replace(/\/+$/, '');
    const wsHost = cleanUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    const wsUrl = `${wsHost}/live`;

    let ws = null;
    let isSubscribed = true;

    const connectWs = () => {
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log(`📱 Waiter App WS /live connected to ${wsUrl}`);
          fetchLiveState(cleanUrl);
        };

        ws.onmessage = (event) => {
          if (!isSubscribed) return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'TABLE_STATUS_CHANGE') {
              fetchLiveState(cleanUrl);
            } else if (msg.type === 'NEW_ORDER') {
              setActiveOrders(prev => [msg.payload, ...prev]);
            }
          } catch (e) {
            console.warn('WS message parse error:', e);
          }
        };

        ws.onclose = () => {
          if (isSubscribed) {
            setTimeout(connectWs, 4000);
          }
        };

        ws.onerror = () => {
          if (ws) ws.close();
        };
      } catch (err) {
        console.warn('WS connection failed:', err);
      }
    };

    connectWs();

    return () => {
      isSubscribed = false;
      if (ws) ws.close();
    };
  }, [hubUrl, fetchLiveState]);

  // Handle Clearing Table Bill
  const handleClearTableBill = (tableId) => {
    setDrafts(p => {
      const c = { ...p };
      delete c[tableId];
      return c;
    });
  };

  const handlePairSubmit = async (e) => {
    e.preventDefault();
    if (!manualIpInput.trim()) return;
    setConnStatus('connecting');

    let raw = manualIpInput.trim();
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
      raw = `http://${raw}`;
    }
    if (!raw.includes(':', 6)) {
      raw = `${raw}:4000`;
    }

    const success = await checkHubConnection(raw);
    if (success) {
      setShowPairModal(false);
      setManualIpInput('');
      fetchLiveState(raw);
    } else {
      setConnStatus('disconnected');
      setPairError(`Could not reach Kitchen Hub at ${raw}. Check WiFi connection.`);
    }
  };

  const currentDraftItems = selectedTableId ? (drafts[selectedTableId] || {}) : {};
  const totalCartCount = Object.values(currentDraftItems).reduce((s, q) => s + q, 0);

  const addItem = (itemId) => {
    if (!selectedTableId) return;
    setDrafts(p => ({ ...p, [selectedTableId]: { ...(p[selectedTableId] || {}), [itemId]: ((p[selectedTableId] || {})[itemId] || 0) + 1 } }));
  };

  const removeItem = (itemId) => {
    if (!selectedTableId) return;
    setDrafts(p => {
      const d = { ...(p[selectedTableId] || {}) };
      d[itemId] = (d[itemId] || 0) - 1;
      if (d[itemId] <= 0) delete d[itemId];
      return { ...p, [selectedTableId]: d };
    });
  };

  const clearDraft = () => {
    if (!selectedTableId) return;
    setDrafts(p => { const c = { ...p }; delete c[selectedTableId]; return c; });
  };

  const navItems = [
    { id: 'floor', icon: LayoutGrid, label: 'Tables' },
    { id: 'menu',  icon: Utensils,   label: 'Menu' },
    { id: 'cart',  icon: ShoppingBag, label: 'Cart', badge: totalCartCount },
  ];

  return (
    <div style={{
      width: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column',
      background: 'var(--color-canvas)',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      paddingLeft: 'env(safe-area-inset-left, 0px)',
      paddingRight: 'env(safe-area-inset-right, 0px)'
    }}>
      <div>
        {/* App Header & Pairing Status */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', background: 'var(--color-canvas)',
          borderBottom: '1px solid var(--color-hairline)', flex: 'none'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%',
              background: '#3b82f6', color: '#ffffff', fontWeight: 800, fontSize: '12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              W1
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-ink)' }}>
                {hubInfo?.name || currentRestaurant?.name || 'Hotel Mejwani'}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                Hub: {hubUrl.replace('http://', '').replace('https://', '')}
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowPairModal(true)}
            style={{
              fontSize: '10px', fontWeight: 700,
              color: connStatus === 'connected' ? '#10b981' : connStatus === 'connecting' ? '#94a3b8' : '#ef4444',
              background: connStatus === 'connected' ? 'rgba(16, 185, 129, 0.12)' : connStatus === 'connecting' ? 'rgba(148, 163, 184, 0.15)' : 'rgba(239, 68, 68, 0.12)',
              padding: '4px 10px', borderRadius: '999px',
              border: `1px solid ${connStatus === 'connected' ? '#10b981' : connStatus === 'connecting' ? '#64748b' : '#ef4444'}`,
              display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer'
            }}
          >
            {connStatus === 'connected' ? (
              <ShieldCheck size={12} />
            ) : connStatus === 'connecting' ? (
              <RefreshCw size={12} className="spin" />
            ) : (
              <WifiOff size={12} />
            )}
            {connStatus === 'connected' ? 'LAN Connected' : connStatus === 'connecting' ? 'Connecting…' : 'Not Connected'}
          </button>
        </div>

        {/* Unreachable Hub Offline Banner (Bug 2 Fix) */}
        {connStatus === 'disconnected' && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)', borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
            padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: '11px', color: '#f87171', fontWeight: 600
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <WifiOff size={16} style={{ flexShrink: 0 }} />
              <span>Not connected to kitchen hub. Tap to pair.</span>
            </div>
            <button
              onClick={() => setShowPairModal(true)}
              style={{ background: '#ef4444', color: '#ffffff', border: 'none', padding: '4px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}
            >
              Connect
            </button>
          </div>
        )}

        {/* Pairing Modal Flow */}
        {showPairModal && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 100, background: 'rgba(9, 13, 22, 0.95)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
          }}>
            <div style={{
              background: '#111827', border: '1px solid #1f2937', borderRadius: '16px',
              padding: '24px', width: '100%', maxWidth: '340px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <Server size={22} style={{ color: '#3b82f6' }} />
                <h3 style={{ margin: 0, fontSize: '16px', color: '#f8fafc', fontWeight: 700 }}>
                  Connect to Kitchen Hub
                </h3>
              </div>

              <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: 0, marginBottom: '16px' }}>
                Scan the QR code displayed on the Kitchen Display screen, or enter the hub's LAN IP address below.
              </p>

              <form onSubmit={handlePairSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase' }}>
                    Hub LAN IP or URL
                  </label>
                  <input
                    type="text"
                    value={manualIpInput}
                    onChange={e => setManualIpInput(e.target.value)}
                    placeholder="e.g. 192.168.1.50:4000"
                    style={{
                      width: '100%', marginTop: '4px', padding: '10px 12px',
                      background: '#1e293b', border: '1px solid #374151', borderRadius: '8px',
                      color: '#ffffff', fontSize: '13px', fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>

                {pairError && (
                  <div style={{ color: '#f87171', fontSize: '11px', fontWeight: 600 }}>
                    ⚠️ {pairError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setShowPairModal(false)}
                    style={{ flex: 1, padding: '10px', background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isTestingConn}
                    style={{ flex: 1, padding: '10px', background: '#3b82f6', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  >
                    {isTestingConn ? <RefreshCw size={14} className="spin" /> : 'Connect'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Screen Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--color-canvas)' }}>
          {activeTab === 'floor' && (
            <>
              <p className="typography-uppercase-tag" style={{ color: 'var(--color-muted)' }}>
                Select Table → Add Items → Send to Kitchen
              </p>
              <FloorGrid 
                selectedTable={selectedTableId} 
                onSelectTable={setSelectedTableId} 
                tables={liveTables}
                onClearTableBill={handleClearTableBill}
              />
              <OrderDraftDrawer
                selectedTableId={selectedTableId}
                draftItems={currentDraftItems}
                onRemoveItem={removeItem}
                onClearDraft={clearDraft}
                hubUrl={hubUrl}
                hubConnected={hubConnected}
              />
            </>
          )}

          {activeTab === 'menu' && (
            <>
              {!selectedTableId && (
                <div style={{
                  background: 'var(--status-amber-bg)', border: '1px solid var(--status-amber-border)',
                  borderRadius: 'var(--radius-sm)', padding: '10px 14px',
                  fontSize: '12px', color: 'var(--status-amber-text)', fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: '8px'
                }}>
                  ⚠️ Tap a table on the <strong>Tables</strong> tab first, then add items here.
                </div>
              )}
              <RapidOrderBuilder
                selectedTableId={selectedTableId}
                draftItems={currentDraftItems}
                onAddItem={addItem}
                onRemoveItem={removeItem}
              />
            </>
          )}

          {activeTab === 'cart' && (
            <OrderDraftDrawer
              selectedTableId={selectedTableId}
              draftItems={currentDraftItems}
              onRemoveItem={removeItem}
              onClearDraft={clearDraft}
              hubUrl={hubUrl}
              hubConnected={hubConnected}
            />
          )}
        </div>

        {/* Bottom Nav Bar */}
        <div style={{
          display: 'flex', background: 'var(--color-canvas)',
          borderTop: '1px solid var(--color-hairline)',
          padding: '6px 8px 8px', flex: 'none', gap: '4px'
        }}>
          {navItems.map(nav => (
            <button
              key={nav.id}
              onClick={() => setActiveTab(nav.id)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
                padding: '8px 4px', borderRadius: 'var(--radius-full)',
                color: activeTab === nav.id ? '#ffffff' : 'var(--color-muted)',
                background: activeTab === nav.id ? 'var(--color-primary)' : 'transparent',
                fontSize: '11px', fontWeight: 500, position: 'relative',
                transition: 'all 0.15s ease', border: 'none', cursor: 'pointer'
              }}
            >
              <nav.icon size={18} strokeWidth={activeTab === nav.id ? 2.5 : 1.8} />
              {nav.label}
              {nav.badge > 0 && (
                <span style={{
                  position: 'absolute', top: '2px', right: '14px',
                  background: activeTab === nav.id ? 'var(--color-primary-active)' : 'var(--color-primary)',
                  color: '#ffffff', fontSize: '9px', fontWeight: 700, borderRadius: 'var(--radius-full)',
                  padding: '1px 6px', fontFamily: 'var(--font-mono)'
                }}>
                  {nav.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
