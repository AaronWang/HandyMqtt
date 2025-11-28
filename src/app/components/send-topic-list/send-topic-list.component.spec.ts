import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SendTopicListComponent } from './send-topic-list.component';

describe('SendTopicListComponent', () => {
  let component: SendTopicListComponent;
  let fixture: ComponentFixture<SendTopicListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SendTopicListComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(SendTopicListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
