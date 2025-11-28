import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToastUtil } from '../../utils/toast.util';

export interface Topic {
  id: number;
  name: string;
}

@Component({
  selector: 'app-send-topic-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './send-topic-list.component.html',
  styleUrl: './send-topic-list.component.scss'
})
export class SendTopicListComponent {
  @Input() topics: Topic[] = [];
  @Input() selectedTopicId: number | null = null;
  @Input() isDisabled: boolean = false;
  @Input() nextTopicId: number = 1;

  @Output() topicSelected = new EventEmitter<number>();
  @Output() topicsUpdated = new EventEmitter<{ topics: Topic[]; selectedTopicId: number | null; nextTopicId: number }>();

  // Internal state
  showAddTopicDialog = false;
  newTopicName = '';
  draggedTopicId: number | null = null;

  selectTopic(topicId: number): void {
    this.selectedTopicId = topicId;
    this.topicSelected.emit(topicId);
  }

  addTopic(): void {
    if (this.isDisabled) {
      ToastUtil.info('No Connection', 'Please create a MQTT connection first');
      return;
    }
    this.newTopicName = '';
    this.showAddTopicDialog = true;
  }

  saveNewTopic(): void {
    if (!this.newTopicName.trim()) {
      return;
    }

    const newTopic: Topic = {
      id: this.nextTopicId++,
      name: this.newTopicName.trim()
    };
    this.topics.push(newTopic);
    this.emitTopicsUpdate();
    this.closeAddTopicDialog();
  }

  closeAddTopicDialog(): void {
    this.showAddTopicDialog = false;
    this.newTopicName = '';
  }

  async deleteTopic(event: Event, topicId: number): Promise<void> {
    event.stopPropagation();
    const topic = this.topics.find(t => t.id === topicId);
    if (!topic) return;

    const confirmed = await ToastUtil.confirm(
      'Delete Topic',
      `Are you sure you want to delete topic "${topic.name}"?`,
      'Yes',
      'Cancel'
    );

    if (confirmed) {
      const index = this.topics.findIndex(t => t.id === topicId);
      if (index > -1) {
        this.topics.splice(index, 1);
        if (this.selectedTopicId === topicId) {
          this.selectedTopicId = null;
        }
        this.emitTopicsUpdate();
      }
    }
  }

  copyTopicToClipboard(topicName: string): void {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(topicName)
        .then(() => {
          ToastUtil.success('Copied!', `Topic "${topicName}" copied to clipboard`);
        })
        .catch(err => {
          console.error('Failed to copy to clipboard:', err);
          ToastUtil.error('Copy Failed', 'Could not copy to clipboard');
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
        ToastUtil.success('Copied!', `Topic "${topicName}" copied to clipboard`);
      } catch (err) {
        console.error('Failed to copy to clipboard:', err);
        ToastUtil.error('Copy Failed', 'Could not copy to clipboard');
      }
      document.body.removeChild(textArea);
    }
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

    const dragIndex = this.topics.findIndex(t => t.id === this.draggedTopicId);
    if (dragIndex === -1 || dragIndex === dropIndex) return;

    const reorderedTopics = [...this.topics];
    const draggedTopic = reorderedTopics[dragIndex];
    reorderedTopics.splice(dragIndex, 1);
    reorderedTopics.splice(dropIndex, 0, draggedTopic);

    this.topics = reorderedTopics;
    this.emitTopicsUpdate();
  }

  private emitTopicsUpdate(): void {
    this.topicsUpdated.emit({
      topics: this.topics,
      selectedTopicId: this.selectedTopicId,
      nextTopicId: this.nextTopicId
    });
  }
}
