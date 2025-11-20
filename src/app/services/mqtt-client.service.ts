import { Injectable } from '@angular/core';

export interface MqttConfig {
  name: string;
  host: string;
  port: number;
  protocol: 'ws' | 'wss' | 'mqtt' | 'mqtts';
  clientId: string;
  username: string;
  password: string;
  keepAlive: number;
  cleanSession: boolean;
  useSSL: boolean;
}

export interface MqttConnectionStatus {
  connected: boolean;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class MqttClientService {
  private clients: Map<number, any> = new Map();
  private connectionStatus: Map<number, MqttConnectionStatus> = new Map();
  private messageCallbacks: Map<number, (topic: string, message: string) => void> = new Map();

  constructor() { }

  setMessageCallback(tabId: number, callback: (topic: string, message: string) => void): void {
    this.messageCallbacks.set(tabId, callback);
  }

  removeMessageCallback(tabId: number): void {
    this.messageCallbacks.delete(tabId);
  }

  connect(tabId: number, config: MqttConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // TODO: Implement actual MQTT connection
        // For now, simulate connection
        console.log('Connecting to MQTT broker:', config);

        // Simulate connection delay
        setTimeout(() => {
          this.connectionStatus.set(tabId, { connected: true });
          resolve();
        }, 1000);
      } catch (error) {
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
      // TODO: Implement actual MQTT disconnection
      console.log('Disconnecting MQTT client for tab:', tabId);
      this.clients.delete(tabId);
      this.connectionStatus.delete(tabId);
      this.messageCallbacks.delete(tabId);
    }
  }

  subscribe(tabId: number, topic: string, qos: number = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      const status = this.connectionStatus.get(tabId);
      if (!status?.connected) {
        reject(new Error('Not connected'));
        return;
      }

      // TODO: Implement actual MQTT subscription
      console.log('Subscribing to topic:', topic, 'with QoS:', qos);
      setTimeout(() => resolve(), 500);
    });
  }

  unsubscribe(tabId: number, topic: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const status = this.connectionStatus.get(tabId);
      if (!status?.connected) {
        reject(new Error('Not connected'));
        return;
      }

      // TODO: Implement actual MQTT unsubscription
      console.log('Unsubscribing from topic:', topic);
      setTimeout(() => resolve(), 500);
    });
  }

  publish(tabId: number, topic: string, message: string, qos: number = 0, retain: boolean = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const status = this.connectionStatus.get(tabId);
      if (!status?.connected) {
        reject(new Error('Not connected'));
        return;
      }

      // TODO: Implement actual MQTT publish
      console.log('Publishing message to topic:', topic, {
        message,
        qos,
        retain
      });

      // Simulate message reception for testing (since we don't have real MQTT yet)
      // In a real implementation, this would be handled by the MQTT broker
      setTimeout(() => {
        const callback = this.messageCallbacks.get(tabId);
        if (callback) {
          // Echo the message back for testing
          callback(topic, message);
        }
        resolve();
      }, 100);
    });
  }

  getConnectionStatus(tabId: number): MqttConnectionStatus | undefined {
    return this.connectionStatus.get(tabId);
  }

  isConnected(tabId: number): boolean {
    return this.connectionStatus.get(tabId)?.connected || false;
  }
}
