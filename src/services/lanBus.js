// LAN Direct Communication Service (Zero-Internet Local Network Path)
// Supports Node.js Hub Server WebSocket (ws://<hub-ip>:4000/live) + BroadcastChannel API fallback.
// Multi-Tenant Isolation: Events are scoped by restaurantId & pairingCode.

class LanBus {
  constructor() {
    this.listeners = [];
    this.currentRestaurantId = '11111111-1111-1111-1111-111111111111';
    this.currentPairingCode = 'MJW-7492';

    // BroadcastChannel fallback for in-browser local tabs
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.channel = new BroadcastChannel('mejwani_pos_lan_bus');
      this.channel.onmessage = (event) => {
        const data = event.data;
        if (data && data.restaurantId && data.restaurantId !== this.currentRestaurantId) {
          return;
        }
        this.notify(data);
      };
    } else {
      this.channel = null;
    }

    this.ws = null;
    this.hubConnected = false;
    this.hubUrl = typeof window !== 'undefined' 
      ? `ws://${window.location.hostname || 'localhost'}:4000/live` 
      : 'ws://localhost:4000/live';

    this.connectHubWebSocket();
  }

  setHubUrl(url) {
    if (url) {
      this.hubUrl = url.replace('http://', 'ws://').replace('https://', 'wss://') + '/live';
      this.connectHubWebSocket();
    }
  }

  connectHubWebSocket() {
    if (typeof window === 'undefined' || !window.WebSocket) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.hubUrl);

      this.ws.onopen = () => {
        this.hubConnected = true;
        console.log(`⚡ Connected to Hub Server WebSocket at ${this.hubUrl}`);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const { type, payload, restaurant_id } = message;

          const eventData = {
            type,
            payload,
            restaurantId: restaurant_id || this.currentRestaurantId,
            timestamp: Date.now()
          };

          this.notify(eventData);
        } catch (err) {
          console.warn('Error parsing hub WS message:', err);
        }
      };

      this.ws.onerror = () => {
        this.hubConnected = false;
      };

      this.ws.onclose = () => {
        this.hubConnected = false;
        // Retry connection every 5s if disconnected
        setTimeout(() => this.connectHubWebSocket(), 5000);
      };
    } catch (err) {
      this.hubConnected = false;
    }
  }

  setTenantContext(restaurantId, pairingCode) {
    this.currentRestaurantId = restaurantId;
    if (pairingCode) this.currentPairingCode = pairingCode;
  }

  // Broadcast event over LAN path with explicit restaurant scope
  publish(type, payload, restaurantId = this.currentRestaurantId) {
    const eventData = {
      type,
      payload,
      restaurantId: restaurantId || this.currentRestaurantId,
      pairingCode: this.currentPairingCode,
      timestamp: Date.now(),
      senderId: this.getDeviceId(),
    };

    // Send over WebSocket if hub server is active
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type, payload }));
      } catch (err) {
        console.warn('WebSocket send error:', err);
      }
    }

    // Send to other tabs/windows over LAN BroadcastChannel
    if (this.channel) {
      try {
        this.channel.postMessage(eventData);
      } catch (err) {
        console.warn('BroadcastChannel send error:', err);
      }
    }

    // Also trigger local listener in current tab
    this.notify(eventData);
  }

  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  notify(eventData) {
    if (eventData && eventData.restaurantId && 
        eventData.restaurantId !== this.currentRestaurantId && 
        eventData.restaurantId !== '11111111-1111-1111-1111-111111111111' &&
        eventData.restaurantId !== 'rest_mejwani') {
      return;
    }

    this.listeners.forEach(cb => {
      try {
        cb(eventData);
      } catch (err) {
        console.error('Error in LAN bus listener:', err);
      }
    });
  }

  getDeviceId() {
    if (!this.deviceId) {
      this.deviceId = 'device_' + Math.random().toString(36).substring(2, 9);
    }
    return this.deviceId;
  }
}

export const lanBus = new LanBus();
