import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase, checkSupabaseConnection, authenticateHubStaff } from './supabaseClient.js';
import { ticketStore } from './ticketStore.js';
import { hubConfig } from './hubConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'sync_queue.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class SyncQueue {
  constructor() {
    this.queue = this.loadQueue();
    this.isOnline = true;
    this.isSyncing = false;
    this.lastSyncedAt = null;
    this.onStatusChangeCallbacks = [];
  }

  loadQueue() {
    try {
      if (fs.existsSync(QUEUE_FILE)) {
        const raw = fs.readFileSync(QUEUE_FILE, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn('⚠️ Could not load sync_queue.json:', err.message);
    }
    return [];
  }

  saveQueue(queueList) {
    this.queue = queueList;
    this.notifyStatusChange();
    // Non-blocking async write to disk
    fs.promises.writeFile(QUEUE_FILE, JSON.stringify(queueList, null, 2), 'utf-8')
      .catch(err => console.error('❌ Async save queue error:', err));
    return true;
  }

  onStatusChange(callback) {
    this.onStatusChangeCallbacks.push(callback);
    return () => {
      this.onStatusChangeCallbacks = this.onStatusChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  notifyStatusChange() {
    const status = this.getStatus();
    this.onStatusChangeCallbacks.forEach(cb => {
      try {
        cb(status);
      } catch (err) {
        console.error('Error in sync status change callback:', err);
      }
    });
  }

  getStatus() {
    return {
      queued: this.queue.length,
      online: this.isOnline,
      isSyncing: this.isSyncing,
      last_synced_at: this.lastSyncedAt
    };
  }

  enqueueTicket(ticket) {
    const queueItem = {
      queue_id: 'q_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'CREATE_ORDER',
      ticket,
      queued_at: new Date().toISOString(),
      attempts: 0
    };
    const updated = [...this.queue, queueItem];
    this.saveQueue(updated);
    // Trigger immediate async attempt without awaiting or blocking caller
    this.processQueue();
  }

  enqueueStatusUpdate(ticketId, newStatus, restaurantId) {
    const queueItem = {
      queue_id: 'q_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'UPDATE_STATUS',
      payload: { ticketId, status: newStatus, restaurantId },
      queued_at: new Date().toISOString(),
      attempts: 0
    };
    const updated = [...this.queue, queueItem];
    this.saveQueue(updated);
    this.processQueue();
  }

  async processQueue() {
    if (this.isSyncing) {
      return;
    }
    this.isSyncing = true;
    this.notifyStatusChange();

    try {
      const prevOnline = this.isOnline;
      const queuedCount = this.queue.length;

      // 1. Check connection state
      const connResult = await checkSupabaseConnection();
      const online = connResult.online;
      this.isOnline = online;

      if (!online) {
        if (prevOnline !== false) {
          console.warn(`[sync] ⚡ Hub Offline (Network Error): ${connResult.error?.message || 'Failed to fetch'}. ${queuedCount} item(s) queued locally.`);
        } else {
          console.warn(`[sync] ⚡ Retry attempt: Network connection unavailable (${queuedCount} order(s) pending). Retrying in 12s...`);
        }
        return;
      }

      // Reconnection detection: if previously offline and now online
      if (!prevOnline && online) {
        console.log(`[sync] 🌐 Hub Online: Internet connection verified! Draining sync queue (${queuedCount} items queued)...`);
      }

      if (!queuedCount) {
        return;
      }

      // 2. Pre-sync Auth Session & Tenant ID Audit Log
      const pairing = hubConfig.getPairingInfo();
      let sessionUser = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        sessionUser = session?.user || null;
      } catch (err) {}

      console.log(`[sync] 🔐 Pre-sync Auth Check: Auth UID=${sessionUser?.id || 'NONE'}, Restaurant ID=${pairing.restaurant_id || 'NONE'}, Paired=${pairing.paired}`);

      // Auto re-authenticate as kitchen staff if session is missing but hub is paired
      if (pairing.paired && pairing.restaurant_id && !sessionUser) {
        console.log(`[sync] 🔑 Auth session missing. Attempting re-authentication for kitchen staff (Tenant: ${pairing.restaurant_id})...`);
        const authRes = await authenticateHubStaff(pairing.restaurant_id);
        console.log(`[sync] 🔑 Auth re-authentication result:`, authRes);
      }

      // 3. Process queued items
      console.log(`[sync] 🔄 Processing ${queuedCount} queued cloud sync item(s)...`);

      const remainingQueue = [...this.queue];
      const itemsToProcess = [...this.queue];
      let syncedCount = 0;

      for (const item of itemsToProcess) {
        let success = false;

        if (item.type === 'CREATE_ORDER') {
          success = await this.syncOrderToSupabase(item.ticket).catch((err) => {
            console.error('[sync] ❌ Sync order exception:', {
              message: err.message,
              code: err.code || 'unknown',
              stack: err.stack
            });
            return false;
          });

          if (success) {
            ticketStore.markTicketSynced(item.ticket.id);
          }
        } else if (item.type === 'UPDATE_STATUS') {
          success = await this.syncStatusToSupabase(item.payload).catch((err) => {
            console.error('[sync] ❌ Sync status exception:', {
              message: err.message,
              code: err.code || 'unknown'
            });
            return false;
          });
        }

        if (success) {
          syncedCount++;
          const idx = remainingQueue.findIndex(q => q.queue_id === item.queue_id);
          if (idx !== -1) {
            remainingQueue.splice(idx, 1);
          }
          this.lastSyncedAt = new Date().toISOString();
        } else {
          item.attempts = (item.attempts || 0) + 1;
          console.warn(`[sync] ⚠️ Item ${item.queue_id} (Ticket #${item.ticket?.ticket_number || item.payload?.ticketId}) failed sync. Will retry on next interval.`);
          break; // Stop loop on failure and retry on next interval
        }
      }

      this.saveQueue(remainingQueue);

      if (syncedCount > 0) {
        console.log(`[sync] 🎉 Successfully synced ${syncedCount} item(s) to cloud. ${remainingQueue.length} remaining.`);
      }
    } catch (err) {
      console.error('[sync] ❌ Error during sync queue processing:', {
        message: err.message,
        code: err.code || err.name || 'unknown',
        stack: err.stack
      });
    } finally {
      this.isSyncing = false;
      this.notifyStatusChange();
    }
  }

  async syncOrderToSupabase(ticket) {
    try {
      const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
      const restId = isUUID(ticket.restaurant_id) ? ticket.restaurant_id : '11111111-1111-1111-1111-111111111111';

      const orderRecord = {
        restaurant_id: restId,
        table_name: ticket.table_name || 'T1',
        ticket_number: Number(ticket.ticket_number) || 101,
        status: ticket.status || 'in_progress',
        total_amount: Number(ticket.total_amount) || 0,
        note: ticket.note || '',
        created_by_waiter: ticket.created_by_waiter || 'Waiter',
        synced_to_cloud: true,
        created_at: ticket.created_at || new Date().toISOString()
      };

      if (isUUID(ticket.table_id)) {
        orderRecord.table_id = ticket.table_id;
      }

      // 1. Insert order record
      const { data: insertedOrder, error: orderErr } = await supabase
        .from('orders')
        .insert(orderRecord)
        .select('id')
        .single();

      if (orderErr) {
        console.error('[sync] ❌ Supabase Order Insert Failed:', {
          message: orderErr.message,
          code: orderErr.code || 'unknown',
          status: orderErr.status || 'unknown',
          details: orderErr.details || orderErr.hint || null,
          ticket_number: ticket.ticket_number,
          restaurant_id: restId
        });
        return false;
      }

      const dbOrderId = insertedOrder.id;

      // 2. Insert order items
      if (ticket.items && ticket.items.length > 0) {
        const itemRecords = ticket.items.map(item => ({
          order_id: dbOrderId,
          name: item.name,
          qty: Number(item.qty) || 1,
          price: Number(item.price) || 0
        }));

        const { error: itemsErr } = await supabase.from('order_items').insert(itemRecords);
        if (itemsErr) {
          console.error('[sync] ❌ Supabase Order Items Insert Failed:', {
            message: itemsErr.message,
            code: itemsErr.code || 'unknown',
            details: itemsErr.details || itemsErr.hint || null,
            ticket_number: ticket.ticket_number
          });
          return false;
        }
      }

      console.log(`[sync] ✅ Order Ticket #${ticket.ticket_number} synced to Supabase successfully.`);
      return true;
    } catch (err) {
      console.error('[sync] ❌ Sync order exception:', {
        message: err.message,
        code: err.code || err.name || 'unknown'
      });
      return false;
    }
  }

  async syncStatusToSupabase({ ticketId, status, restaurantId }) {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('ticket_number', Number(ticketId));

      if (error) {
        console.error('[sync] ❌ Supabase Status Update Failed:', {
          message: error.message,
          code: error.code || 'unknown',
          details: error.details || error.hint || null,
          ticketId,
          status
        });
        return false;
      } else {
        console.log(`[sync] ✅ Ticket #${ticketId} status updated to '${status}' on Supabase.`);
        return true;
      }
    } catch (err) {
      console.error('[sync] ❌ Sync status exception:', {
        message: err.message,
        code: err.code || err.name || 'unknown'
      });
      return false;
    }
  }

  startSyncLoop(intervalMs = 12000) {
    console.log(`⏰ Hub Cloud Sync background retry loop active (every ${intervalMs / 1000}s)`);

    const runLoop = async () => {
      try {
        await this.processQueue();
      } catch (err) {
        console.error('[sync] ❌ Retry loop execution error:', err.message || err);
      } finally {
        // ALWAYS schedule next retry loop execution regardless of success or failure
        setTimeout(runLoop, intervalMs);
      }
    };

    // Run initial check immediately
    runLoop();
  }
}

export const syncQueue = new SyncQueue();
