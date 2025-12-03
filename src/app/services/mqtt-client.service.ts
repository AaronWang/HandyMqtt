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

  connect(tabId: number, config: MqttConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Check if there's already a connected client
        const existingClient = this.clients.get(tabId);
        const existingStatus = this.connectionStatus.get(tabId);

        // Only disconnect if client exists and is connected or connecting
        if (existingClient) {
          console.log(`Disconnecting existing client for tab ${tabId} before reconnecting`);
          this.disconnect(tabId);
        }

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
          reconnectPeriod: config.autoReconnect ? 5000 : 0, // 0 means no auto-reconnect
          protocolVersion: config.mqttVersion === '5.0' ? 5 : 4, // MQTT 3.1.1 = 4, MQTT 5.0 = 5
        };

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
          if (!isResolved) {
            clearTimeout(connectionTimeout);
            isResolved = true;
            console.log(`✅ MQTT connected successfully for tab ${tabId}`);
            this.connectionStatus.set(tabId, { connected: true });
            this.clients.set(tabId, client);

            // Notify connection status change
            const statusCallback = this.connectionStatusCallbacks.get(tabId);
            if (statusCallback) {
              statusCallback(true);
            }

            resolve();
          } else {
            // This is a reconnection
            console.log(`🔄 MQTT reconnected for tab ${tabId}`);
            this.connectionStatus.set(tabId, { connected: true });

            // Notify connection status change
            const statusCallback = this.connectionStatusCallbacks.get(tabId);
            if (statusCallback) {
              statusCallback(true);
            }

            // Resubscribe to all topics
            const subs = this.subscriptions.get(tabId);
            if (subs && subs.length > 0) {
              console.log(`Resubscribing to ${subs.length} topics for tab ${tabId}`);
              subs.forEach(sub => {
                client.subscribe(sub.topic, { qos: sub.qos as 0 | 1 | 2 }, (error: any) => {
                  if (error) {
                    console.error(`❌ Failed to resubscribe to ${sub.topic}:`, error);
                  } else {
                    console.log(`✅ Resubscribed to ${sub.topic}`);
                  }
                });
              });
            }
          }
        });

        // Handle reconnection attempts
        client.on('reconnect', () => {
          console.log(`🔄 MQTT attempting to reconnect for tab ${tabId}...`);
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
          // Only process if client is still managed (not explicitly disconnected)
          if (this.clients.has(tabId)) {
            console.log(`⚠️ MQTT disconnected for tab ${tabId}`);
            this.connectionStatus.set(tabId, { connected: false });

            // Notify connection status change
            const statusCallback = this.connectionStatusCallbacks.get(tabId);
            if (statusCallback) {
              statusCallback(false);
            }
          }
        });

        // Handle offline
        client.on('offline', () => {
          // Only process if client is still managed (not explicitly disconnected)
          if (this.clients.has(tabId)) {
            console.log(`📴 MQTT offline for tab ${tabId}`);
            this.connectionStatus.set(tabId, { connected: false });

            // Notify connection status change
            const statusCallback = this.connectionStatusCallbacks.get(tabId);
            if (statusCallback) {
              statusCallback(false);
            }
          }
        });

      } catch (error) {
        console.error(`Failed to create MQTT client for tab ${tabId}:`, error);
        this.connectionStatus.set(tabId, {
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        reject(error);
      }
    });
  }

  disconnect(tabId: number): void {
    const client = this.clients.get(tabId);
    if (client) {
      console.log('Disconnecting MQTT client for tab:', tabId);

      // Remove all event listeners before closing
      client.removeAllListeners('connect');
      client.removeAllListeners('reconnect');
      client.removeAllListeners('error');
      client.removeAllListeners('message');
      client.removeAllListeners('close');
      client.removeAllListeners('offline');

      client.end(true);
      this.clients.delete(tabId);
      this.connectionStatus.delete(tabId);
      this.messageCallbacks.delete(tabId);
      this.connectionStatusCallbacks.delete(tabId);
      this.subscriptions.delete(tabId);
    }
  }

  subscribe(tabId: number, topic: string, qos: number = 0): Promise<void> {
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

      console.log('Subscribing to topic:', topic, 'with QoS:', qos);
      client.subscribe(topic, { qos: qos as 0 | 1 | 2 }, (error) => {
        if (error) {
          console.error('Subscription error:', error);
          reject(error);
        } else {
          console.log('Successfully subscribed to:', topic);

          // Store subscription for resubscribe on reconnect
          const subs = this.subscriptions.get(tabId) || [];
          if (!subs.find(s => s.topic === topic)) {
            subs.push({ topic, qos });
            this.subscriptions.set(tabId, subs);
          }

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
}
