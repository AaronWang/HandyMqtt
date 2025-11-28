import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface MessageEditor {
  id: number;
  name: string;
  qos: number;
  retain: boolean;
  message: string;
  width?: number;
}

@Component({
  selector: 'app-message-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './message-editor.component.html',
  styleUrl: './message-editor.component.scss'
})
export class MessageEditorComponent {
  @Input() editors: MessageEditor[] = [];
  @Input() selectedEditorId: number | null = null;
  @Input() isDisabled: boolean = false;

  @Output() editorAdded = new EventEmitter<void>();
  @Output() editorSelected = new EventEmitter<number>();
  @Output() editorDeleted = new EventEmitter<number>();
  @Output() editorNameEditRequested = new EventEmitter<number>();
  @Output() editorJsonFormatted = new EventEmitter<number>();
  @Output() editorsReordered = new EventEmitter<MessageEditor[]>();
  @Output() messageSent = new EventEmitter<void>();
  @Output() editorDataChanged = new EventEmitter<void>();

  draggedEditorId: number | null = null;

  // Resize properties
  private resizingEditorId: number | null = null;
  private resizeStartX: number = 0;
  private resizeStartWidth: number = 0;

  addEditor(): void {
    this.editorAdded.emit();
  }

  selectEditor(editorId: number): void {
    this.editorSelected.emit(editorId);
  }

  deleteEditor(event: Event, editorId: number): void {
    event.stopPropagation();
    this.editorDeleted.emit(editorId);
  }

  editEditorName(event: Event, editorId: number): void {
    event.stopPropagation();
    this.editorNameEditRequested.emit(editorId);
  }

  formatJson(event: Event, editorId: number): void {
    event.stopPropagation();
    this.editorJsonFormatted.emit(editorId);
  }

  sendMessage(): void {
    this.messageSent.emit();
  }

  onDataChange(): void {
    this.editorDataChanged.emit();
  }

  // Drag and drop methods
  onDragStart(event: DragEvent, editorId: number): void {
    this.draggedEditorId = editorId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onDragEnd(event: DragEvent): void {
    this.draggedEditorId = null;
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onDrop(event: DragEvent, targetIndex: number): void {
    event.preventDefault();
    if (this.draggedEditorId === null) return;

    const draggedIndex = this.editors.findIndex(e => e.id === this.draggedEditorId);
    if (draggedIndex === -1 || draggedIndex === targetIndex) return;

    const reorderedEditors = [...this.editors];
    const [draggedItem] = reorderedEditors.splice(draggedIndex, 1);
    reorderedEditors.splice(targetIndex, 0, draggedItem);

    this.editorsReordered.emit(reorderedEditors);
  }

  // Resize methods
  startResize(event: MouseEvent, editorId: number): void {
    event.preventDefault();
    event.stopPropagation();

    this.resizingEditorId = editorId;
    this.resizeStartX = event.clientX;

    const editor = this.editors.find(e => e.id === editorId);
    this.resizeStartWidth = editor?.width || 350;

    const mouseMoveHandler = (e: MouseEvent) => this.onResize(e);
    const mouseUpHandler = () => this.stopResize(mouseMoveHandler, mouseUpHandler);

    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
  }

  private onResize(event: MouseEvent): void {
    if (this.resizingEditorId === null) return;

    const deltaX = event.clientX - this.resizeStartX;
    const newWidth = Math.max(250, Math.min(800, this.resizeStartWidth + deltaX));

    const editor = this.editors.find(e => e.id === this.resizingEditorId);
    if (editor) {
      editor.width = newWidth;
      this.editorDataChanged.emit();
    }
  }

  private stopResize(mouseMoveHandler: (e: MouseEvent) => void, mouseUpHandler: () => void): void {
    this.resizingEditorId = null;
    document.removeEventListener('mousemove', mouseMoveHandler);
    document.removeEventListener('mouseup', mouseUpHandler);
  }
}
