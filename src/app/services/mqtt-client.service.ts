import { Injectable } from '@angular/core';
import mqtt from 'mqtt';

// Declare require for Electron environment
declare const require: any;

export interface MqttConfig {
  name: string;
  host: string;
  port: number;
  path: string;
  protocol: 'ws' | 'wss' | 'mqtt' | 'mqtts';
  clientId: string;
  username: string;
  password: string;
  keepAlive: number;
  cleanSession: boolean;
  useSSL: boolean;
  connectTimeout: number;
  autoReconnect: boolean;
  mqttVersion: '3.1.1' | '5.0';
  useCertificateAuth: boolean;
  caFilePath: string;
  clientCertPath: string;
  clientKeyPath: string;
}

export interface MqttConnectionStatus {
  connected: boolean;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class MqttClientService {
  private clients: Map<number, mqtt.MqttClient> = new Map();
  private connectionStatus: Map<number, MqttConnectionStatus> = new Map();
  private messageCallbacks: Map<number, (topic: string, message: string) => void> = new Map();
  private connectionStatusCallbacks: Map<number, (connected: boolean) => void> = new Map();
  private subscriptions: Map<number, Array<{ topic: string, qos: number }>> = new Map();
  private connectingInProgress: Map<number, boolean> = new Map(); // Track ongoing connections
  private configs: Map<number, MqttConfig> = new Map(); // Store configs for reconnection
  private reconnectTimers: Map<number, any> = new Map(); // Store reconnect timers
  private reconnectAttempts: Map<number, number> = new Map(); // Track reconnection attempts
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly RECONNECT_INTERVAL = 5000; // 5 seconds
  private isElectron: boolean = false;
  private nodeMqtt: any = null;

  constructor() {
    // Detect if running in Electron with Node.js integration
    this.isElectron = typeof window !== 'undefined' &&
      ((window as any).electron?.isElectron ||
        (window as any).electron?.fs ||
        typeof (window as any).require !== 'undefined');

    console.log('MqttClientService - Electron mode:', this.isElectron);

    if (this.isElectron) {
      try {
        // Use Node.js mqtt module in Electron
        this.nodeMqtt = (window as any).require('mqtt');
        console.log('Using Node.js MQTT client in Electron mode');
      } catch (error) {
        console.warn('Failed to load Node.js mqtt module, falling back to browser mqtt:', error);
        this.nodeMqtt = mqtt;
      }
    } else {
      // Use browser mqtt in web mode
      this.nodeMqtt = mqtt;
      console.log('Using browser MQTT client in web mode');
    }
  }

  setMessageCallback(tabId: number, callback: (topic: string, message: string) => void): void {
    this.messageCallbacks.set(tabId, callback);
  }

  removeMessageCallback(tabId: number): void {
    this.messageCallbacks.delete(tabId);
  }

  setConnectionStatusCallback(tabId: number, callback: (connected: boolean) => void): void {
    this.connectionStatusCallbacks.set(tabId, callback);
  }

  async connect(tabId: number, config: MqttConfig): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        // Check if already connecting
        if (this.connectingInProgress.get(tabId)) {
          console.warn(`⚠️ Connection already in progress for tab ${tabId}, skipping duplicate request`);
          reject(new Error('Connection already in progress'));
          return;
        }

        // Mark as connecting
        this.connectingInProgress.set(tabId, true);

        // Check if there's already a connected client
        const existingClient = this.clients.get(tabId);
        const existingStatus = this.connectionStatus.get(tabId);

        // Save callbacks before disconnecting (they will be reused)
        const savedMessageCallback = this.messageCallbacks.get(tabId);
        const savedStatusCallback = this.connectionStatusCallbacks.get(tabId);

        // Only disconnect if client exists - WAIT for it to complete
        if (existingClient) {
          console.log(`🔌 Disconnecting existing client for tab ${tabId} before reconnecting`);
          console.log(`   Existing status:`, existingStatus);
          console.log(`   Saving callbacks for reuse`);
          await this.disconnect(tabId); // Wait for disconnect to complete
          console.log(`✅ Disconnected existing client for tab ${tabId}`);

          // Add a small delay to ensure all internal timers are cleared
          await new Promise(resolve => setTimeout(resolve, 100));
          console.log(`   Waited 100ms for complete cleanup`);
        }

        // Restore callbacks if they were saved
        if (savedMessageCallback) {
          this.messageCallbacks.set(tabId, savedMessageCallback);
          console.log(`   Restored message callback for tab ${tabId}`);
        }
        if (savedStatusCallback) {
          this.connectionStatusCallbacks.set(tabId, savedStatusCallback);
          console.log(`   Restored connection status callback for tab ${tabId}`);
        }

        // Store config for potential reconnection
        this.configs.set(tabId, config);
        console.log(`   Stored config for tab ${tabId} (autoReconnect: ${config.autoReconnect})`);

        // Build connection URL
        const url = `${config.protocol}://${config.host}:${config.port}`;

        // Build connection options
        const options: mqtt.IClientOptions = {
          clientId: config.clientId || `mqtt_${Math.random().toString(16).slice(3)}`,
          keepalive: config.keepAlive || 60,
          clean: config.cleanSession !== false,
          username: config.username || undefined,
          password: config.password || undefined,
          path: config.path || undefined,
          connectTimeout: (config.connectTimeout || 30) * 1000, // Convert to milliseconds
          reconnectPeriod: 0, // Disable auto-reconnect, we handle reconnection at app level
          protocolVersion: config.mqttVersion === '5.0' ? 5 : 4, // MQTT 3.1.1 = 4, MQTT 5.0 = 5
        };

        console.log(`🔧 MQTT client options: reconnectPeriod=0 (auto-reconnect disabled for better control)`);

        // Add certificate authentication if enabled (Electron only)
        if (this.isElectron && config.useCertificateAuth && (config.protocol === 'mqtt' || config.protocol === 'mqtts')) {
          try {
            const fs = (window as any).require('fs');

            if (config.caFilePath) {
              options.ca = fs.readFileSync(config.caFilePath);
              console.log('Loaded CA certificate from:', config.caFilePath);
            }

            if (config.clientCertPath) {
              options.cert = fs.readFileSync(config.clientCertPath);
              console.log('Loaded client certificate from:', config.clientCertPath);
            }

            if (config.clientKeyPath) {
              options.key = fs.readFileSync(config.clientKeyPath);
              console.log('Loaded client key from:', config.clientKeyPath);
            }

            // Reject unauthorized certificates if using self-signed
            options.rejectUnauthorized = false;
          } catch (error) {
            console.error('Error loading certificates:', error);
            reject(new Error(`Failed to load certificates: ${(error as Error).message}`));
            return;
          }
        }

        console.log('Connecting to MQTT broker:', url, {
          ...options,
          password: options.password ? '[HIDDEN]' : undefined,
          key: options.key ? '[HIDDEN]' : undefined
        });

        // Create MQTT client using appropriate module
        const mqttModule = this.nodeMqtt || mqtt;
        const client = mqttModule.connect(url, options);

        // Set a timeout for connection
        const connectionTimeout = setTimeout(() => {
          console.error(`Connection timeout for tab ${tabId}`);
          client.end(true); // Force close
          this.connectionStatus.set(tabId, {
            connected: false,
            error: 'Connection timeout - server did not respond'
          });
          reject(new Error('Connection timeout - server did not respond'));
        }, (config.connectTimeout || 30) * 1000 + 5000); // Add 5s buffer

        let isResolved = false;

        // Handle connection success
        client.on('connect', () => {
          console.log(`🔔 connect event fired for tab ${tabId}, isResolved: ${isResolved}, reconnecting: ${client.reconnecting}`);

          if (!isResolved) {
            clearTimeout(connectionTimeout);
            isResolved = true;
            console.log(`✅ MQTT connected successfully for tab ${tabId}`);
            this.clients.set(tabId, client);
            this.connectingInProgress.delete(tabId); // Clear connecting flag

            // Clear reconnect attempts on successful connection
            this.reconnectAttempts.delete(tabId);
            this.clearReconnectTimer(tabId);
            console.log(`   Cleared reconnect attempts and timer for tab ${tabId}`);

            resolve();
          } else {
            // This is a reconnection
            console.log(`🔄 MQTT reconnected for tab ${tabId}`);
            // Ensure client is in the map after reconnection
            this.clients.set(tabId, client);

            // Clear reconnect attempts on successful reconnection
            this.reconnectAttempts.delete(tabId);
            this.clearReconnectTimer(tabId);
            console.log(`   Cleared reconnect attempts and timer for tab ${tabId}`);
          }

          // Update connection status and notify (for both initial and reconnection)
          this.connectionStatus.set(tabId, { connected: true });
          const statusCallback = this.connectionStatusCallbacks.get(tabId);
          if (statusCallback) {
            console.log(`📞 Calling connectionStatusCallback(true) for tab ${tabId} - this will trigger subscription`);
            statusCallback(true);
            console.log(`📞 connectionStatusCallback completed for tab ${tabId}`);
          } else {
            console.warn(`⚠️ No connectionStatusCallback found for tab ${tabId} - subscriptions will NOT be processed!`);
          }
        });

        // Handle reconnection attempts
        client.on('reconnect', () => {
          console.log(`🔄 MQTT attempting to reconnect for tab ${tabId}...`);
          console.log(`   Client in map: ${this.clients.has(tabId)}, reconnecting: ${client.reconnecting}`);
        });

        // Handle connection errors
        client.on('error', (error: any) => {
          clearTimeout(connectionTimeout);
          console.error(`❌ MQTT connection error for tab ${tabId}:`, error);

          const errorMessage = error.message || error.toString();
          this.connectionStatus.set(tabId, {
            connected: false,
            error: errorMessage
          });

          if (!isResolved) {
            isResolved = true;
            this.connectingInProgress.delete(tabId); // Clear connecting flag on error
            reject(new Error(errorMessage));
          }
        });

        // Handle incoming messages
        client.on('message', (topic: string, payload: any) => {
          const message = payload.toString();
          console.log(`MQTT message received on tab ${tabId}, topic: ${topic}, message:`, message);
          const callback = this.messageCallbacks.get(tabId);
          if (callback) {
            callback(topic, message);
          }
        });

        // Handle disconnection
        client.on('close', () => {
          // Immediately disable reconnection on close
          (client as any).options.reconnectPeriod = 0;

          // Only process if client is still managed (not explicitly disconnected)
          if (this.clients.has(tabId)) {
            console.log(`⚠️ MQTT disconnected for tab ${tabId}`);
            console.log(`   Client still in map, but mqtt.js reconnection is disabled`);
            this.connectionStatus.set(tabId, { connected: false });

            // Clear subscriptions as server-side subscriptions are lost
            this.subscriptions.delete(tabId);
            console.log(`   Cleared subscriptions cache for tab ${tabId}`);

            // Notify connection status change
            const statusCallback = this.connectionStatusCallbacks.get(tabId);
            if (statusCallback) {
              statusCallback(false);
            }

            // Schedule app-level reconnection
            this.scheduleReconnect(tabId);
          } else {
            console.log(`⚠️ MQTT close event for tab ${tabId}, client already removed (explicit disconnect)`);
          }
        });

        // Handle offline
        client.on('offline', () => {
          // Immediately disable reconnection on offline
          (client as any).options.reconnectPeriod = 0;

          // Only process if client is still managed (not explicitly disconnected)
          if (this.clients.has(tabId)) {
            console.log(`📴 MQTT offline for tab ${tabId}`);
            console.log(`   Client still in map, but mqtt.js reconnection is disabled`);
            this.connectionStatus.set(tabId, { connected: false });

            // Clear subscriptions as server-side subscriptions are lost
            this.subscriptions.delete(tabId);
            console.log(`   Cleared subscriptions cache for tab ${tabId}`);

            // Notify connection status change
            const statusCallback = this.connectionStatusCallbacks.get(tabId);
            if (statusCallback) {
              statusCallback(false);
            }

            // Schedule app-level reconnection
            this.scheduleReconnect(tabId);
          } else {
            console.log(`📴 MQTT offline event for tab ${tabId}, client already removed (explicit disconnect)`);
          }
        });

      } catch (error) {
        console.error(`Failed to create MQTT client for tab ${tabId}:`, error);
        this.connectingInProgress.delete(tabId); // Clear connecting flag on exception
        this.connectionStatus.set(tabId, {
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        reject(error);
      }
    });
  }

  disconnect(tabId: number): Promise<void> {
    return new Promise((resolve) => {
      const client = this.clients.get(tabId);
      if (client) {
        console.log(`🔌 Disconnecting MQTT client for tab: ${tabId}`);

        // Clear app-level reconnect timer and attempts
        this.clearReconnectTimer(tabId);
        this.reconnectAttempts.delete(tabId);

        // Completely disable reconnection
        (client as any).options.reconnectPeriod = 0;
        (client as any).reconnecting = false;

        // Clear any pending timers
        if ((client as any).reconnectTimer) {
          clearTimeout((client as any).reconnectTimer);
          (client as any).reconnectTimer = null;
          console.log(`   Cleared reconnect timer for tab ${tabId}`);
        }

        if ((client as any).connectTimer) {
          clearTimeout((client as any).connectTimer);
          (client as any).connectTimer = null;
          console.log(`   Cleared connect timer for tab ${tabId}`);
        }

        // Remove all event listeners FIRST to prevent any callbacks during close
        client.removeAllListeners('connect');
        client.removeAllListeners('reconnect');
        client.removeAllListeners('error');
        client.removeAllListeners('message');
        client.removeAllListeners('close');
        client.removeAllListeners('offline');
        console.log(`   Removed all event listeners for tab ${tabId}`);

        // Force close connection and wait for it to complete
        try {
          client.end(true, () => {
            console.log(`✅ Client for tab ${tabId} fully closed`);

            this.clients.delete(tabId);
            this.connectingInProgress.delete(tabId);
            this.connectionStatus.delete(tabId);
            this.messageCallbacks.delete(tabId);
            this.connectionStatusCallbacks.delete(tabId);
            this.subscriptions.delete(tabId);
            this.configs.delete(tabId);

            console.log(`✅ All state cleared for tab ${tabId}`);
            resolve();
          });
        } catch (error) {
          console.error(`Error during client.end() for tab ${tabId}:`, error);
          // Cleanup anyway
          this.clients.delete(tabId);
          this.connectingInProgress.delete(tabId);
          this.connectionStatus.delete(tabId);
          this.messageCallbacks.delete(tabId);
          this.connectionStatusCallbacks.delete(tabId);
          this.subscriptions.delete(tabId);
          this.configs.delete(tabId);
          resolve();
        }
      } else {
        console.log(`⚠️ No client found for tab ${tabId} to disconnect`);
        resolve();
      }
    });
  }

  subscribe(tabId: number, topic: string, qos: number = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`🔵 subscribe() called for tab ${tabId}, topic: ${topic}`);

      const client = this.clients.get(tabId);
      if (!client) {
        console.error(`❌ subscribe() failed: Client not found for tab ${tabId}`);
        console.error(`   Available clients: ${Array.from(this.clients.keys()).join(', ')}`);
        reject(new Error('Client not found'));
        return;
      }

      const status = this.connectionStatus.get(tabId);
      if (!status?.connected) {
        console.error(`❌ subscribe() failed: Not connected for tab ${tabId}, status:`, status);
        reject(new Error('Not connected'));
        return;
      }

      // Additional check: verify client is actually connected
      if (!client.connected) {
        console.error(`❌ subscribe() failed: Client object reports not connected for tab ${tabId}`);
        reject(new Error('Client not connected'));
        return;
      }

      // Check if already subscribed to avoid duplicate subscriptions
      const subs = this.subscriptions.get(tabId) || [];
      const existingSub = subs.find(s => s.topic === topic);
      if (existingSub) {
        console.log(`⚠️ Already subscribed to topic: ${topic} - skipping`);
        resolve();
        return;
      }

      console.log(`📤 Sending subscribe request to MQTT broker for topic: ${topic}, QoS: ${qos}`);
      client.subscribe(topic, { qos: qos as 0 | 1 | 2 }, (error) => {
        if (error) {
          console.error(`❌ Subscription error for ${topic}:`, error);
          reject(error);
        } else {
          console.log(`✅ Successfully subscribed to: ${topic}`);

          // Store subscription for resubscribe on reconnect
          subs.push({ topic, qos });
          this.subscriptions.set(tabId, subs);
          console.log(`💾 Stored subscription in cache, total: ${subs.length}`);

          resolve();
        }
      });
    });
  }

  unsubscribe(tabId: number, topic: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const status = this.connectionStatus.get(tabId);
      if (!status?.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const client = this.clients.get(tabId);
      if (!client) {
        reject(new Error('Client not found'));
        return;
      }

      console.log('Unsubscribing from topic:', topic);
      client.unsubscribe(topic, (error) => {
        if (error) {
          console.error('Unsubscription error:', error);
          reject(error);
        } else {
          console.log('Successfully unsubscribed from:', topic);

          // Remove from stored subscriptions
          const subs = this.subscriptions.get(tabId);
          if (subs) {
            const filtered = subs.filter(s => s.topic !== topic);
            this.subscriptions.set(tabId, filtered);
          }

          resolve();
        }
      });
    });
  }

  publish(tabId: number, topic: string, message: string, qos: number = 0, retain: boolean = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const status = this.connectionStatus.get(tabId);
      if (!status?.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const client = this.clients.get(tabId);
      if (!client) {
        reject(new Error('Client not found'));
        return;
      }

      console.log('Publishing message to topic:', topic, {
        message,
        qos,
        retain
      });

      client.publish(topic, message, { qos: qos as 0 | 1 | 2, retain }, (error) => {
        if (error) {
          console.error('Publish error:', error);
          reject(error);
        } else {
          console.log('Successfully published to:', topic);
          resolve();
        }
      });
    });
  }

  getConnectionStatus(tabId: number): MqttConnectionStatus | undefined {
    return this.connectionStatus.get(tabId);
  }

  isConnected(tabId: number): boolean {
    return this.connectionStatus.get(tabId)?.connected || false;
  }

  /**
   * Schedule a reconnection attempt for a tab
   */
  private scheduleReconnect(tabId: number): void {
    // Check if we have a stored config
    const config = this.configs.get(tabId);
    if (!config) {
      console.log(`⚠️ No config stored for tab ${tabId}, cannot schedule reconnect`);
      return;
    }

    // Check if auto-reconnect is enabled
    if (!config.autoReconnect) {
      console.log(`⚠️ Auto-reconnect disabled for tab ${tabId}, not scheduling reconnect`);
      return;
    }

    // Clear any existing reconnect timer
    this.clearReconnectTimer(tabId);

    // Check reconnect attempts
    const attempts = this.reconnectAttempts.get(tabId) || 0;
    if (attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.log(`❌ Max reconnect attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached for tab ${tabId}`);
      return;
    }

    // Schedule reconnect
    console.log(`⏰ Scheduling reconnect for tab ${tabId}, attempt ${attempts + 1}/${this.MAX_RECONNECT_ATTEMPTS} in ${this.RECONNECT_INTERVAL}ms`);

    const timer = setTimeout(async () => {
      console.log(`🔄 Attempting reconnect for tab ${tabId}...`);
      this.reconnectAttempts.set(tabId, attempts + 1);

      try {
        await this.connect(tabId, config);
        console.log(`✅ Reconnect successful for tab ${tabId}`);
      } catch (error) {
        console.error(`❌ Reconnect failed for tab ${tabId}:`, error);
        // Will schedule another attempt in the 'close' or 'offline' event handler
      }
    }, this.RECONNECT_INTERVAL);

    this.reconnectTimers.set(tabId, timer);
  }

  /**
   * Clear reconnect timer for a tab
   */
  private clearReconnectTimer(tabId: number): void {
    const timer = this.reconnectTimers.get(tabId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(tabId);
      console.log(`   Cleared app-level reconnect timer for tab ${tabId}`);
    }
  }
}
