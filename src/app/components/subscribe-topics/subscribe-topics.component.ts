import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface Subscription {
  id: number;
  topic: string;
  messageCount: number;
  lastMessage: string;
  messages: Array<{ timestamp: Date, payload: string }>;
  subscribed: boolean;
  width?: number;
}

@Component({
  selector: 'app-subscribe-topics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './subscribe-topics.component.html',
  styleUrl: './subscribe-topics.component.scss'
})
export class SubscribeTopicsComponent {
  @Input() subscriptions: Subscription[] = [];
  @Input() isConnected: boolean = false;
  @Input() isDisabled: boolean = false;

  @Output() subscriptionAdded = new EventEmitter<void>();
  @Output() subscriptionDeleted = new EventEmitter<number>();
  @Output() subscriptionEdited = new EventEmitter<number>();
  @Output() subscriptionMessagesCleared = new EventEmitter<number>();
  @Output() subscriptionsReordered = new EventEmitter<Subscription[]>();

  draggedSubscriptionId: number | null = null;

  // Resize properties
  private resizingSubscriptionId: number | null = null;
  private resizeStartX: number = 0;
  private resizeStartWidth: number = 0;

  addSubscription(): void {
    this.subscriptionAdded.emit();
  }

  deleteSubscription(event: Event, subId: number): void {
    event.stopPropagation();
    this.subscriptionDeleted.emit(subId);
  }

  editSubscription(event: Event, subId: number): void {
    event.stopPropagation();
    this.subscriptionEdited.emit(subId);
  }

  clearMessages(event: Event, subId: number): void {
    event.stopPropagation();
    this.subscriptionMessagesCleared.emit(subId);
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

  // Drag and drop methods
  onDragStart(event: DragEvent, subId: number): void {
    this.draggedSubscriptionId = subId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onDragEnd(event: DragEvent): void {
    this.draggedSubscriptionId = null;
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onDrop(event: DragEvent, targetIndex: number): void {
    event.preventDefault();
    if (this.draggedSubscriptionId === null) return;

    const draggedIndex = this.subscriptions.findIndex(s => s.id === this.draggedSubscriptionId);
    if (draggedIndex === -1 || draggedIndex === targetIndex) return;

    const reorderedSubs = [...this.subscriptions];
    const [draggedItem] = reorderedSubs.splice(draggedIndex, 1);
    reorderedSubs.splice(targetIndex, 0, draggedItem);

    this.subscriptionsReordered.emit(reorderedSubs);
  }

  // Resize methods
  startResize(event: MouseEvent, subId: number): void {
    event.preventDefault();
    event.stopPropagation();

    this.resizingSubscriptionId = subId;
    this.resizeStartX = event.clientX;

    const subscription = this.subscriptions.find(s => s.id === subId);
    this.resizeStartWidth = subscription?.width || 320;

    const mouseMoveHandler = (e: MouseEvent) => this.onResize(e);
    const mouseUpHandler = () => this.stopResize(mouseMoveHandler, mouseUpHandler);

    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
  }

  private onResize(event: MouseEvent): void {
    if (this.resizingSubscriptionId === null) return;

    const deltaX = event.clientX - this.resizeStartX;
    const newWidth = Math.max(250, Math.min(800, this.resizeStartWidth + deltaX));

    const subscription = this.subscriptions.find(s => s.id === this.resizingSubscriptionId);
    if (subscription) {
      subscription.width = newWidth;
    }
  }

  private stopResize(mouseMoveHandler: (e: MouseEvent) => void, mouseUpHandler: () => void): void {
    this.resizingSubscriptionId = null;
    document.removeEventListener('mousemove', mouseMoveHandler);
    document.removeEventListener('mouseup', mouseUpHandler);
  }
}
