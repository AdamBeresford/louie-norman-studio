import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs';
import { HeaderComponent } from './header/header.component';
import { MediaService } from './services/media.service';
import { MediaModel } from './model/media-model';
import { MediaType } from './model/media-type';
import { ProjectService } from './services/project.service';
import { ProjectConfig } from './model/project-config';

@Component({
  selector: 'app-portfolio',
  templateUrl: './portfolio.component.html',
  styleUrls: ['./portfolio.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    HeaderComponent
  ],
  providers: [
    MediaService
  ]
})
export class PortfolioComponent implements OnInit {

  protected readonly MediaType = MediaType;

  isLoading = true;
  darkMode = false;
  backgroundImage = '';
  currentTextBox = '';

  currentMediaIndex = 0;
  currentMedia!: MediaModel;
  currentProject = '';
  projects: { [slug: string]: MediaModel[] } = {};

  projectLinks: ProjectConfig[] = [];

  private router = inject(Router);
  private mediaService = inject(MediaService);
  private projectService = inject(ProjectService);
  private destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.projectLinks = this.projectService.projects;
    this.router.navigateByUrl(`#${this.projectLinks[0].slug}`);
    this.setupRouterEvents();
    this.loadMedia();
  }

  changeBackground(): void {
    const media = this.projects[this.currentProject];
    this.showMedia((this.currentMediaIndex + 1) % media.length);
  }

  handleProjectClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  private loadMedia(): void {
    this.mediaService.getPortfolioMedia().subscribe(media => {
      this.projects = this.groupMediaByProject(media);
      // The initial fragment navigation usually completes before the media
      // arrives, so re-apply the recorded selection now that it can be shown.
      this.selectProject(this.projects[this.currentProject] ? this.currentProject : this.projectLinks[0].slug);
      this.isLoading = false;
    });
  }

  private setupRouterEvents(): void {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(event => {
        const fragment = event.url.split('#')[1];
        if (fragment) {
          this.selectProject(fragment);
        }
      });
  }

  private selectProject(slug: string): void {
    this.currentProject = slug;
    if (this.projects[slug]) {
      this.showMedia(0);
    }
  }

  /** Single place where the displayed frame, and everything derived from it, changes. */
  private showMedia(index: number): void {
    const media = this.projects[this.currentProject][index];
    const project = this.projectService.getProject(this.currentProject);
    this.currentMediaIndex = index;
    this.currentMedia = media;
    this.backgroundImage = media.type === MediaType.Image ? `url(${media.url})` : '';
    this.currentTextBox = media.type === MediaType.Text ? project?.text ?? '' : '';
    this.darkMode = media.type === MediaType.Video || (project?.darkMode ?? false);
  }

  private groupMediaByProject(mediaArray: MediaModel[]): { [slug: string]: MediaModel[] } {
    const groupedByProject: { [slug: string]: MediaModel[] } = {};
    for (const media of mediaArray) {
      if (media.project) {
        (groupedByProject[media.project] ??= []).push(media);
      }
    }
    return groupedByProject;
  }

}
