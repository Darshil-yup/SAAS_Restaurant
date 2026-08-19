import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { ChefHat, CheckCircle2, AlertCircle, Wifi, Cloud, Flame, Timer, RefreshCw, QrCode } from 'lucide-react';
import './index.css';

const KitchenHubApp = () => {
  const [pairingInfo, setPairingInfo] = useState(null);
  const [qrCodeUrl, setQrCodeUrl] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [syncStatus, setSyncStatus] = useState({ queued: 0, online: true, isSyncing: false });
  const [wsConnStatus, setWsConnStatus] = useState('connecting'); // 'connecting' | 'connected' | 'disconnected'
  const wsConnected = wsConnStatus === 'connected';
  const missedWsFailuresRef = useRef(0);
  const isGracePeriodRef = useRef(true);
  const [checkedItems, setCheckedItems] = useState({});
  const [loading, setLoading] = useState(true);

  const hubHost = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000';

  // 1. Fetch Pairing & QR Info
  const fetchPairing = async () => {
    try {
      const res = await fetch(`${hubHost}/pairing-info`);
      if (res.ok) {
        const data = await res.json();
        setPairingInfo(data);
      }
    } catch (err) {
      console.warn('Could not fetch pairing info:', err);
    }
  };

  const fetchQr = async () => {
    try {
      const res = await fetch(`${hubHost}/qr`);
      if (res.ok) {
        const data = await res.json();
        setQrCodeUrl(data.qr_code);
      }
    } catch (err) {
      console.warn('Could not fetch QR code:', err);
    }
  };

  // 2. Fetch Active Tickets
  const fetchActiveTickets = async () => {
    try {
      const res = await fetch(`${hubHost}/orders/active`);
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } catch (err) {
      console.warn('Could not fetch active tickets:', err);
    } finally {
      setLoading(false);
    }
  };

  // 3. Fetch Sync Status
  const fetchSyncStatus = async () => {
    try {
      const res = await fetch(`${hubHost}/sync-status`);
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(data);
      }
    } catch (err) {
      console.warn('Could not fetch sync status:', err);
    }
  };

  // 4. Setup WebSocket Connection
  useEffect(() => {
    isGracePeriodRef.current = true;
    const graceTimer = setTimeout(() => {
      isGracePeriodRef.current = false;
      if (missedWsFailuresRef.current >= 2) {
        setWsConnStatus('disconnected');
      }
    }, 3000);

    fetchPairing();
    fetchQr();
    fetchActiveTickets();
    fetchSyncStatus();

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/live`;
    let ws;

    const connectWs = () => {
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          missedWsFailuresRef.current = 0;
          setWsConnStatus('connected');
          console.log('⚡ Connected to Hub Server WebSocket');
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'NEW_ORDER') {
              const newTicket = msg.payload;
              setTickets(prev => {
                const exists = prev.some(t => t.id === newTicket.id || t.ticket_number === newTicket.ticket_number);
                if (exists) return prev;
                return [newTicket, ...prev];
              });
            } else if (msg.type === 'TICKET_READY') {
              const readyTicket = msg.payload;
              setTickets(prev => prev.map(t => {
                if (t.id === readyTicket.ticket_id || String(t.ticket_number) === String(readyTicket.ticket_number)) {
                  return { ...t, status: 'ready' };
                }
                return t;
              }));
            } else if (msg.type === 'SYNC_STATUS_CHANGE') {
              setSyncStatus(msg.payload);
              // Refresh tickets to update synced_to_cloud badge
              fetchActiveTickets();
            }
          } catch (err) {
            console.warn('Malformed WS message:', err);
          }
        };

        ws.onclose = () => {
          missedWsFailuresRef.current += 1;
          if (!isGracePeriodRef.current || missedWsFailuresRef.current >= 2) {
            setWsConnStatus('disconnected');
          } else {
            setWsConnStatus('connecting');
          }
          setTimeout(connectWs, 3000);
        };

        ws.onerror = () => {
          if (ws) ws.close();
        };
      } catch (err) {
        missedWsFailuresRef.current += 1;
        if (!isGracePeriodRef.current || missedWsFailuresRef.current >= 2) {
          setWsConnStatus('disconnected');
        }
      }
    };

    connectWs();

    // Poll sync status & tickets periodically as fallback
    const interval = setInterval(() => {
      fetchSyncStatus();
      fetchActiveTickets();
    }, 10000);

    return () => {
      clearTimeout(graceTimer);
      if (ws) ws.close();
      clearInterval(interval);
    };
  }, []);

  // Mark ticket ready
  const handleMarkReady = async (ticket) => {
    try {
      const res = await fetch(`${hubHost}/orders/${ticket.id || ticket.ticket_number}/ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        setTickets(prev => prev.map(t => {
          if (t.id === ticket.id || t.ticket_number === ticket.ticket_number) {
            return { ...t, status: 'ready' };
          }
          return t;
        }));
      }
    } catch (err) {
      console.error('Failed to mark ticket ready:', err);
    }
  };

  const toggleCheck = (ticketId, idx) => {
    const key = `${ticketId}_${idx}`;
    setCheckedItems(p => ({ ...p, [key]: !p[key] }));
  };

  const allChecked = (ticket) => {
    if (!ticket.items || !ticket.items.length) return true;
    return ticket.items.every((_, idx) => checkedItems[`${ticket.id}_${idx}`]);
  };

  const activeTickets = tickets.filter(t => t.status === 'in_progress');
  const readyTickets = tickets.filter(t => t.status === 'ready');

  return (
    <div style={{ minHeight: '100vh', background: '#090d16', color: '#f1f5f9', fontFamily: 'Outfit, sans-serif', padding: '24px' }}>
      {/* Top Navigation / Header */}
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: '#111827', border: '1px solid #1f2937', borderRadius: '16px',
        padding: '16px 24px', marginBottom: '24px', flexWrap: 'wrap', gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#3b82f6', width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>
            👨‍🍳
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 800, letterSpacing: '-0.5px' }}>
              Kitchen Hub Display
            </h1>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '2px' }}>
              {pairingInfo ? `${pairingInfo.name} (${pairingInfo.pairing_code})` : 'Connecting to Reception Hub...'}
            </div>
          </div>
        </div>

        {/* Live System Status Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* LAN Connection Badge */}
          <div style={{
            background: wsConnStatus === 'connected' ? 'rgba(16, 185, 129, 0.15)' : wsConnStatus === 'connecting' ? 'rgba(148, 163, 184, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            border: `1px solid ${wsConnStatus === 'connected' ? '#10b981' : wsConnStatus === 'connecting' ? '#64748b' : '#ef4444'}`,
            color: wsConnStatus === 'connected' ? '#10b981' : wsConnStatus === 'connecting' ? '#94a3b8' : '#ef4444',
            padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'JetBrains Mono, monospace'
          }}>
            {wsConnStatus === 'connecting' ? (
              <RefreshCw size={14} className="spin" />
            ) : (
              <Wifi size={14} />
            )}
            {wsConnStatus === 'connected' ? 'LAN WiFi Active' : wsConnStatus === 'connecting' ? 'Connecting…' : 'LAN Disconnected'}
          </div>

          {/* Cloud Sync Status Badge */}
          <div style={{
            background: syncStatus.online ? (syncStatus.queued > 0 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)') : 'rgba(245, 158, 11, 0.15)',
            border: `1px solid ${syncStatus.online ? (syncStatus.queued > 0 ? '#f59e0b' : '#10b981') : '#f59e0b'}`,
            color: syncStatus.online ? (syncStatus.queued > 0 ? '#f59e0b' : '#10b981') : '#f59e0b',
            padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'JetBrains Mono, monospace'
          }}>
            <Cloud size={14} />
            {syncStatus.online 
              ? (syncStatus.queued > 0 ? `Cloud Queue (${syncStatus.queued})` : 'Cloud Synced')
              : `Local Only (${syncStatus.queued} queued)`}
          </div>

          <button
            onClick={() => { fetchActiveTickets(); fetchSyncStatus(); }}
            style={{ background: '#1f2937', color: '#94a3b8', border: '1px solid #374151', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600 }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </header>

      {/* Main Grid: Left side pairing card, Right side live KOT tickets */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 320px) 1fr', gap: '24px', alignItems: 'start' }}>
        
        {/* Left Column: Waiter Pairing QR Code & Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: '16px', padding: '20px', textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '13px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
              <QrCode size={16} /> Waiter Pairing QR Code
            </div>
            
            {qrCodeUrl ? (
              <div style={{ background: '#ffffff', padding: '12px', borderRadius: '12px', display: 'inline-block', marginBottom: '12px' }}>
                <img src={qrCodeUrl} alt="Waiter App Pairing QR" style={{ width: '180px', height: '180px', display: 'block' }} />
              </div>
            ) : (
              <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>Generating QR...</div>
            )}

            <div style={{ fontSize: '13px', color: '#cbd5e1', fontWeight: 600 }}>
              Scan with Waiter Phone Camera
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', fontFamily: 'JetBrains Mono, monospace' }}>
              LAN Address: {pairingInfo?.server_url || hubHost}/waiter
            </div>
            <div style={{ marginTop: '12px', background: '#1e293b', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', color: '#94a3b8' }}>
              Pairing Code: <strong style={{ color: '#38bdf8', fontFamily: 'JetBrains Mono, monospace' }}>{pairingInfo?.pairing_code || '---'}</strong>
            </div>
          </div>

          {/* Quick Metrics Card */}
          <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: '16px', padding: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '12px' }}>
              Kitchen Summary
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', padding: '12px', borderRadius: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#f59e0b', fontFamily: 'JetBrains Mono, monospace' }}>{activeTickets.length}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', fontWeight: 600 }}>ACTIVE KOTS</div>
              </div>
              <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '12px', borderRadius: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#10b981', fontFamily: 'JetBrains Mono, monospace' }}>{readyTickets.length}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', fontWeight: 600 }}>READY TO SERVE</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live KOT Rail */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>
              Live Order Tickets ({activeTickets.length})
            </h2>
            <span style={{ fontSize: '12px', color: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}>
              Instant LAN WebSocket Push
            </span>
          </div>

          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading active KOTs...</div>
          ) : activeTickets.length === 0 ? (
            <div style={{
              background: '#111827', border: '1px dashed #374151', borderRadius: '16px', padding: '60px 20px',
              textAlign: 'center', color: '#94a3b8'
            }}>
              <ChefHat size={40} style={{ color: '#475569', marginBottom: '12px' }} />
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#f1f5f9' }}>Kitchen Rail Clear</div>
              <div style={{ fontSize: '13px', marginTop: '4px', color: '#64748b' }}>
                Orders placed on waiter phones will pop up here in real time.
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {activeTickets.map(ticket => {
                const canMark = allChecked(ticket);
                return (
                  <div key={ticket.id || ticket.ticket_number} style={{
                    background: '#111827', border: '1px solid #1f2937', borderRadius: '14px',
                    padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between'
                  }}>
                    <div>
                      {/* Ticket Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #1f2937', paddingBottom: '10px', marginBottom: '12px' }}>
                        <div>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#f59e0b', fontFamily: 'JetBrains Mono, monospace' }}>
                            TICKET #{ticket.ticket_number}
                          </span>
                          <div style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', marginTop: '2px' }}>
                            {ticket.table_name || 'Table'}
                          </div>
                        </div>
                        <span style={{ fontSize: '11px', background: ticket.synced_to_cloud ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)', color: ticket.synced_to_cloud ? '#10b981' : '#f59e0b', padding: '3px 8px', borderRadius: '4px', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                          {ticket.synced_to_cloud ? '✓ Synced' : '⏳ Queued'}
                        </span>
                      </div>

                      {/* Items Checklist */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                        {ticket.items && ticket.items.map((item, idx) => {
                          const isChecked = !!checkedItems[`${ticket.id}_${idx}`];
                          return (
                            <div
                              key={idx}
                              onClick={() => toggleCheck(ticket.id, idx)}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                                opacity: isChecked ? 0.4 : 1, textDecoration: isChecked ? 'line-through' : 'none'
                              }}
                            >
                              <div style={{
                                width: '18px', height: '18px', borderRadius: '4px',
                                border: `1.5px solid ${isChecked ? '#10b981' : '#475569'}`,
                                background: isChecked ? '#10b981' : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#fff', fontSize: '10px', fontWeight: 800
                              }}>
                                {isChecked && '✓'}
                              </div>
                              <span style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
                                {item.qty > 1 && <strong style={{ color: '#38bdf8' }}>{item.qty}× </strong>}
                                {item.name}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {ticket.note && (
                        <div style={{ background: '#1e293b', padding: '8px 10px', borderRadius: '6px', fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', marginBottom: '12px', borderLeft: '3px solid #f59e0b' }}>
                          📝 {ticket.note}
                        </div>
                      )}
                    </div>

                    {/* Bottom Action */}
                    <div style={{ borderTop: '1px solid #1f2937', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>
                        By {ticket.created_by_waiter || 'Waiter'}
                      </span>
                      <button
                        onClick={() => handleMarkReady(ticket)}
                        disabled={!canMark}
                        style={{
                          background: canMark ? '#10b981' : '#1e293b',
                          color: canMark ? '#ffffff' : '#64748b',
                          border: 'none', padding: '8px 14px', borderRadius: '8px',
                          fontWeight: 700, fontSize: '13px', cursor: canMark ? 'pointer' : 'not-allowed'
                        }}
                      >
                        {canMark ? '✓ Mark Ready' : 'Tick All'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Ready Tickets Section */}
          {readyTickets.length > 0 && (
            <div style={{ marginTop: '32px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#10b981', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckCircle2 size={18} /> Ready to Serve ({readyTickets.length})
              </h3>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {readyTickets.map(t => (
                  <div key={t.id || t.ticket_number} style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '10px 14px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <CheckCircle2 size={16} style={{ color: '#10b981' }} />
                    <div>
                      <strong style={{ color: '#f8fafc', fontSize: '13px' }}>{t.table_name || 'Table'}</strong>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>Ticket #{t.ticket_number} · Ready</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <KitchenHubApp />
  </React.StrictMode>
);
