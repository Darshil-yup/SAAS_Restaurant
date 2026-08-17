// Supabase Cloud Sync & Queue Service
// Manages the async background sync path (Order -> Cloud)
// Queues updates during internet outages & reconciles automatically upon reconnection.

import { createClient } from '@supabase/supabase-js';

// Fallback dummy configuration if env vars are not set
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://example.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Web Audio API Chime Generator for Kitchen Display ticket arrival
export const playKitchenChime = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    // Play a dual-tone pleasant ding-dong chime
    const now = ctx.currentTime;
    
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.5);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.15); // A5
    gain2.gain.setValueAtTime(0.35, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.7);
  } catch (err) {
    console.log('Audio Context playback notice:', err);
  }
};

// Queue helper functions
export const queueSyncItem = (queue, item) => {
  return [...queue, { ...item, queuedAt: Date.now() }];
};

export const processCloudSync = async (queue, onSyncProgress, onComplete) => {
  if (!queue.length) {
    if (onComplete) onComplete();
    return [];
  }

  const remaining = [...queue];
  const syncedIds = [];

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    
    // Simulate real cloud API call latency (350ms - 500ms)
    await new Promise(res => setTimeout(res, 400));
    
    syncedIds.push(item.id);
    remaining.shift();
    
    if (onSyncProgress) {
      onSyncProgress(item.id, [...remaining]);
    }
  }

  if (onComplete) onComplete(syncedIds);
  return remaining;
};
