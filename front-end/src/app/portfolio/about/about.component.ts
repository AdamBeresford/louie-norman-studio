import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { MediaService } from '../services/media.service';
import { ImagePreloader } from '../services/image-preloader';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent
  ],
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss'
})
export class AboutComponent implements OnInit {
  currentImageIndex = 0;
  images: string[] = [];
  backgroundImage = '';

  educationItems: string[] = [];
  skillsItems: string[] = [];

  private mediaService = inject(MediaService);
  private preloader = inject(ImagePreloader);

  ngOnInit(): void {
    this.mediaService.getAboutImages().subscribe(images => {
      this.images = images;
      this.showImage(0);
      this.preloader.preload(images);
    });
    this.mediaService.getAboutText().subscribe(text => {
      this.educationItems = text.education;
      this.skillsItems = text.skills;
    });
  }

  changeBackground(): void {
    if (this.images.length) {
      this.showImage((this.currentImageIndex + 1) % this.images.length);
    }
  }

  private showImage(index: number): void {
    this.currentImageIndex = index;
    this.backgroundImage = `url(${this.images[index]})`;
  }

}
