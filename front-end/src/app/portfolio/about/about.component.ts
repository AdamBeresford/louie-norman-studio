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
    this.mediaService.getAboutImages().subscribe(paths => {
      this.images = paths;
      this.images.forEach(imagePath => {
        const img = new Image();
        img.src = imagePath;
      });
    });
  }

  changeBackground(): void {
    this.currentImageIndex = (this.currentImageIndex + 1) % this.images.length;
  }

  getBackgroundImage(): string {
    return `url(${this.images[this.currentImageIndex]})`;
  }

}
