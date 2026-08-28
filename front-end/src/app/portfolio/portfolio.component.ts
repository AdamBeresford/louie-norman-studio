import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs';
import { HeaderComponent } from './header/header.component';
import { MediaService } from './services/media.service';
import { MediaModel } from './model/media-model';
import { MediaType } from './model/media-type';
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
  projects: ProjectConfig[] = [];

  private router = inject(Router);
  private mediaService = inject(MediaService);
  private destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.setupRouterEvents();
    this.loadMedia();
  }

  changeBackground(): void {
    const frames = this.selectedProject()?.frames;
    if (frames?.length) {
      this.showMedia((this.currentMediaIndex + 1) % frames.length);
    }
  }

  handleProjectClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  private loadMedia(): void {
    this.mediaService.getPortfolioMedia().subscribe(projects => {
      this.projects = projects;
      // A fragment in the url selects a project; otherwise show the first.
      // The navigation usually completes before the media arrives, so the
      // recorded selection is only applied here.
      const slug = this.projects.some(project => project.slug === this.currentProject)
        ? this.currentProject
        : this.projects[0]?.slug;
      if (slug) {
        this.router.navigateByUrl(`#${slug}`);
        this.selectProject(slug);
      }
      this.isLoading = false;
      this.preloadImages();
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

  private selectedProject(): ProjectConfig | undefined {
    return this.projects.find(project => project.slug === this.currentProject);
  }

  private selectProject(slug: string): void {
    this.currentProject = slug;
    if (this.selectedProject()?.frames.length) {
      this.showMedia(0);
    }
  }

  /** Single place where the displayed frame, and everything derived from it, changes. */
  private showMedia(index: number): void {
    const project = this.selectedProject();
    if (!project) {
      return;
    }
    const media = project.frames[index];
    this.currentMediaIndex = index;
    this.currentMedia = media;
    this.backgroundImage = media.type === MediaType.Image ? `url(${media.url})` : '';
    this.currentTextBox = media.type === MediaType.Text ? media.text ?? '' : '';
    this.darkMode = media.type === MediaType.Video || project.darkMode;
  }

  /**
   * Warm the browser cache so cycling through frames is instant: the open
   * project first, then everything else once the browser is idle.
   */
  private preloadImages(): void {
    const imageUrls = (project: ProjectConfig) => project.frames
      .filter(frame => frame.type === MediaType.Image && frame.url)
      .map(frame => frame.url as string);
    const load = (urls: string[]) => urls.forEach(url => { new Image().src = url; });

    const current = this.selectedProject();
    if (current) {
      load(imageUrls(current));
    }
    const remaining = this.projects
      .filter(project => project !== current)
      .flatMap(imageUrls);
    const whenIdle = (window as any).requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 500));
    whenIdle(() => load(remaining));
  }

}
