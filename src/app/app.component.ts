import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LocalStorageService } from './services/local-storage.service';
import { MqttClientService } from './services/mqtt-client.service';
import { SendTopicListComponent, Topic as SendTopic } from './components/send-topic-list/send-topic-list.component';
import { SubscribeTopicsComponent, Subscription as SubscribeSubscription } from './components/subscribe-topics/subscribe-topics.component';
import { MessageEditorComponent, MessageEditor as EditorMessage } from './components/message-editor/message-editor.component';
import { ConnectionManagerComponent, MqttConfig as ConnectionMqttConfig, ConnectionTab } from './components/connection-manager/connection-manager.component';
import { ToastUtil } from './utils/toast.util';

// Use imported MqttConfig type with alias
type MqttConfig = ConnectionMqttConfig;

interface Tab {
  id: number;
  label: string;
  connected: boolean;
  config?: MqttConfig;
  sendTopics: SendTopic[];
  selectedSendTopicId: number | null;
  subscriptions: SubscribeSubscription[];
  messageEditors: EditorMessage[];
  selectedMessageEditorId: number | null;
  nextTopicId: number;
  nextSubscriptionId: number;
  nextMessageEditorId: number;
}

// Remove duplicate interfaces - using imported types instead

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, FormsModule, SendTopicListComponent, SubscribeTopicsComponent, MessageEditorComponent, ConnectionManagerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'handymqtt-app';
  isElectron: boolean = false;

  @ViewChild(ConnectionManagerComponent) connectionManager?: ConnectionManagerComponent;

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
        // Use NgZone to ensure Angular change detection is triggered immediately
        this.ngZone.run(() => {
          this.handleIncomingMessage(tabId, topic, message);
        });
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
  showMessageEditorNameDialog = false;
  editingMessageEditorId: number | null = null;
  messageEditorNameInput = '';
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

  // Drag state - moved to child components

  // Dialog state
  showSubscriptionDialog = false;
  newSubscriptionTopic = '';

  // Computed getters for current tab data
  get currentTab(): Tab | undefined {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  get sendTopics(): SendTopic[] {
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

  get subscriptions(): SubscribeSubscription[] {
    return this.currentTab?.subscriptions || [];
  }

  get messageEditors(): EditorMessage[] {
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

  get connectionTabs(): ConnectionTab[] {
    return this.tabs.map(tab => ({
      id: tab.id,
      label: tab.label,
      connected: tab.connected,
      config: tab.config
    }));
  }

  // Tab methods
  selectTab(tabId: number): void {
    this.activeTabId = tabId;
  }

  closeTab(tabId: number): void {
    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index > -1) {
      // Disconnect MQTT client if connected
      const tab = this.tabs[index];
      if (tab.connected) {
        this.mqttClientService.disconnect(tab.id);
      }

      this.tabs.splice(index, 1);
      if (this.activeTabId === tabId && this.tabs.length > 0) {
        this.activeTabId = this.tabs[0].id;
      }
      this.debounceSave();
    }
  }

  // Send topics methods - now handled by child component
  onSendTopicSelected(topicId: number): void {
    this.selectedSendTopicId = topicId;
  }

  onSendTopicsUpdated(event: { topics: SendTopic[]; selectedTopicId: number | null; nextTopicId: number }): void {
    if (!this.currentTab) return;
    this.currentTab.sendTopics = event.topics;
    this.currentTab.selectedSendTopicId = event.selectedTopicId;
    this.currentTab.nextTopicId = event.nextTopicId;
    this.debounceSave();
  }

  // Subscription methods - now handled by child component
  onSubscriptionAdded(): void {
    if (!this.currentTab) {
      ToastUtil.info('No Connection', 'Please create a MQTT connection first');
      return;
    }

    this.newSubscriptionTopic = '';
    this.showSubscriptionDialog = true;
  }

  saveSubscription(): void {
    if (!this.newSubscriptionTopic.trim()) {
      ToastUtil.warning('Missing Topic', 'Please enter a topic');
      return;
    }

    // Check if current tab is connected
    const currentTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!currentTab || !currentTab.connected) {
      ToastUtil.warning('Not Connected', 'Please connect to MQTT broker first');
      return;
    }

    const newSub: SubscribeSubscription = {
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
        ToastUtil.error('Subscription Failed', error.message || 'Unknown error');
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

  onSubscriptionMessagesCleared(subId: number): void {
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

  onSubscriptionDeleted(subId: number): void {
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

  onSubscriptionsReordered(subscriptions: SubscribeSubscription[]): void {
    if (!this.currentTab) return;
    this.currentTab.subscriptions = subscriptions;
    this.debounceSave();
  }

  // Message methods
  // Message Editor methods - now handled by child component
  onMessageEditorAdded(): void {
    if (!this.currentTab) {
      ToastUtil.info('No Connection', 'Please create a MQTT connection first');
      return;
    }

    this.editingMessageEditorId = null;
    this.messageEditorNameInput = `Message ${this.currentTab.nextMessageEditorId}`;
    this.showMessageEditorNameDialog = true;
  }

  onMessageEditorSelected(editorId: number): void {
    this.selectedMessageEditorId = editorId;
  }

  onMessageEditorJsonFormatted(editorId: number): void {
    if (!this.currentTab) return;

    const editor = this.currentTab.messageEditors.find(e => e.id === editorId);
    if (!editor) return;

    try {
      const parsed = JSON.parse(editor.message);
      editor.message = JSON.stringify(parsed, null, 2);
      this.debounceSave();
    } catch (error) {
      ToastUtil.error('Invalid JSON', 'Cannot format the message. Please check the JSON syntax.');
    }
  }

  onMessageEditorNameEditRequested(editorId: number): void {
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
      ToastUtil.warning('Missing Name', 'Please enter a name');
      return;
    }

    if (this.editingMessageEditorId === null) {
      // Creating new message editor
      const newEditor: EditorMessage = {
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

  onMessageEditorDeleted(editorId: number): void {
    if (!this.currentTab) return;

    if (this.currentTab.messageEditors.length <= 1) {
      ToastUtil.warning('Cannot Delete', 'At least one message editor is required');
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

  onMessageEditorsReordered(editors: EditorMessage[]): void {
    if (!this.currentTab) return;
    this.currentTab.messageEditors = editors;
    this.debounceSave();
  }

  onMessageSent(): void {
    this.sendMessage();
  }

  // Connection Manager Component Event Handlers
  onTabSelected(tabId: number): void {
    this.selectTab(tabId);
  }

  onTabCloseRequested(event: { tabId: number; tabLabel: string }): void {
    this.showConfirm('Close Connection', `Are you sure you want to close "${event.tabLabel}"?`, () => {
      this.closeTab(event.tabId);
      // Notify the connection manager to update its state
      this.connectionManager?.confirmCloseTab(event.tabId);
    });
  }

  onTabsUpdated(event: { tabs: ConnectionTab[]; activeTabId: number; nextTabId: number }): void {
    // Update local tabs with the connection tab changes
    this.activeTabId = event.activeTabId;
    this.nextTabId = event.nextTabId;
    // Note: tabs array is already updated by reference
    this.debounceSave();
  }

  onConfigSaved(event: { config: MqttConfig; mode: 'create' | 'edit'; editingTabId: number | null }): void {
    if (!event.config.name.trim()) {
      ToastUtil.warning('Missing Client Name', 'Please enter a client name');
      return;
    }

    if (event.mode === 'create') {
      const newTab: Tab = {
        id: this.nextTabId++,
        label: event.config.name,
        connected: false,
        config: { ...event.config },
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
          ToastUtil.error('Connection Failed', error.message || 'Unknown error');
          this.debounceSave();
        });
    } else if (event.mode === 'edit' && event.editingTabId !== null) {
      const tab = this.tabs.find(t => t.id === event.editingTabId);
      if (tab) {
        const wasConnected = tab.connected;
        tab.label = event.config.name;
        tab.config = { ...event.config };

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
            ToastUtil.error('Reconnection Failed', error.message || 'Unknown error');
            this.debounceSave();
          });
      }
    }
  }

  sendMessage(): void {
    if (!this.currentTab) return;

    const selectedEditor = this.currentTab.messageEditors.find(e => e.id === this.currentTab!.selectedMessageEditorId);
    if (!selectedEditor) return;

    const selectedTopic = this.currentTab.sendTopics.find(t => t.id === this.currentTab!.selectedSendTopicId);
    if (!selectedTopic) {
      ToastUtil.warning('No Topic Selected', 'Please select a topic from the left panel');
      return;
    }

    // Check if current tab is connected
    if (!this.currentTab.connected) {
      ToastUtil.warning('Not Connected', 'Please connect to MQTT broker first');
      return;
    }

    // Check if message is empty
    if (!selectedEditor.message || selectedEditor.message.trim() === '') {
      ToastUtil.warning('Empty Message', 'Please enter a message to send');
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
      ToastUtil.success('Message Sent', `Successfully published to ${selectedTopic.name}`);
    }).catch(error => {
      console.error('Failed to send message:', error);
      ToastUtil.error('Send Failed', error.message || 'Unknown error');
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
