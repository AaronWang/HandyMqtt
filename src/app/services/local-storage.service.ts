import { Injectable } from '@angular/core';

export interface Tab {
  id: number;
  label: string;
  connected: boolean;
  config?: {
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
    connectTimeout: number;
    autoReconnect: boolean;
    mqttVersion: '3.1.1' | '5.0';
    useCertificateAuth: boolean;
    caFilePath: string;
    clientCertPath: string;
    clientKeyPath: string;
  };
  sendTopics: Topic[];
  selectedSendTopicId: number | null;
  subscriptions: Subscription[];
  messageEditors: MessageEditor[];
  selectedMessageEditorId: number | null;
  nextTopicId: number;
  nextSubscriptionId: number;
  nextMessageEditorId: number;
}export interface Topic {
  id: number;
  name: string;
}

export interface Subscription {
  id: number;
  topic: string;
  messageCount: number;
  lastMessage: string;
  messages: Array<{ timestamp: Date, payload: string }>;
  subscribed: boolean;
}

export interface MessageEditor {
  id: number;
  name: string;
  qos: number;
  retain: boolean;
  message: string;
}

export interface AppData {
  tabs: Tab[];
  activeTabId: number;
  nextTabId: number;
  leftPanelWidth: number;
  subscribeAreaHeight: number;
}

@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {
  private readonly STORAGE_KEY = 'handymqtt_app_data';

  constructor() { }

  saveData(data: AppData): void {
    try {
      // Convert dates to ISO strings for serialization in subscriptions within tabs
      const serializedData = {
        ...data,
        tabs: data.tabs.map(tab => ({
          ...tab,
          subscriptions: tab.subscriptions.map(sub => ({
            ...sub,
            messages: sub.messages.map(msg => ({
              ...msg,
              timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp
            }))
          }))
        }))
      };

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(serializedData));
    } catch (error) {
      console.error('Error saving data to localStorage:', error);
    }
  }

  loadData(): AppData | null {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (!data) {
        return null;
      }

      const parsedData = JSON.parse(data);

      // Convert ISO strings back to Date objects in subscriptions within tabs
      // Also ensure all required properties exist with default values
      if (parsedData.tabs) {
        parsedData.tabs = parsedData.tabs.map((tab: any) => ({
          ...tab,
          config: tab.config ? {
            ...tab.config,
            connectTimeout: tab.config.connectTimeout ?? 30,
            autoReconnect: tab.config.autoReconnect ?? true,
            mqttVersion: tab.config.mqttVersion ?? '3.1.1',
            useCertificateAuth: tab.config.useCertificateAuth ?? false,
            caFilePath: tab.config.caFilePath ?? '',
            clientCertPath: tab.config.clientCertPath ?? '',
            clientKeyPath: tab.config.clientKeyPath ?? ''
          } : undefined,
          sendTopics: tab.sendTopics || [],
          selectedSendTopicId: tab.selectedSendTopicId ?? null,
          subscriptions: tab.subscriptions?.map((sub: any) => ({
            ...sub,
            messages: sub.messages?.map((msg: any) => ({
              ...msg,
              timestamp: new Date(msg.timestamp)
            })) || []
          })) || [],
          messageEditors: tab.messageEditors || [
            {
              id: 1,
              name: 'Message 1',
              qos: 0,
              retain: false,
              message: ''
            }
          ],
          selectedMessageEditorId: tab.selectedMessageEditorId ?? 1,
          nextTopicId: tab.nextTopicId || 1,
          nextSubscriptionId: tab.nextSubscriptionId || 1,
          nextMessageEditorId: tab.nextMessageEditorId || 2
        }));
      }

      return parsedData;
    } catch (error) {
      console.error('Error loading data from localStorage:', error);
      return null;
    }
  }

  clearData(): void {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
      console.error('Error clearing localStorage:', error);
    }
  }

  // Individual save methods for granular updates
  saveTabs(tabs: Tab[]): void {
    const data = this.loadData();
    if (data) {
      data.tabs = tabs;
      this.saveData(data);
    }
  }

  saveLayoutSettings(leftPanelWidth: number, subscribeAreaHeight: number): void {
    const data = this.loadData();
    if (data) {
      data.leftPanelWidth = leftPanelWidth;
      data.subscribeAreaHeight = subscribeAreaHeight;
      this.saveData(data);
    }
  }
}
