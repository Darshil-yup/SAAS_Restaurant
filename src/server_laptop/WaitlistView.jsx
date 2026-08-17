import React, { useState } from 'react';
import { usePos } from '../context/PosContext';
import { Users, Clock, Plus, CheckCircle2, UserX, Armchair } from 'lucide-react';

export const WaitlistView = () => {
  const { waitlist, addWaitlistEntry, updateWaitlistStatus, tables } = usePos();
  
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [partySize, setPartySize] = useState(4);
  const [section, setSection] = useState('Main Hall');
  const [selectedAssignedTable, setSelectedAssignedTable] = useState({});

  const availableTables = tables.filter(t => t.status === 'available');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    // Estimate turnaround time (e.g. 5 mins per waiting party + 10 mins baseline)
    const activeWaitingCount = waitlist.filter(w => w.status === 'waiting').length;
    const estimatedWaitMins = Math.max(5, 10 + activeWaitingCount * 5);

    addWaitlistEntry({
      name,
      phone,
      partySize: Number(partySize),
      section,
      estimatedWaitMins
    });

    setName('');
    setPhone('');
    setPartySize(4);
  };

  const handleSeatParty = (waitlistId) => {
    const tableId = selectedAssignedTable[waitlistId];
    if (!tableId) return;
    updateWaitlistStatus(waitlistId, 'seated', Number(tableId));
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '20px' }}>
      {/* Add Walk-in Form */}
      <div className="card" style={{
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--color-hairline)', paddingBottom: '12px' }}>
          <Users size={20} style={{ color: 'var(--color-primary)' }} />
          <h2 className="typography-display-md" style={{ margin: 0, color: 'var(--color-ink)' }}>
            Log Walk-In Party
          </h2>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label className="typography-caption-sm" style={{ fontWeight: 600, color: 'var(--color-muted)' }}>
              Guest / Family Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Patil Family"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              style={{ marginTop: '4px', height: '48px' }}
            />
          </div>

          <div>
            <label className="typography-caption-sm" style={{ fontWeight: 600, color: 'var(--color-muted)' }}>
              Phone Number
            </label>
            <input
              type="text"
              placeholder="e.g. 98220XXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input"
              style={{ marginTop: '4px', height: '48px' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label className="typography-caption-sm" style={{ fontWeight: 600, color: 'var(--color-muted)' }}>
                Party Size
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={partySize}
                onChange={(e) => setPartySize(e.target.value)}
                className="input"
                style={{ marginTop: '4px', height: '48px', fontFamily: 'var(--font-mono)' }}
              />
            </div>

            <div>
              <label className="typography-caption-sm" style={{ fontWeight: 600, color: 'var(--color-muted)' }}>
                Seating Area
              </label>
              <select
                value={section}
                onChange={(e) => setSection(e.target.value)}
                className="input"
                style={{ marginTop: '4px', height: '48px', fontSize: '13px' }}
              >
                <option value="Main Hall">Main Hall</option>
                <option value="AC Room">AC Room</option>
                <option value="Family Room">Family Room</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ marginTop: '8px', height: '48px' }}
          >
            <Plus size={16} /> Add to Queue
          </button>
        </form>
      </div>

      {/* Waitlist Log & Table Assignment */}
      <div className="card" style={{
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-hairline)', paddingBottom: '12px' }}>
          <h2 className="typography-display-md" style={{ margin: 0, color: 'var(--color-ink)' }}>
            Digital Queue & Turnaround Estimator
          </h2>
          <div className="typography-body-sm" style={{ color: 'var(--color-muted)' }}>
            Waiting Parties: <strong style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-mono)' }}>{waitlist.filter(w => w.status === 'waiting').length}</strong>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {waitlist.length === 0 ? (
            <div className="typography-body-sm" style={{ color: 'var(--color-muted)', textAlign: 'center', padding: '36px', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-md)' }}>
              No parties currently waiting. Log walk-ins on the left panel.
            </div>
          ) : (
            waitlist.map(entry => {
              const isWaiting = entry.status === 'waiting';

              return (
                <div
                  key={entry.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                    background: 'var(--color-surface-soft)',
                    border: '1px solid var(--color-hairline)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px 16px',
                    opacity: isWaiting ? 1 : 0.65
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: 'var(--radius-full)',
                      background: isWaiting ? 'var(--status-amber-bg)' : 'var(--color-surface-strong)',
                      color: isWaiting ? 'var(--color-primary)' : 'var(--color-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '14px',
                      fontFamily: 'var(--font-mono)'
                    }}>
                      {entry.partySize}p
                    </div>
                    <div>
                      <div className="typography-title-md" style={{ color: 'var(--color-ink)' }}>
                        {entry.name} <span className="typography-body-sm" style={{ color: 'var(--color-muted)' }}>({entry.phone || 'No phone'})</span>
                      </div>
                      <div className="typography-body-sm" style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>Area: <strong style={{ color: 'var(--color-ink)' }}>{entry.section}</strong></span>
                        <span>•</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={12} /> Est Wait: <strong style={{ color: 'var(--color-primary)' }}>~{entry.estimatedWaitMins} mins</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  {isWaiting ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <select
                        onChange={(e) => setSelectedAssignedTable(prev => ({ ...prev, [entry.id]: e.target.value }))}
                        defaultValue=""
                        className="input"
                        style={{
                          height: '40px',
                          padding: '0 10px',
                          fontSize: '12px',
                          width: '180px'
                        }}
                      >
                        <option value="" disabled>Assign Open Table</option>
                        {availableTables.map(t => (
                          <option key={t.id} value={t.id}>
                            Table {t.name} ({t.section} - {t.capacity} seats)
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={() => handleSeatParty(entry.id)}
                        disabled={!selectedAssignedTable[entry.id]}
                        className="btn btn-primary"
                        style={{
                          height: '40px',
                          padding: '0 14px',
                          fontSize: '13px'
                        }}
                      >
                        <Armchair size={14} /> Seat Party
                      </button>

                      <button
                        onClick={() => updateWaitlistStatus(entry.id, 'cancelled')}
                        className="btn btn-ghost"
                        style={{
                          height: '40px',
                          padding: '0 10px',
                          color: 'var(--status-rust-text)',
                          borderColor: 'var(--status-rust-border)'
                        }}
                      >
                        <UserX size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="typography-uppercase-tag" style={{
                      color: entry.status === 'seated' ? 'var(--status-green-text)' : 'var(--color-muted)'
                    }}>
                      {entry.status === 'seated' ? `Seated at Table T${entry.assignedTableId}` : 'Cancelled'}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
