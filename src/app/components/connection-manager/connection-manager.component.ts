import { Component, Input, Output, EventEmitter, ChangeDetectorRef, NgZone, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToastUtil } from '../../utils/toast.util';

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

export interface ConnectionTab {
  id: number;
  label: string;
  connected: boolean;
  config?: MqttConfig;
}

@Component({
  selector: 'app-connection-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './connection-manager.component.html',
  styleUrl: './connection-manager.component.scss'
})
export class ConnectionManagerComponent {
  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  @Input() tabs: ConnectionTab[] = [];
  @Input() activeTabId: number = 1;
  @Input() isElectron: boolean = false;
  @Input() nextTabId: number = 2;

  @Output() tabSelected = new EventEmitter<number>();
  @Output() tabCloseRequested = new EventEmitter<{ tabId: number; tabLabel: string }>();
  @Output() tabsUpdated = new EventEmitter<{ tabs: ConnectionTab[]; activeTabId: number; nextTabId: number }>();
  @Output() configSaved = new EventEmitter<{ config: MqttConfig; mode: 'create' | 'edit'; editingTabId: number | null }>();

  // Internal state
  showConfigDialog = false;
  configDialogTab: 'general' | 'advanced' = 'general';
  dialogMode: 'create' | 'edit' = 'create';
  editingTabId: number | null = null;
  mqttConfig: MqttConfig = this.getDefaultConfig();

  selectTab(tabId: number): void {
    this.activeTabId = tabId;
    this.tabSelected.emit(tabId);
  }

  closeTab(event: Event, tabId: number): void {
    event.stopPropagation();
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    this.tabCloseRequested.emit({ tabId: tab.id, tabLabel: tab.label });
  }

  confirmCloseTab(tabId: number): void {
    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index > -1) {
      this.tabs.splice(index, 1);
      if (this.activeTabId === tabId && this.tabs.length > 0) {
        this.activeTabId = this.tabs[0].id;
      }
      this.emitTabsUpdate();
    }
  }

  editTab(event: Event, tabId: number): void {
    event.stopPropagation();
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      this.dialogMode = 'edit';
      this.editingTabId = tabId;
      if (tab.config) {
        this.mqttConfig = { ...tab.config };
      } else {
        this.mqttConfig = this.getDefaultConfig();
        this.mqttConfig.name = tab.label;
      }
      this.configDialogTab = 'general';
      this.showConfigDialog = true;
    }
  }

  createNewClient(): void {
    this.dialogMode = 'create';
    this.editingTabId = null;
    this.mqttConfig = this.getDefaultConfig();
    this.mqttConfig.name = `Client ${this.nextTabId}`;
    this.configDialogTab = 'general';
    this.showConfigDialog = true;
  }

  switchConfigTab(tab: 'general' | 'advanced'): void {
    this.configDialogTab = tab;
  }

  saveConfig(): void {
    if (!this.mqttConfig.name.trim()) {
      ToastUtil.warning('Missing Client Name', 'Please enter a client name');
      return;
    }

    this.configSaved.emit({
      config: { ...this.mqttConfig },
      mode: this.dialogMode,
      editingTabId: this.editingTabId
    });

    this.closeConfigDialog();
  }

  closeConfigDialog(): void {
    this.showConfigDialog = false;
    this.editingTabId = null;
  }

  async selectCaFile(): Promise<void> {
    if (this.isElectron && (window as any).electron?.dialog) {
      try {
        const result = await (window as any).electron.dialog.selectFile(
          'Select CA Certificate',
          [{ name: 'Certificates', extensions: ['crt', 'pem', 'cer', 'ca-bundle'] }]
        );

        if (result && result.success && result.filePath) {
          this.ngZone.run(() => {
            this.mqttConfig.caFilePath = result.filePath;
            this.cdr.detectChanges();
          });
        }
      } catch (error) {
        ToastUtil.error('Error', 'Failed to open file dialog: ' + (error as Error).message);
      }
    } else {
      // Fallback for web mode
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.crt,.pem,.cer';
      input.onchange = (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          this.mqttConfig.caFilePath = file.name;
        }
      };
      input.click();
    }
  }

  async selectClientCertFile(): Promise<void> {
    if (this.isElectron && (window as any).electron?.dialog) {
      try {
        const result = await (window as any).electron.dialog.selectFile(
          'Select Client Certificate',
          [{ name: 'Certificates', extensions: ['crt', 'pem', 'cer'] }]
        );

        if (result && result.success && result.filePath) {
          this.ngZone.run(() => {
            this.mqttConfig.clientCertPath = result.filePath;
            this.cdr.detectChanges();
          });
        }
      } catch (error) {
        ToastUtil.error('Error', 'Failed to open file dialog: ' + (error as Error).message);
      }
    } else {
      // Fallback for web mode
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.crt,.pem,.cer';
      input.onchange = (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          this.mqttConfig.clientCertPath = file.name;
        }
      };
      input.click();
    }
  }

  async selectClientKeyFile(): Promise<void> {
    if (this.isElectron && (window as any).electron?.dialog) {
      try {
        const result = await (window as any).electron.dialog.selectFile(
          'Select Client Key',
          [{ name: 'Key Files', extensions: ['key', 'pem'] }]
        );

        if (result && result.success && result.filePath) {
          this.ngZone.run(() => {
            this.mqttConfig.clientKeyPath = result.filePath;
            this.cdr.detectChanges();
          });
        }
      } catch (error) {
        ToastUtil.error('Error', 'Failed to open file dialog: ' + (error as Error).message);
      }
    } else {
      // Fallback for web mode
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.key,.pem';
      input.onchange = (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          this.mqttConfig.clientKeyPath = file.name;
        }
      };
      input.click();
    }
  }

  private getDefaultConfig(): MqttConfig {
    return {
      name: '',
      host: 'localhost',
      port: 1883,
      path: '',
      protocol: 'mqtt',
      clientId: 'mqtt_' + Math.random().toString(16).substring(2, 10),
      username: '',
      password: '',
      keepAlive: 60,
      cleanSession: true,
      useSSL: false,
      connectTimeout: 30,
      autoReconnect: true,
      mqttVersion: '3.1.1',
      useCertificateAuth: false,
      caFilePath: '',
      clientCertPath: '',
      clientKeyPath: ''
    };
  }

  private emitTabsUpdate(): void {
    this.tabsUpdated.emit({
      tabs: this.tabs,
      activeTabId: this.activeTabId,
      nextTabId: this.nextTabId
    });
  }
}
