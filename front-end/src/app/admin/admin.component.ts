import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AdminFrame, AdminMedia, AdminService } from './admin.service';
import { ProjectService } from '../portfolio/services/project.service';

/**
 * Media management for the site owner: upload, reorder and delete the frames
 * shown on the portfolio and about pages. The server enforces access — this
 * page is only a client for the /api/admin endpoints.
 */
@Component({
  selector: 'app-admin',
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss'],
  standalone: true,
  imports: [
    FormsModule
  ]
})
export class AdminComponent implements OnInit {

  view: 'loading' | 'login' | 'dashboard' = 'loading';
  password = '';
  error = '';
  busy = false;
  media?: AdminMedia;

  private adminService = inject(AdminService);
  private projectService = inject(ProjectService);

  ngOnInit(): void {
    this.adminService.getSession().subscribe({
      next: () => this.loadMedia(),
      error: () => this.view = 'login',
    });
  }

  async login(): Promise<void> {
    this.error = '';
    this.busy = true;
    try {
      await firstValueFrom(this.adminService.login(this.password));
      this.password = '';
      await this.loadMedia();
    } catch (error: any) {
      this.error = error?.error?.error ?? 'Login failed';
    } finally {
      this.busy = false;
    }
  }

  logout(): void {
    this.adminService.logout().subscribe(() => {
      this.media = undefined;
      this.view = 'login';
    });
  }

  projectName(slug: string): string {
    return this.projectService.getProject(slug)?.name ?? slug;
  }

  async move(frames: AdminFrame[], index: number, delta: number): Promise<void> {
    const target = index + delta;
    if (target < 0 || target >= frames.length) {
      return;
    }
    [frames[index], frames[target]] = [frames[target], frames[index]];
    await this.save();
  }

  async remove(frames: AdminFrame[], index: number): Promise<void> {
    const frame = frames[index];
    const label = frame.key ? frame.key.split('/').pop() : 'this text frame';
    if (!confirm(`Delete ${label}? This cannot be undone from here.`)) {
      return;
    }
    this.error = '';
    this.busy = true;
    try {
      frames.splice(index, 1);
      if (frame.key) {
        // The server drops the frame from the manifest and deletes the object.
        await firstValueFrom(this.adminService.deleteMedia(frame.key));
      } else {
        await firstValueFrom(this.adminService.saveManifest(this.media!));
      }
    } catch {
      this.error = 'Delete failed';
      await this.loadMedia();
    } finally {
      this.busy = false;
    }
  }

  async upload(event: Event, section: 'portfolio' | 'about', project: string | null): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.media) {
      return;
    }
    this.error = '';
    this.busy = true;
    try {
      const target = await firstValueFrom(this.adminService.requestUpload(section, project, file));
      await firstValueFrom(this.adminService.uploadToS3(target, file));
      const frames = project
        ? this.media.projects.find(candidate => candidate.slug === project)!.frames
        : this.media.about;
      frames.push({ type: target.type, key: target.key });
      await firstValueFrom(this.adminService.saveManifest(this.media));
      // Reload so the new frame gets its signed url.
      await this.loadMedia();
    } catch {
      this.error = 'Upload failed';
      await this.loadMedia();
    } finally {
      this.busy = false;
      input.value = '';
    }
  }

  private async loadMedia(): Promise<void> {
    this.media = await firstValueFrom(this.adminService.getMedia());
    this.view = 'dashboard';
  }

  private async save(): Promise<void> {
    if (!this.media) {
      return;
    }
    this.error = '';
    this.busy = true;
    try {
      await firstValueFrom(this.adminService.saveManifest(this.media));
    } catch {
      this.error = 'Save failed';
      await this.loadMedia();
    } finally {
      this.busy = false;
    }
  }
}
