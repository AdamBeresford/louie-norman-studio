import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { MediaService } from '../services/media.service';

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

  educationItems = [
    'Education',
    'Kingston School of Art',
    'Foundation Diploma (2018-19) - Distinction',
    'Graphic design (BA) (2019-2023) - 1st Class'
  ];

  skillsItems = [
    'Skills',
    'Camera Operator',
    'Adobe InDesign',
    'Adobe Photoshop',
    'Adobe Permier Pro',
    'Adobe After Effects',
    'Adobe Lightroom/Classic',
    'DaVinci Resolve'
  ];

  private mediaService = inject(MediaService);

  ngOnInit(): void {
    this.mediaService.getAboutImages().subscribe(images => {
      this.images = images;
      this.showImage(0);
      // Warm the browser cache so cycling through the images is instant.
      for (const image of images) {
        new Image().src = image;
      }
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
