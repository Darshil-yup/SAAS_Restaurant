import React from 'react';
import { usePos } from '../context/PosContext';
import { Users, Clock } from 'lucide-react';

const STATUS = {
  available: { label: 'Open',       color: 'var(--status-green-text)',  bg: 'var(--status-green-bg)', border: 'var(--status-green-border)' },
  occupied:  { label: 'Dining',     color: 'var(--status-rust-text)',   bg: 'var(--status-rust-bg)',  border: 'var(--status-rust-border)'  },
  kot:       { label: 'In Kitchen', color: 'var(--status-amber-text)',  bg: 'var(--status-amber-bg)', border: 'var(--status-amber-border)' },
  ready:     { label: 'Bill Ready', color: 'var(--status-blue-text)',   bg: 'var(--status-blue-bg)',  border: 'var(--status-blue-border)'  },
};

const elapsed = (iso) => {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? 'Just in' : `${m}m`;
};

// Section 6.2 Skeleton Screen Loader for Floor Grid
export const FloorGridSkeleton = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px' }}>
    {[1, 2, 3, 4, 5, 6].map(i => (
      <div key={i} className="skeleton skeleton-card" style={{ borderRadius: 'var(--radius-md)' }} />
    ))}
  </div>
);

export const FloorGrid = ({ selectedTable, onSelectTable, tables: propTables, onClearTableBill, isLoading = false }) => {
  const contextPos = usePos() || {};
  const tables = propTables || contextPos.tables || [];
  const clearTableBill = onClearTableBill || contextPos.clearTableBill;
  const [selectedSection, setSelectedSection] = React.useState('All');
  const sections = ['All', 'Main Hall', 'AC Room', 'Family Room'];
  const shown = selectedSection === 'All' ? tables : tables.filter(t => t.section === selectedSection);


  if (isLoading) {
    return <FloorGridSkeleton />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Section Pills */}
      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
        {sections.map(s => (
          <button
            key={s}
            onClick={() => setSelectedSection(s)}
            style={{
              padding: '5px 12px', borderRadius: 'var(--radius-full)', fontSize: '12px',
              fontWeight: 500, whiteSpace: 'nowrap',
              background: selectedSection === s ? 'var(--color-primary)' : 'var(--color-surface-soft)',
              color: selectedSection === s ? '#ffffff' : 'var(--color-muted)',
              border: `1px solid ${selectedSection === s ? 'var(--color-primary)' : 'var(--color-hairline)'}`,
              transition: 'all 0.15s ease', cursor: 'pointer'
            }}
          >{s}</button>
        ))}
      </div>

      {/* Table Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px' }}>
        {shown.map(t => {
          const st = STATUS[t.status] || STATUS.available;
          const sel = selectedTable === t.id;
          const mins = elapsed(t.occupiedSince);

          return (
            <div
              key={t.id}
              onClick={() => onSelectTable(t.id)}
              className={`table-card${sel ? ' selected' : ''}`}
            >
              {/* Status Dot */}
              <span style={{
                position: 'absolute', top: '8px', right: '8px',
                width: '7px', height: '7px', borderRadius: '50%',
                background: st.color,
              }} />

              {/* Table Name (title-md: Cabinet Grotesk 16px/600) */}
              <div className="typography-title-md" style={{ color: 'var(--color-ink)', letterSpacing: '-0.3px' }}>
                {t.name}
              </div>

              <div className="typography-body-sm" style={{ fontSize: '11px', color: 'var(--color-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px' }}>
                <Users size={10} /> {t.capacity}p
              </div>

              {/* Status Tag (uppercase-tag: 8px/700 tracked Instrument Sans) */}
              <div
                className="typography-uppercase-tag"
                style={{
                  marginTop: '6px',
                  display: 'inline-block',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-full)',
                  background: st.bg,
                  color: st.color,
                  border: `1px solid ${st.border}`
                }}
              >
                {st.label}
              </div>

              {t.activeOrderTotal > 0 && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)', marginTop: '4px' }}>
                  ₹{t.activeOrderTotal}
                </div>
              )}

              {mins && (
                <div className="typography-body-sm" style={{ fontSize: '10px', color: 'var(--color-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px' }}>
                  <Clock size={9} /> {mins}
                </div>
              )}

              {t.status === 'ready' && (
                <button
                  onClick={e => { e.stopPropagation(); clearTableBill(t.id); }}
                  className="typography-uppercase-tag"
                  style={{
                    marginTop: '6px', width: '100%', padding: '4px 0',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--status-blue-bg)', color: 'var(--status-blue-text)',
                    border: '1px solid var(--status-blue-border)', cursor: 'pointer'
                  }}
                >
                  Clear Bill
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
