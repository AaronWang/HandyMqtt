import { Injectable } from '@angular/core';

export interface Tab {
  id: number;
  label: string;
  connected: boolean;
  config?: {
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
  private isElectron: boolean = false;

  constructor() {
    // Detect if running in Electron - match the detection logic used in other services
    this.isElectron = typeof window !== 'undefined' &&
      ((window as any).electron?.isElectron ||
        (window as any).electron?.fs ||
        typeof (window as any).require !== 'undefined');
    console.log('LocalStorageService - Electron mode:', this.isElectron);
    console.log('window.electron:', (window as any).electron);
    console.log('window.electron.fs:', (window as any).electron?.fs);
  }

  async saveData(data: AppData): Promise<void> {
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

      const jsonString = JSON.stringify(serializedData, null, 2);

      if (this.isElectron && (window as any).electron?.fs) {
        // Save to file system in Electron
        try {
          const result = await (window as any).electron.fs.saveData(jsonString);
          if (!result.success) {
            console.error('Failed to save data to file:', result.error);
            // Fallback to localStorage
            localStorage.setItem(this.STORAGE_KEY, jsonString);
          }
        } catch (error) {
          console.error('Error calling electron.fs.saveData:', error);
          // Fallback to localStorage
          localStorage.setItem(this.STORAGE_KEY, jsonString);
        }
      } else {
        // Save to localStorage in browser
        localStorage.setItem(this.STORAGE_KEY, jsonString);
      }
    } catch (error) {
      console.error('Error saving data:', error);
    }
  }

  async loadData(): Promise<AppData | null> {
    try {
      let data: string | null = null;

      if (this.isElectron && (window as any).electron?.fs) {
        // Load from file system in Electron
        try {
          const result = await (window as any).electron.fs.loadData();
          if (result.success) {
            data = result.data;
          } else {
            console.error('Failed to load data from file:', result.error);
            // Fallback to localStorage
            data = localStorage.getItem(this.STORAGE_KEY);
          }
        } catch (error) {
          console.error('Error calling electron.fs.loadData:', error);
          // Fallback to localStorage
          data = localStorage.getItem(this.STORAGE_KEY);
        }
      } else {
        // Load from localStorage in browser
        data = localStorage.getItem(this.STORAGE_KEY);
      }

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
            path: tab.config.path ?? '',
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
  async saveTabs(tabs: Tab[]): Promise<void> {
    const data = await this.loadData();
    if (data) {
      data.tabs = tabs;
      await this.saveData(data);
    }
  }

  async saveLayoutSettings(leftPanelWidth: number, subscribeAreaHeight: number): Promise<void> {
    const data = await this.loadData();
    if (data) {
      data.leftPanelWidth = leftPanelWidth;
      data.subscribeAreaHeight = subscribeAreaHeight;
      await this.saveData(data);
    }
  }
}
