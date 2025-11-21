import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LocalStorageService } from './services/local-storage.service';
import { MqttClientService } from './services/mqtt-client.service';
import Swal from 'sweetalert2';

interface MqttConfig {
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

interface Tab {
  id: number;
  label: string;
  connected: boolean;
  config?: MqttConfig;
  sendTopics: Topic[];
  selectedSendTopicId: number | null;
  subscriptions: Subscription[];
  messageEditors: MessageEditor[];
  selectedMessageEditorId: number | null;
  nextTopicId: number;
  nextSubscriptionId: number;
  nextMessageEditorId: number;
}

interface Topic {
  id: number;
  name: string;
}

interface Subscription {
  id: number;
  topic: string;
  messageCount: number;
  lastMessage: string;
  messages: Array<{ timestamp: Date, payload: string }>;
  subscribed: boolean;
}

interface MessageEditor {
  id: number;
  name: string;
  qos: number;
  retain: boolean;
  message: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'handymqtt-app';
  isElectron: boolean = false;

  private saveTimeout: any;

  constructor(
    private localStorageService: LocalStorageService,
    private mqttClientService: MqttClientService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {
    // Detect if running in Electron
    this.isElectron = !!(window &&
      ((window as any).electron?.isElectron ||
        (window as any).electron?.fs ||
        typeof (window as any).require !== 'undefined'));
    console.log('=== Electron Detection ===');
    console.log('isElectron:', this.isElectron);
    console.log('window.electron:', (window as any).electron);
    console.log('window.electron.isElectron:', (window as any).electron?.isElectron);
    console.log('window.electron.fs:', (window as any).electron?.fs);
    console.log('window.electron.dialog:', (window as any).electron?.dialog);
    console.log('window.require:', typeof (window as any).require);
  }

  ngOnInit(): void {
    this.loadDataFromStorage();
  }

  ngOnDestroy(): void {
    this.saveDataToStorage();
    // Disconnect all MQTT clients
    this.tabs.forEach(tab => {
      if (tab.connected) {
        this.mqttClientService.disconnect(tab.id);
      }
    });
  }

  // Toast notification helper
  private showToast(icon: 'success' | 'error' | 'warning' | 'info', title: string, text?: string): void {
    const Toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
      didOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer);
        toast.addEventListener('mouseleave', Swal.resumeTimer);
      }
    });

    Toast.fire({
      icon,
      title,
      text
    });
  }

  private async loadDataFromStorage(): Promise<void> {
    const savedData = await this.localStorageService.loadData();
    if (savedData) {
      this.tabs = savedData.tabs;
      this.activeTabId = savedData.activeTabId;
      this.nextTabId = savedData.nextTabId;
      this.leftPanelWidth = savedData.leftPanelWidth;
      this.subscribeAreaHeight = savedData.subscribeAreaHeight;

      // Reconnect to MQTT brokers that were connected before
      this.reconnectSavedConnections();
    }
  }

  private async reconnectSavedConnections(): Promise<void> {
    for (const tab of this.tabs) {
      if (tab.connected && tab.config) {
        try {
          await this.connectToMqtt(tab.id, tab.config);
          console.log(`Reconnected to ${tab.label}`);
        } catch (error) {
          console.error(`Failed to reconnect to ${tab.label}:`, error);
          tab.connected = false;
        }
      }
    }
  }

  private async connectToMqtt(tabId: number, config: MqttConfig): Promise<void> {
    try {
      await this.mqttClientService.connect(tabId, config);

      // Set up message callback for this connection
      this.mqttClientService.setMessageCallback(tabId, (topic: string, message: string) => {
        this.handleIncomingMessage(tabId, topic, message);
      });

      // Set up connection status callback
      this.mqttClientService.setConnectionStatusCallback(tabId, (connected: boolean) => {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab) {
          tab.connected = connected;

          // Resubscribe to all topics when reconnected
          if (connected) {
            this.resubscribeAllTopics(tabId);
          }

          this.debounceSave();
        }
      });

      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.connected = true;

        // Subscribe to all existing subscriptions
        await this.resubscribeAllTopics(tabId);
      }
    } catch (error) {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.connected = false;
      }
      throw error;
    }
  }

  private async resubscribeAllTopics(tabId: number): Promise<void> {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || !tab.connected) {
      return;
    }

    console.log(`Resubscribing to all topics for tab ${tabId}...`);

    for (const subscription of tab.subscriptions) {
      try {
        await this.mqttClientService.subscribe(tabId, subscription.topic, 0);
        subscription.subscribed = true;
        console.log(`Resubscribed to: ${subscription.topic}`);
      } catch (error) {
        console.error(`Failed to resubscribe to ${subscription.topic}:`, error);
        subscription.subscribed = false;
      }
    }

    this.debounceSave();
  }

  private handleIncomingMessage(tabId: number, topic: string, message: string): void {
    console.log(`Received message for tab ${tabId} on topic:`, topic, 'message:', message);

    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) {
      console.warn(`Tab ${tabId} not found for incoming message`);
      return;
    }

    // Find matching subscriptions (support wildcards)
    const matchingSubs = tab.subscriptions.filter(sub => this.topicMatches(sub.topic, topic));

    if (matchingSubs.length === 0) {
      console.log(`No matching subscriptions found for topic: ${topic}`);
    }

    matchingSubs.forEach(sub => {
      const newMessage = {
        timestamp: new Date(),
        payload: message
      };
      sub.messages.push(newMessage);
      sub.messageCount = sub.messages.length;
      sub.lastMessage = message.substring(0, 50); // Preview first 50 chars
      console.log(`Message added to subscription: ${sub.topic}`);
    });

    // Save updated subscriptions
    this.debounceSave();
  }

  private topicMatches(pattern: string, topic: string): boolean {
    // Convert MQTT wildcards to regex
    // + matches a single level
    // # matches multiple levels
    const regexPattern = pattern
      .replace(/\+/g, '[^/]+')
      .replace(/#/g, '.*')
      .replace(/\//g, '\\/');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(topic);
  }

  private async saveDataToStorage(): Promise<void> {
    const data = {
      tabs: this.tabs,
      activeTabId: this.activeTabId,
      nextTabId: this.nextTabId,
      leftPanelWidth: this.leftPanelWidth,
      subscribeAreaHeight: this.subscribeAreaHeight
    };
    await this.localStorageService.saveData(data);
  }

  private debounceSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveDataToStorage();
    }, 500);
  }

  // Public method to call from template
  onDataChange(): void {
    this.debounceSave();
  }

  // Dialog
  showConfigDialog = false;
  configDialogTab: 'general' | 'advanced' = 'general';
  dialogMode: 'create' | 'edit' = 'create';
  editingTabId: number | null = null;
  mqttConfig: MqttConfig = this.getDefaultConfig();
  showMessageEditorNameDialog = false;
  editingMessageEditorId: number | null = null;
  messageEditorNameInput = '';
  showAddTopicDialog = false;
  newTopicName = '';
  showConfirmDialog = false;
  confirmDialogTitle = '';
  confirmDialogMessage = '';
  confirmDialogCallback: (() => void) | null = null;

  // Tabs
  tabs: Tab[] = [
    {
      id: 1,
      label: 'Client 1',
      connected: false,
      sendTopics: [
        { id: 1, name: 'home/temperature' },
        { id: 2, name: 'home/humidity' },
        { id: 3, name: 'sensor/data' }
      ],
      selectedSendTopicId: null,
      subscriptions: [
        {
          id: 1, topic: 'home/#', messageCount: 5, lastMessage: 'Temperature: 22°C', messages: [
            { timestamp: new Date(), payload: '{"temperature": 22, "unit": "celsius"}' }
          ],
          subscribed: true
        },
        {
          id: 2, topic: 'sensor/+/status', messageCount: 2, lastMessage: 'Status: Online', messages: [
            { timestamp: new Date(), payload: 'Status: Online' }
          ],
          subscribed: false
        }
      ],
      messageEditors: [
        {
          id: 1,
          name: 'Message 1',
          qos: 0,
          retain: false,
          message: ''
        }
      ],
      selectedMessageEditorId: 1,
      nextTopicId: 4,
      nextSubscriptionId: 3,
      nextMessageEditorId: 2
    }
  ];
  activeTabId = 1;
  nextTabId = 2;

  // Layout
  leftPanelWidth = 20; // percentage
  subscribeAreaHeight = 60; // percentage

  // Drag state
  draggedTopicId: number | null = null;
  draggedSubscriptionId: number | null = null;
  draggedMessageEditorId: number | null = null;

  // Dialog state
  showSubscriptionDialog = false;
  newSubscriptionTopic = '';

  // Computed getters for current tab data
  get currentTab(): Tab | undefined {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  get sendTopics(): Topic[] {
    return this.currentTab?.sendTopics || [];
  }

  get selectedSendTopicId(): number | null {
    return this.currentTab?.selectedSendTopicId || null;
  }

  set selectedSendTopicId(value: number | null) {
    if (this.currentTab) {
      this.currentTab.selectedSendTopicId = value;
    }
  }

  get subscriptions(): Subscription[] {
    return this.currentTab?.subscriptions || [];
  }

  get messageEditors(): MessageEditor[] {
    return this.currentTab?.messageEditors || [];
  }

  get selectedMessageEditorId(): number | null {
    return this.currentTab?.selectedMessageEditorId || null;
  }

  set selectedMessageEditorId(value: number | null) {
    if (this.currentTab) {
      this.currentTab.selectedMessageEditorId = value;
    }
  }

  // Tab methods
  getDefaultConfig(): MqttConfig {
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
  selectTab(tabId: number): void {
    this.activeTabId = tabId;
  }

  closeTab(event: Event, tabId: number): void {
    event.stopPropagation();
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    this.showConfirm('Close Connection', `Are you sure you want to close "${tab.label}"?`, () => {
      const index = this.tabs.findIndex(t => t.id === tabId);
      if (index > -1) {
        this.tabs.splice(index, 1);
        if (this.activeTabId === tabId && this.tabs.length > 0) {
          this.activeTabId = this.tabs[0].id;
        }
      }
      this.debounceSave();
    });
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

  saveConfig(): void {
    if (!this.mqttConfig.name.trim()) {
      this.showToast('warning', 'Missing Client Name', 'Please enter a client name');
      return;
    }

    if (this.dialogMode === 'create') {
      const newTab: Tab = {
        id: this.nextTabId++,
        label: this.mqttConfig.name,
        connected: false,
        config: { ...this.mqttConfig },
        sendTopics: [],
        selectedSendTopicId: null,
        subscriptions: [],
        messageEditors: [
          {
            id: 1,
            name: 'Message 1',
            qos: 0,
            retain: false,
            message: ''
          }
        ],
        selectedMessageEditorId: 1,
        nextTopicId: 1,
        nextSubscriptionId: 1,
        nextMessageEditorId: 2
      };
      this.tabs.push(newTab);
      this.activeTabId = newTab.id;

      // Connect to MQTT broker immediately
      this.connectToMqtt(newTab.id, newTab.config!)
        .then(() => {
          console.log(`Connected to ${newTab.label}`);
          this.debounceSave();
        })
        .catch(error => {
          console.error(`Failed to connect to ${newTab.label}:`, error);
          this.showToast('error', 'Connection Failed', error.message || 'Unknown error');
          this.debounceSave();
        });
    } else if (this.dialogMode === 'edit' && this.editingTabId !== null) {
      const tab = this.tabs.find(t => t.id === this.editingTabId);
      if (tab) {
        const wasConnected = tab.connected;
        tab.label = this.mqttConfig.name;
        tab.config = { ...this.mqttConfig };

        // If was connected, disconnect and reconnect with new config
        if (wasConnected) {
          this.mqttClientService.disconnect(tab.id);
          tab.connected = false;
        } else {
          this.debounceSave();
        }
        this.connectToMqtt(tab.id, tab.config)
          .then(() => {
            console.log(`Reconnected to ${tab.label} with new config`);
            this.debounceSave();
          })
          .catch(error => {
            console.error(`Failed to reconnect to ${tab.label}:`, error);
            this.showToast('error', 'Reconnection Failed', error.message || 'Unknown error');
            this.debounceSave();
          });
      }
    }

    this.closeConfigDialog();
  }

  closeConfigDialog(): void {
    this.showConfigDialog = false;
    this.editingTabId = null;
  }

  // File selection methods for certificate paths
  async selectCaFile(): Promise<void> {
    console.log('=== selectCaFile called ===');
    console.log('isElectron:', this.isElectron);
    console.log('window.electron:', (window as any).electron);
    console.log('window.electron.dialog:', (window as any).electron?.dialog);

    if (this.isElectron && (window as any).electron?.dialog) {
      try {
        console.log('Using Electron dialog...');
        const result = await (window as any).electron.dialog.selectFile(
          'Select CA Certificate',
          [{ name: 'Certificates', extensions: ['crt', 'pem', 'cer', 'ca-bundle'] }]
        );
        console.log('Dialog result:', JSON.stringify(result));

        if (result && result.success && result.filePath) {
          this.ngZone.run(() => {
            this.mqttConfig.caFilePath = result.filePath;
            console.log('✅ CA file path set to:', result.filePath);
            this.cdr.detectChanges();
          });
        } else if (result && result.canceled) {
          console.log('User canceled file selection');
        } else {
          console.error('❌ Unexpected result:', result);
        }
      } catch (error) {
        console.error('❌ Error in Electron dialog:', error);
        this.showToast('error', 'Error', 'Failed to open file dialog: ' + (error as Error).message);
      }
    } else {
      console.log('⚠️ Using fallback HTML input (not Electron mode or dialog not available)');
      // Fallback for web mode
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.crt,.pem,.cer';
      input.onchange = (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          this.mqttConfig.caFilePath = file.name;
          console.log('File selected (web mode):', file.name);
        }
      };
      input.click();
    }
  }

  async selectClientCertFile(): Promise<void> {
    console.log('=== selectClientCertFile called ===');
    if (this.isElectron && (window as any).electron?.dialog) {
      try {
        console.log('Using Electron dialog...');
        const result = await (window as any).electron.dialog.selectFile(
          'Select Client Certificate',
          [{ name: 'Certificates', extensions: ['crt', 'pem', 'cer'] }]
        );
        console.log('Dialog result:', JSON.stringify(result));

        if (result && result.success && result.filePath) {
          this.ngZone.run(() => {
            this.mqttConfig.clientCertPath = result.filePath;
            console.log('✅ Client cert path set to:', result.filePath);
            this.cdr.detectChanges();
          });
        } else if (result && result.canceled) {
          console.log('User canceled file selection');
        }
      } catch (error) {
        console.error('❌ Error in Electron dialog:', error);
        this.showToast('error', 'Error', 'Failed to open file dialog: ' + (error as Error).message);
      }
    } else {
      console.log('⚠️ Using fallback HTML input');
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
    console.log('=== selectClientKeyFile called ===');
    if (this.isElectron && (window as any).electron?.dialog) {
      try {
        console.log('Using Electron dialog...');
        const result = await (window as any).electron.dialog.selectFile(
          'Select Client Key',
          [{ name: 'Key Files', extensions: ['key', 'pem'] }]
        );
        console.log('Dialog result:', JSON.stringify(result));

        if (result && result.success && result.filePath) {
          this.ngZone.run(() => {
            this.mqttConfig.clientKeyPath = result.filePath;
            console.log('✅ Client key path set to:', result.filePath);
            this.cdr.detectChanges();
          });
        } else if (result && result.canceled) {
          console.log('User canceled file selection');
        }
      } catch (error) {
        console.error('❌ Error in Electron dialog:', error);
        this.showToast('error', 'Error', 'Failed to open file dialog: ' + (error as Error).message);
      }
    } else {
      console.log('⚠️ Using fallback HTML input');
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

  // Send topics methods
  selectSendTopic(topicId: number): void {
    this.selectedSendTopicId = topicId;
  }

  addSendTopic(): void {
    if (!this.currentTab) {
      this.showToast('info', 'No Connection', 'Please create a MQTT connection first');
      return;
    }

    this.newTopicName = '';
    this.showAddTopicDialog = true;
  }

  saveNewTopic(): void {
    if (!this.currentTab || !this.newTopicName.trim()) {
      return;
    }

    const newTopic: Topic = {
      id: this.currentTab.nextTopicId++,
      name: this.newTopicName.trim()
    };
    this.currentTab.sendTopics.push(newTopic);
    this.debounceSave();
    this.closeAddTopicDialog();
  }

  closeAddTopicDialog(): void {
    this.showAddTopicDialog = false;
    this.newTopicName = '';
  }

  deleteSendTopic(event: Event, topicId: number): void {
    event.stopPropagation();
    if (!this.currentTab) return;

    const topic = this.currentTab.sendTopics.find(t => t.id === topicId);
    if (!topic) return;

    this.showConfirm('Delete Topic', `Are you sure you want to delete topic "${topic.name}"?`, () => {
      if (!this.currentTab) return;
      const index = this.currentTab.sendTopics.findIndex(t => t.id === topicId);
      if (index > -1) {
        this.currentTab.sendTopics.splice(index, 1);
        if (this.currentTab.selectedSendTopicId === topicId) {
          this.currentTab.selectedSendTopicId = null;
        }
        this.debounceSave();
      }
    });
  }

  // Drag and drop methods
  onDragStart(event: DragEvent, topicId: number): void {
    this.draggedTopicId = topicId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/html', '');
    }
  }

  onDragEnd(event: DragEvent): void {
    this.draggedTopicId = null;
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onDrop(event: DragEvent, dropIndex: number): void {
    event.preventDefault();
    if (this.draggedTopicId === null) return;

    const dragIndex = this.sendTopics.findIndex(t => t.id === this.draggedTopicId);
    if (dragIndex === -1 || dragIndex === dropIndex) return;

    const draggedTopic = this.sendTopics[dragIndex];
    this.sendTopics.splice(dragIndex, 1);
    this.sendTopics.splice(dropIndex, 0, draggedTopic);
  }

  // Copy topic to clipboard
  copyTopicToClipboard(topicName: string): void {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(topicName)
        .then(() => {
          this.showToast('success', 'Copied!', `Topic "${topicName}" copied to clipboard`);
        })
        .catch(err => {
          console.error('Failed to copy to clipboard:', err);
          this.showToast('error', 'Copy Failed', 'Could not copy to clipboard');
        });
    } else {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = topicName;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        this.showToast('success', 'Copied!', `Topic "${topicName}" copied to clipboard`);
      } catch (err) {
        console.error('Failed to copy to clipboard:', err);
        this.showToast('error', 'Copy Failed', 'Could not copy to clipboard');
      }
      document.body.removeChild(textArea);
    }
  }

  // Subscription methods
  addSubscription(): void {
    if (!this.currentTab) {
      this.showToast('info', 'No Connection', 'Please create a MQTT connection first');
      return;
    }

    this.newSubscriptionTopic = '';
    this.showSubscriptionDialog = true;
  }

  saveSubscription(): void {
    if (!this.newSubscriptionTopic.trim()) {
      this.showToast('warning', 'Missing Topic', 'Please enter a topic');
      return;
    }

    // Check if current tab is connected
    const currentTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!currentTab || !currentTab.connected) {
      this.showToast('warning', 'Not Connected', 'Please connect to MQTT broker first');
      return;
    }

    const newSub: Subscription = {
      id: currentTab.nextSubscriptionId++,
      topic: this.newSubscriptionTopic.trim(),
      messageCount: 0,
      lastMessage: 'No messages yet',
      messages: [],
      subscribed: false
    };
    currentTab.subscriptions.push(newSub);

    // Subscribe to the topic via MQTT
    this.mqttClientService.subscribe(this.activeTabId, newSub.topic, 0)
      .then(() => {
        console.log('Subscribed to topic:', newSub.topic);
        newSub.subscribed = true;
        this.debounceSave();
      })
      .catch(error => {
        console.error('Failed to subscribe:', error);
        this.showToast('error', 'Subscription Failed', error.message || 'Unknown error');
        // Remove subscription if failed
        const index = currentTab.subscriptions.findIndex(s => s.id === newSub.id);
        if (index > -1) {
          currentTab.subscriptions.splice(index, 1);
        }
      });

    this.closeSubscriptionDialog();
  }

  closeSubscriptionDialog(): void {
    this.showSubscriptionDialog = false;
  }

  clearSubscriptionMessages(event: Event, subId: number): void {
    event.stopPropagation();
    if (!this.currentTab) return;

    const sub = this.currentTab.subscriptions.find(s => s.id === subId);
    if (!sub) return;

    this.showConfirm('Clear Messages', `Are you sure you want to clear all messages from "${sub.topic}"?`, () => {
      if (!this.currentTab) return;
      const sub = this.currentTab.subscriptions.find(s => s.id === subId);
      if (!sub) return;

      sub.messages = [];
      sub.messageCount = 0;
      this.debounceSave();
    });
  }

  deleteSubscription(event: Event, subId: number): void {
    event.stopPropagation();
    if (!this.currentTab) return;

    const sub = this.currentTab.subscriptions.find(s => s.id === subId);
    if (!sub) return;

    this.showConfirm('Unsubscribe', `Are you sure you want to unsubscribe from "${sub.topic}"?`, () => {
      if (!this.currentTab) return;
      const sub = this.currentTab.subscriptions.find(s => s.id === subId);
      if (!sub) return;

      if (this.currentTab.connected) {
        // Unsubscribe from MQTT
        this.mqttClientService.unsubscribe(this.activeTabId, sub.topic)
          .then(() => {
            console.log('Unsubscribed from topic:', sub.topic);
          })
          .catch(error => {
            console.error('Failed to unsubscribe:', error);
          });
      }

      const index = this.currentTab.subscriptions.findIndex(s => s.id === subId);
      if (index > -1) {
        this.currentTab.subscriptions.splice(index, 1);
        this.debounceSave();
      }
    });
  }

  formatMessage(message: string): string {
    try {
      const parsed = JSON.parse(message);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return message;
    }
  }

  isJsonMessage(message: string): boolean {
    try {
      JSON.parse(message);
      return true;
    } catch {
      return false;
    }
  }

  onSubscriptionDragStart(event: DragEvent, subId: number): void {
    this.draggedSubscriptionId = subId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onSubscriptionDragEnd(event: DragEvent): void {
    this.draggedSubscriptionId = null;
  }

  onSubscriptionDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onSubscriptionDrop(event: DragEvent, targetIndex: number): void {
    event.preventDefault();
    if (this.draggedSubscriptionId === null || !this.currentTab) return;

    const draggedIndex = this.currentTab.subscriptions.findIndex(s => s.id === this.draggedSubscriptionId);
    if (draggedIndex === -1 || draggedIndex === targetIndex) return;

    const [draggedItem] = this.currentTab.subscriptions.splice(draggedIndex, 1);
    this.currentTab.subscriptions.splice(targetIndex, 0, draggedItem);
    this.draggedSubscriptionId = null;
    this.debounceSave();
  }

  // Message methods
  // Message Editor methods
  addMessageEditor(): void {
    if (!this.currentTab) {
      this.showToast('info', 'No Connection', 'Please create a MQTT connection first');
      return;
    }

    this.editingMessageEditorId = null;
    this.messageEditorNameInput = `Message ${this.currentTab.nextMessageEditorId}`;
    this.showMessageEditorNameDialog = true;
  } selectMessageEditor(editorId: number): void {
    this.selectedMessageEditorId = editorId;
  }

  formatJsonInEditor(event: Event, editorId: number): void {
    event.stopPropagation();
    if (!this.currentTab) return;

    const editor = this.currentTab.messageEditors.find(e => e.id === editorId);
    if (!editor) return;

    try {
      const parsed = JSON.parse(editor.message);
      editor.message = JSON.stringify(parsed, null, 2);
      this.debounceSave();
    } catch (error) {
      this.showToast('error', 'Invalid JSON', 'Cannot format the message. Please check the JSON syntax.');
    }
  }

  openMessageEditorNameDialog(event: Event, editorId: number): void {
    event.stopPropagation();
    if (!this.currentTab) return;

    const editor = this.currentTab.messageEditors.find(e => e.id === editorId);
    if (editor) {
      this.editingMessageEditorId = editorId;
      this.messageEditorNameInput = editor.name;
      this.showMessageEditorNameDialog = true;
    }
  }

  saveMessageEditorName(): void {
    if (!this.currentTab) return;

    if (!this.messageEditorNameInput.trim()) {
      this.showToast('warning', 'Missing Name', 'Please enter a name');
      return;
    }

    if (this.editingMessageEditorId === null) {
      // Creating new message editor
      const newEditor: MessageEditor = {
        id: this.currentTab.nextMessageEditorId++,
        name: this.messageEditorNameInput.trim(),
        qos: 0,
        retain: false,
        message: ''
      };
      this.currentTab.messageEditors.push(newEditor);
      this.currentTab.selectedMessageEditorId = newEditor.id;
    } else {
      // Editing existing message editor
      const editor = this.currentTab.messageEditors.find(e => e.id === this.editingMessageEditorId);
      if (editor) {
        editor.name = this.messageEditorNameInput.trim();
      }
    }
    this.closeMessageEditorNameDialog();
    this.debounceSave();
  }

  closeMessageEditorNameDialog(): void {
    this.showMessageEditorNameDialog = false;
    this.editingMessageEditorId = null;
    this.messageEditorNameInput = '';
  }

  deleteMessageEditor(event: Event, editorId: number): void {
    event.stopPropagation();
    if (!this.currentTab) return;

    if (this.currentTab.messageEditors.length <= 1) {
      this.showToast('warning', 'Cannot Delete', 'At least one message editor is required');
      return;
    }

    const index = this.currentTab.messageEditors.findIndex(e => e.id === editorId);
    if (index > -1) {
      this.currentTab.messageEditors.splice(index, 1);
      if (this.currentTab.selectedMessageEditorId === editorId) {
        this.currentTab.selectedMessageEditorId = this.currentTab.messageEditors[0]?.id || null;
      }
      this.debounceSave();
    }
  }

  onMessageEditorDragStart(event: DragEvent, editorId: number): void {
    this.draggedMessageEditorId = editorId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onMessageEditorDragEnd(event: DragEvent): void {
    this.draggedMessageEditorId = null;
  }

  onMessageEditorDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onMessageEditorDrop(event: DragEvent, targetIndex: number): void {
    event.preventDefault();
    if (this.draggedMessageEditorId === null || !this.currentTab) return;

    const draggedIndex = this.currentTab.messageEditors.findIndex(e => e.id === this.draggedMessageEditorId);
    if (draggedIndex === -1 || draggedIndex === targetIndex) return;

    const [draggedItem] = this.currentTab.messageEditors.splice(draggedIndex, 1);
    this.currentTab.messageEditors.splice(targetIndex, 0, draggedItem);
    this.draggedMessageEditorId = null;
    this.debounceSave();
  }

  sendMessage(): void {
    if (!this.currentTab) return;

    const selectedEditor = this.currentTab.messageEditors.find(e => e.id === this.currentTab!.selectedMessageEditorId);
    if (!selectedEditor) return;

    const selectedTopic = this.currentTab.sendTopics.find(t => t.id === this.currentTab!.selectedSendTopicId);
    if (!selectedTopic) {
      this.showToast('warning', 'No Topic Selected', 'Please select a topic from the left panel');
      return;
    }

    // Check if current tab is connected
    if (!this.currentTab.connected) {
      this.showToast('warning', 'Not Connected', 'Please connect to MQTT broker first');
      return;
    }

    // Check if message is empty
    if (!selectedEditor.message || selectedEditor.message.trim() === '') {
      this.showToast('warning', 'Empty Message', 'Please enter a message to send');
      return;
    }

    // Publish message via MQTT client service
    this.mqttClientService.publish(
      this.activeTabId,
      selectedTopic.name,
      selectedEditor.message,
      selectedEditor.qos,
      selectedEditor.retain
    ).then(() => {
      console.log('Message sent successfully:', {
        topic: selectedTopic.name,
        qos: selectedEditor.qos,
        retain: selectedEditor.retain,
        message: selectedEditor.message
      });

      // Show success notification
      this.showToast('success', 'Message Sent', `Successfully published to ${selectedTopic.name}`);
    }).catch(error => {
      console.error('Failed to send message:', error);
      this.showToast('error', 'Send Failed', error.message || 'Unknown error');
    });
  }

  // Confirm dialog methods
  showConfirm(title: string, message: string, callback: () => void): void {
    this.confirmDialogTitle = title;
    this.confirmDialogMessage = message;
    this.confirmDialogCallback = callback;
    this.showConfirmDialog = true;
  }

  confirmAction(): void {
    if (this.confirmDialogCallback) {
      this.confirmDialogCallback();
    }
    this.closeConfirmDialog();
  }

  closeConfirmDialog(): void {
    this.showConfirmDialog = false;
    this.confirmDialogTitle = '';
    this.confirmDialogMessage = '';
    this.confirmDialogCallback = null;
  }

  // Resize methods
  private isResizing = false;
  private isVerticalResizing = false;

  startResize(event: MouseEvent): void {
    this.isResizing = true;
    event.preventDefault();

    const contentArea = (event.target as HTMLElement).parentElement;
    if (!contentArea) return;

    const mouseMoveHandler = (e: MouseEvent) => {
      if (this.isResizing && contentArea) {
        const rect = contentArea.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const newWidth = (offsetX / rect.width) * 100;
        this.leftPanelWidth = Math.max(10, Math.min(50, newWidth));
      }
    };

    const mouseUpHandler = () => {
      this.isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', mouseMoveHandler);
      document.removeEventListener('mouseup', mouseUpHandler);
      this.debounceSave();
    };

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
  }

  startVerticalResize(event: MouseEvent): void {
    this.isVerticalResizing = true;
    event.preventDefault();

    const rightPanel = (event.target as HTMLElement).parentElement;
    if (!rightPanel) return;

    const startY = event.clientY;
    const startHeight = this.subscribeAreaHeight;

    const mouseMoveHandler = (e: MouseEvent) => {
      if (this.isVerticalResizing && rightPanel) {
        e.preventDefault();
        const rect = rightPanel.getBoundingClientRect();
        const deltaY = e.clientY - startY;
        const deltaPercent = (deltaY / rect.height) * 100;
        const newHeight = startHeight + deltaPercent;
        this.subscribeAreaHeight = Math.max(20, Math.min(80, newHeight));
      }
    };

    const mouseUpHandler = () => {
      this.isVerticalResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', mouseMoveHandler);
      document.removeEventListener('mouseup', mouseUpHandler);
      this.debounceSave();
    };

    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
  }
}
