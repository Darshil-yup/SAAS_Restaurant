import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FloorGrid } from './FloorGrid';
import { RapidOrderBuilder } from './RapidOrderBuilder';
import { OrderDraftDrawer } from './OrderDraftDrawer';
import { WifiOff, LayoutGrid, Utensils, ShoppingBag, ShieldCheck, Server, RefreshCw, Key, QrCode, Download } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { usePos } from '../context/PosContext';
import { authFetch, authWsUrl, captureTokenFromUrl, consumePendingEnrollmentCode, enrollWithCode, hasToken } from '../services/hubAuth';
import { QrScannerModal } from './QrScannerModal';

export const WaiterApp = () => {
  const { currentRestaurant, isMenuUninitialized: posMenuUninitialized } = usePos() || {};
  const shouldReduceMotion = useReducedMotion();
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [activeTab, setActiveTab] = useState('floor');
  const [hubMenuUninitialized, setHubMenuUninitialized] = useState(false);

  // Hub Connection & Pairing State
  const defaultHub = typeof window !== 'undefined' 
    ? `${window.location.protocol}//${window.location.hostname}:4000` 
    : 'http://localhost:4000';

  const [hubUrl, setHubUrl] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('mejwani_hub_url');
      if (saved) {
        // If saved URL is pointing to localhost but current page was opened on mobile via IP address, adapt to LAN IP
        if (saved.includes('localhost') && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
          return `${window.location.protocol}//${window.location.hostname}:4000`;
        }
        return saved;
      }
      return defaultHub;
    }
    return 'http://localhost:4000';
  });

  const [hubInfo, setHubInfo] = useState(null);
  const [connStatus, setConnStatus] = useState('connecting'); // 'connecting' | 'connected' | 'unauthorized' | 'disconnected'
  const hubConnected = connStatus === 'connected';
  const [showPairModal, setShowPairModal] = useState(false);
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [manualIpInput, setManualIpInput] = useState('');
  const [enrollCodeInput, setEnrollCodeInput] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);

  // A QR scan drops the device token straight into the URL, so capture it before
  // the first render decides whether this handset still needs to enrol.
  const [isEnrolled, setIsEnrolled] = useState(() => {
    captureTokenFromUrl();
    return hasToken();
  });
  const [pairError, setPairError] = useState('');
  const [isTestingConn, setIsTestingConn] = useState(false);

  // Live Dynamic State from Hub Server
  const [liveTables, setLiveTables] = useState([]);
  const [activeOrders, setActiveOrders] = useState([]);
  const wasConnectedRef = useRef(false);
  const isGracePeriodRef = useRef(true);

  // 1. Fetch Live Tables, Open Orders, and Menu state from Hub Server
  const fetchLiveState = useCallback(async (targetUrl = hubUrl) => {
    const cleanUrl = targetUrl.replace(/\/+$/, '');
    try {
      const [tablesRes, ordersRes, menuRes] = await Promise.all([
        authFetch(`${cleanUrl}/tables`).catch(() => null),
        authFetch(`${cleanUrl}/orders/active`).catch(() => null),
        authFetch(`${cleanUrl}/menu`).catch(() => null)
      ]);

      if (tablesRes?.status === 401 || ordersRes?.status === 401 || menuRes?.status === 401) {
        console.warn('Hub rejected request with 401 Unauthorized: handset requires enrollment');
        setIsEnrolled(false);
        setConnStatus('unauthorized');
        return;
      }

      if (menuRes && menuRes.ok) {
        const menuData = await menuRes.json();
        if (menuData.uninitialized) {
          setHubMenuUninitialized(true);
        } else {
          setHubMenuUninitialized(false);
        }
      }

      if (tablesRes && tablesRes.ok) {
        const data = await tablesRes.json();
        if (data.uninitialized) {
          setHubMenuUninitialized(true);
        }
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

      const res = await authFetch(`${cleanUrl}/pairing-info`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        setHubInfo(data);
        pingFailuresRef.current = 0; // Reset fail counter on success
        
        // If data.authorised is false (hub requires enrollment from this handset)
        if (data.authorised === false && !hasToken()) {
          setIsEnrolled(false);
          setConnStatus('unauthorized');
          wasConnectedRef.current = false;
          setIsTestingConn(false);
          return false;
        }

        setIsEnrolled(true);
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

  // A scanned QR now hands over an enrollment code rather than a token, so trade
  // it for one as soon as the app mounts. The page is served by the hub itself,
  // so its own origin is the right address to enrol against.
  useEffect(() => {
    const pendingCode = consumePendingEnrollmentCode();
    if (!pendingCode || hasToken()) return;

    let cancelled = false;
    (async () => {
      const target = hubUrl || window.location.origin;
      const res = await enrollWithCode(target, pendingCode).catch(() => ({ ok: false }));
      if (!cancelled && res.ok) {
        setIsEnrolled(true);
        checkHubConnection(target);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Shared WebSocket Message Funnel for all state-changing events
  const handleHubWsEvent = useCallback((msg, cleanUrl) => {
    if (!msg || !msg.type) return;
    const type = msg.type;
    const payload = msg.payload || {};

    console.log(`⚡ WaiterApp processing WS event: ${type}`, payload);

    // 1. Instant optimistic local state updates
    if (type === 'TICKET_READY' || type === 'order_ready') {
      const tableId = payload.table_id;
      const ticketId = payload.ticket_id || payload.ticket_number || payload.order_id;

      if (tableId) {
        setLiveTables(prev => prev.map(t => {
          if (String(t.id) === String(tableId) || (t.name && String(t.name).toLowerCase() === String(payload.table_name).toLowerCase())) {
            return { ...t, status: 'ready' };
          }
          return t;
        }));
      }
      if (ticketId) {
        setActiveOrders(prev => prev.map(o => {
          if (o.id === ticketId || String(o.ticket_number) === String(ticketId)) {
            return { ...o, status: 'ready' };
          }
          return o;
        }));
      }
    } else if (type === 'CLEAR_TABLE' || type === 'bill_cleared' || type === 'order_cleared') {
      const tableId = payload.table_id;

      if (tableId) {
        setLiveTables(prev => prev.map(t => {
          if (String(t.id) === String(tableId)) {
            return { ...t, status: 'available', activeOrderTotal: 0, occupiedSince: null };
          }
          return t;
        }));

        setActiveOrders(prev => prev.filter(o => String(o.table_id) !== String(tableId)));

        setDrafts(prev => {
          const copy = { ...prev };
          delete copy[tableId];
          return copy;
        });
      }
    } else if (type === 'NEW_ORDER' || type === 'order_created') {
      const ticket = payload.ticket || payload;
      if (ticket && ticket.table_id) {
        setLiveTables(prev => prev.map(t => {
          if (String(t.id) === String(ticket.table_id)) {
            return {
              ...t,
              status: t.status === 'ready' ? 'ready' : 'kot',
              activeOrderTotal: (t.activeOrderTotal || 0) + (Number(ticket.total_amount) || 0)
            };
          }
          return t;
        }));

        setActiveOrders(prev => {
          const exists = prev.some(o => o.id === ticket.id || String(o.ticket_number) === String(ticket.ticket_number));
          if (exists) return prev;
          return [ticket, ...prev];
        });
      }
    }

    // 2. Authoritative live state fetch to stay 100% synchronized
    fetchLiveState(cleanUrl);
  }, [fetchLiveState]);

  // 3. WebSocket Real-Time Subscription to WS /live
  useEffect(() => {
    if (!hubUrl) return;
    const cleanUrl = hubUrl.replace(/\/+$/, '');
    const wsHost = cleanUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    const wsUrl = `${wsHost}/live`;

    let ws = null;
    let isSubscribed = true;

    const connectWs = () => {
      try {
        const finalWsUrl = authWsUrl(wsUrl);
        ws = new WebSocket(finalWsUrl);

        ws.onopen = () => {
          console.log(`📱 Waiter App WS /live connected to ${finalWsUrl}`);
          fetchLiveState(cleanUrl);
        };

        ws.onmessage = (event) => {
          if (!isSubscribed) return;
          try {
            const msg = JSON.parse(event.data);
            handleHubWsEvent(msg, cleanUrl);
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
  }, [hubUrl, fetchLiveState, handleHubWsEvent]);

  // Handle Clearing Table Bill
  const handleClearTableBill = async (tableId) => {
    // 1. Clear draft for table
    setDrafts(p => {
      const c = { ...p };
      delete c[tableId];
      return c;
    });

    // 2. Optimistic UI update immediately
    const prevTables = [...liveTables];
    setLiveTables(prev => prev.map(t => String(t.id) === String(tableId) ? {
      ...t,
      status: 'available',
      activeOrderTotal: 0,
      occupiedSince: null
    } : t));
    setActiveOrders(prev => prev.filter(o => String(o.table_id) !== String(tableId)));

    if (!hubUrl) return;
    const cleanUrl = hubUrl.replace(/\/+$/, '');
    try {
      const res = await authFetch(`${cleanUrl}/tables/${tableId}/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        console.log(`🧹 Clear bill request for table ${tableId} succeeded on Hub`);
        const data = await res.json().catch(() => ({}));
        if (data.tables && Array.isArray(data.tables)) {
          setLiveTables(data.tables);
        }
        fetchLiveState(cleanUrl);
      } else {
        // Revert optimistic update
        setLiveTables(prevTables);
        const errData = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setShowPairModal(true);
          setPairError('Handset is not enrolled or token expired. Enter the enrollment code from Kitchen Display.');
        } else {
          alert(errData.error || `Could not clear bill for table ${tableId}`);
        }
      }
    } catch (err) {
      setLiveTables(prevTables);
      console.error(`Failed to clear bill for table ${tableId}:`, err);
      alert(`Could not reach Hub at ${cleanUrl}. Check WiFi connection.`);
    }
  };

  const handlePairSubmit = async (e) => {
    e.preventDefault();
    setConnStatus('connecting');
    setPairError('');

    let raw = manualIpInput.trim() || hubUrl.replace(/^https?:\/\//, '');
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
      raw = `http://${raw}`;
    }
    if (!raw.includes(':', 6)) {
      raw = `${raw}:4000`;
    }

    // The hub only accepts enrolled devices. If this handset has no token yet,
    // trade the code shown on the Kitchen Display for one before connecting.
    if (!hasToken() || !isEnrolled) {
      const code = enrollCodeInput.trim().toUpperCase();
      if (!code) {
        setConnStatus('unauthorized');
        setPairError('Enter the 6-character enrollment code shown on the Kitchen Display (e.g. 9KZXEC).');
        return;
      }

      const enrolled = await enrollWithCode(raw, code).catch(() => ({
        ok: false,
        error: `Could not reach Kitchen Hub at ${raw}. Check WiFi connection.`
      }));

      if (!enrolled.ok) {
        setConnStatus('unauthorized');
        setPairError(enrolled.error || 'Invalid enrollment code. Check the Kitchen Display.');
        return;
      }
      setIsEnrolled(true);
    }

    const success = await checkHubConnection(raw);
    if (success) {
      setShowPairModal(false);
      setManualIpInput('');
      setEnrollCodeInput('');
      fetchLiveState(raw);
    } else {
      setConnStatus(prev => (prev === 'unauthorized' ? 'unauthorized' : 'disconnected'));
      if (!pairError) {
        setPairError(`Could not reach Kitchen Hub at ${raw}. Check WiFi connection.`);
      }
    }
  };

  // Auto-prompt enrollment modal when handset is detected as unauthorized
  useEffect(() => {
    if (connStatus === 'unauthorized' && !hasToken()) {
      if (!manualIpInput) {
        setManualIpInput(hubUrl.replace(/^https?:\/\//, ''));
      }
      setShowPairModal(true);
    }
  }, [connStatus, hubUrl]);

  // Handle successful QR scan from QrScannerModal
  const handleScanSuccess = useCallback(({ token, hubUrl: detectedHubUrl }) => {
    if (detectedHubUrl) {
      const cleanUrl = detectedHubUrl.replace(/\/+$/, '');
      setHubUrl(cleanUrl);
      localStorage.setItem('mejwani_hub_url', cleanUrl);
    }
    setIsEnrolled(true);
    setConnStatus('connected');
    setShowPairModal(false);
    setShowScannerModal(false);
    fetchLiveState(detectedHubUrl || hubUrl);
  }, [fetchLiveState, hubUrl]);

  // PWA Install Prompt Listener
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      console.log('🎉 Waiter PWA installed to home screen');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      setIsInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
      setIsInstalled(true);
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
      width: '100vw', height: '100dvh', display: 'flex', flexDirection: 'column',
      background: 'var(--color-canvas)', overflow: 'hidden', userSelect: 'none'
    }}>
      {/* Safe Area Viewport Container */}
      <div style={{
        display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: '480px',
        margin: '0 auto', background: 'var(--color-surface)', boxShadow: 'var(--shadow-md)', position: 'relative'
      }}>
        {/* Top Minimalist Header */}
        <div style={{
          padding: '10px 14px', background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-hairline)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flex: 'none'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: 'var(--radius-full)',
              background: 'var(--color-primary)', color: '#ffffff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: '11px', fontFamily: 'var(--font-mono)'
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {installPrompt && !isInstalled && (
              <button
                onClick={handleInstallClick}
                style={{
                  background: 'rgba(255, 87, 34, 0.12)', border: '1px solid var(--color-primary)',
                  borderRadius: 'var(--radius-full)', color: 'var(--color-primary)',
                  padding: '4px 10px', fontSize: '11px', fontWeight: 700, display: 'flex',
                  alignItems: 'center', gap: '4px', cursor: 'pointer'
                }}
                title="Install Waiter App on this device"
              >
                <Download size={12} />
                <span>Install</span>
              </button>
            )}

            <button
              onClick={() => {
                if (!manualIpInput) {
                  setManualIpInput(hubUrl.replace(/^https?:\/\//, ''));
                }
                setShowPairModal(true);
              }}
              className={`conn-pill conn-pill-${
                connStatus === 'connected'
                  ? 'ok'
                  : connStatus === 'unauthorized'
                  ? 'warning'
                  : connStatus === 'connecting'
                  ? 'connecting'
                  : 'off'
              }`}
              style={{ cursor: 'pointer' }}
            >
              {connStatus === 'connected' ? (
                <ShieldCheck size={12} />
              ) : connStatus === 'unauthorized' ? (
                <Key size={12} />
              ) : connStatus === 'connecting' ? (
                <RefreshCw size={12} className="spin" />
              ) : (
                <WifiOff size={12} />
              )}
              {connStatus === 'connected'
                ? 'LAN Connected'
                : connStatus === 'unauthorized'
                ? 'Enter Code'
                : connStatus === 'connecting'
                ? 'Connecting…'
                : 'Not Connected'}
            </button>
          </div>
        </div>

        {/* Unauthorized / Unenrolled Handset Banner */}
        {connStatus === 'unauthorized' && (
          <div className="banner banner-warning" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--color-warning-border)',
            padding: '10px 14px', background: 'var(--status-amber-bg)', color: 'var(--status-amber-text)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600 }}>
              <span style={{ fontSize: '16px' }}>🔐</span>
              <span>Handset not enrolled. Scan KDS QR or enter code.</span>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              <button
                onClick={() => setShowScannerModal(true)}
                className="btn btn-primary btn-sm"
                style={{ padding: '5px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <QrCode size={13} />
                <span>Scan QR</span>
              </button>
              <button
                onClick={() => {
                  if (!manualIpInput) {
                    setManualIpInput(hubUrl.replace(/^https?:\/\//, ''));
                  }
                  setShowPairModal(true);
                }}
                className="btn btn-ghost btn-sm"
                style={{ padding: '5px 8px', fontSize: '11px', border: '1px solid currentColor' }}
              >
                Enter Code
              </button>
            </div>
          </div>
        )}

        {/* Unreachable Hub Offline Banner */}
        {connStatus === 'disconnected' && (
          <div className="banner banner-error" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--color-error-border)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <WifiOff size={16} style={{ flexShrink: 0 }} />
              <span>Not connected to kitchen hub. Tap to pair.</span>
            </div>
            <button
              onClick={() => {
                if (!manualIpInput) {
                  setManualIpInput(hubUrl.replace(/^https?:\/\//, ''));
                }
                setShowPairModal(true);
              }}
              className="btn btn-danger btn-sm banner-connect-btn"
            >
              Connect
            </button>
          </div>
        )}

        {/* Uninitialized Cache & Offline Failure Banner */}
        {(hubMenuUninitialized || posMenuUninitialized) && (
          <div className="banner banner-warning" style={{
            borderBottom: '1px solid var(--color-warning-border)',
            display: 'flex', alignItems: 'center', gap: '10px'
          }}>
            <span style={{ fontSize: '16px' }}>⚠️</span>
            <span>No menu data available — connect this hub to the internet once to complete setup.</span>
          </div>
        )}

        {/* Pairing Modal Flow */}
        {showPairModal && (
          <div className="modal-overlay" style={{
            position: 'absolute', inset: 0, zIndex: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
          }}>
            <div className="modal-content" style={{
              width: '100%', maxWidth: '340px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <Server size={22} style={{ color: 'var(--color-primary)' }} />
                <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--color-ink)', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                  Connect to Kitchen Hub
                </h3>
              </div>

              <p style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: 0, marginBottom: '14px' }}>
                Scan the QR code displayed on the Kitchen Display screen, or enter the 6-character enrollment code below.
              </p>

              {/* Instant Camera QR Scanner Trigger */}
              <button
                type="button"
                onClick={() => {
                  setShowPairModal(false);
                  setShowScannerModal(true);
                }}
                className="btn btn-primary"
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: '8px', padding: '11px', marginBottom: '12px', fontSize: '13px', fontWeight: 700
                }}
              >
                <QrCode size={17} />
                <span>Scan Kitchen Display QR Code</span>
              </button>

              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0 12px',
                color: 'var(--color-muted)', fontSize: '10px', fontWeight: 600, letterSpacing: '1px'
              }}>
                <div style={{ flex: 1, height: '1px', background: 'var(--color-hairline)' }} />
                <span>OR ENTER MANUALLY</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--color-hairline)' }} />
              </div>

              <form onSubmit={handlePairSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label className="form-label">
                    Hub LAN IP or URL
                  </label>
                  <input
                    type="text"
                    value={manualIpInput}
                    onChange={e => setManualIpInput(e.target.value)}
                    placeholder={hubUrl.replace(/^https?:\/\//, '') || "e.g. 192.168.1.50:4000"}
                    className="input"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                  <div className="typography-body-sm" style={{ color: 'var(--color-muted)', marginTop: '2px', fontSize: '10px' }}>
                    Hub address: {hubUrl.replace(/^https?:\/\//, '')}
                  </div>
                </div>

                {!isEnrolled && (
                  <div>
                    <label className="form-label" style={{ fontWeight: 700 }}>
                      Enrollment Code
                    </label>
                    <input
                      type="text"
                      value={enrollCodeInput}
                      onChange={e => setEnrollCodeInput(e.target.value.toUpperCase())}
                      placeholder="e.g. 9KZXEC"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      autoFocus
                      className="input"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '3px',
                        fontSize: '16px',
                        fontWeight: 700,
                        textAlign: 'center',
                        textTransform: 'uppercase'
                      }}
                    />
                    <div className="typography-body-sm" style={{ color: 'var(--color-muted)', marginTop: '4px', fontSize: '11px' }}>
                      Check Kitchen Display (KDS) screen for the code (e.g. <strong>9KZXEC</strong>).
                    </div>
                  </div>
                )}

                {pairError && (
                  <div style={{ color: 'var(--color-error-text)', fontSize: '11px', fontWeight: 600 }}>
                    ⚠️ {pairError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setShowPairModal(false)}
                    className="btn btn-ghost"
                    style={{ flex: 1 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isTestingConn}
                    className="btn btn-primary"
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  >
                    {isTestingConn ? <RefreshCw size={14} className="spin" /> : 'Connect & Unlock'}
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
                isLoading={connStatus === 'connecting' && liveTables.length === 0}
                drafts={drafts}
                onOpenPairing={() => {
                  if (!manualIpInput) {
                    setManualIpInput(hubUrl.replace(/^https?:\/\//, ''));
                  }
                  setShowPairModal(true);
                }}
                hubConnected={hubConnected}
                connStatus={connStatus}
                isEnrolled={isEnrolled}
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
                padding: '8px 4px', borderRadius: 'var(--radius-sm)',
                color: activeTab === nav.id ? 'var(--color-primary)' : 'var(--color-muted)',
                background: 'transparent',
                fontSize: '11px', fontWeight: activeTab === nav.id ? 700 : 500, position: 'relative',
                transition: 'all 0.15s ease', border: 'none', cursor: 'pointer'
              }}
            >
              <nav.icon size={20} strokeWidth={activeTab === nav.id ? 2.5 : 1.8} />
              {nav.label}
              {activeTab === nav.id && (
                <span style={{
                  position: 'absolute', bottom: '0', left: '50%', transform: 'translateX(-50%)',
                  width: '20px', height: '3px', borderRadius: '2px',
                  background: 'var(--color-primary)'
                }} />
              )}
              {nav.badge > 0 && (
                <span style={{
                  position: 'absolute', top: '2px', right: '14px',
                  background: 'var(--color-primary)',
                  color: 'var(--color-on-primary)', fontSize: '9px', fontWeight: 700, borderRadius: 'var(--radius-full)',
                  padding: '1px 6px', fontFamily: 'var(--font-mono)'
                }}>
                  {nav.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* In-App Camera QR Code Scanner Modal */}
        <QrScannerModal
          isOpen={showScannerModal}
          onClose={() => setShowScannerModal(false)}
          onScanSuccess={handleScanSuccess}
          hubUrl={hubUrl}
        />
      </div>
    </div>
  );
};
