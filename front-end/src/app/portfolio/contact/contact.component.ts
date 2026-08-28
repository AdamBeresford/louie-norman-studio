import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { MediaService } from '../services/media.service';
import { ContactItem } from '../model/page-text';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent
  ],
  templateUrl: './contact.component.html',
  styleUrl: './contact.component.scss'
})
export class ContactComponent implements OnInit {

  items: ContactItem[] = [];

  private mediaService = inject(MediaService);

  ngOnInit(): void {
    this.mediaService.getContactItems().subscribe(items => this.items = items);
  }

}
