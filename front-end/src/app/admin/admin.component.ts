import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AdminContactItem, AdminFrame, AdminMedia, AdminProject, AdminService } from './admin.service';

/**
 * Media management for the site owner: create and order the pages shown in the
 * site's sidebar, and upload, reorder, caption and delete the frames within
 * them. The server enforces access — this page is only a client for the
 * /api/admin endpoints.
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

  newPageName = '';
  newPageFile?: File;

  private adminService = inject(AdminService);

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

  // --- pages ---------------------------------------------------------------

  /** A page is only usable once it has something to show. */
  isEmpty(project: AdminProject): boolean {
    return project.frames.length === 0;
  }

  async moveProject(index: number, delta: number): Promise<void> {
    const projects = this.media?.projects;
    if (!projects) {
      return;
    }
    const target = index + delta;
    if (target < 0 || target >= projects.length) {
      return;
    }
    [projects[index], projects[target]] = [projects[target], projects[index]];
    await this.save();
  }

  async renameProject(project: AdminProject, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || trimmed === project.name) {
      return;
    }
    project.name = trimmed;
    await this.save();
  }

  async setDarkMode(project: AdminProject, darkMode: boolean): Promise<void> {
    project.darkMode = darkMode;
    await this.save();
  }

  async deleteProject(project: AdminProject): Promise<void> {
    if (!confirm(`Delete the page “${project.name}” and all ${project.frames.length} of its slides? This cannot be undone from here.`)) {
      return;
    }
    this.error = '';
    this.busy = true;
    try {
      await firstValueFrom(this.adminService.deleteProject(project.slug));
      await this.loadMedia();
    } catch {
      this.error = 'Could not delete the page';
      await this.loadMedia();
    } finally {
      this.busy = false;
    }
  }

  chooseNewPageFile(event: Event): void {
    this.newPageFile = (event.target as HTMLInputElement).files?.[0];
  }

  /**
   * Create a page from a name and its first file. The file is uploaded under
   * the new slug before the page is saved, so a page never exists empty.
   */
  async addPage(): Promise<void> {
    const name = this.newPageName.trim();
    if (!name || !this.newPageFile || !this.media) {
      return;
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!slug) {
      this.error = 'Please use a name with some letters or numbers';
      return;
    }
    if (this.media.projects.some(project => project.slug === slug)) {
      this.error = 'A page with a very similar name already exists';
      return;
    }

    this.error = '';
    this.busy = true;
    try {
      const file = this.newPageFile;
      const target = await firstValueFrom(this.adminService.requestUpload('portfolio', slug, file));
      await firstValueFrom(this.adminService.uploadToS3(target, file));
      this.media.projects.push({
        slug,
        name,
        darkMode: false,
        frames: [{ type: target.type, key: target.key }],
      });
      await firstValueFrom(this.adminService.saveManifest(this.media));
      this.newPageName = '';
      this.newPageFile = undefined;
      await this.loadMedia();
    } catch {
      this.error = 'Could not create the page';
      await this.loadMedia();
    } finally {
      this.busy = false;
    }
  }

  // --- frames --------------------------------------------------------------

  async move(frames: AdminFrame[], index: number, delta: number): Promise<void> {
    const target = index + delta;
    if (target < 0 || target >= frames.length) {
      return;
    }
    [frames[index], frames[target]] = [frames[target], frames[index]];
    await this.save();
  }

  async addTextFrame(project: AdminProject): Promise<void> {
    project.frames.push({ type: 'text', text: '' });
    await this.save();
  }

  async saveText(frame: AdminFrame, text: string): Promise<void> {
    if (frame.text === text) {
      return;
    }
    frame.text = text;
    await this.save();
  }

  async remove(frames: AdminFrame[], index: number): Promise<void> {
    const frame = frames[index];
    const label = frame.key ? frame.key.split('/').pop() : 'this text slide';
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
        : this.media.about.frames;
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

  // --- about and contact text ----------------------------------------------

  /** The lists are edited as one item per line, which is how they render. */
  linesOf(items: string[]): string {
    return items.join('\n');
  }

  async saveAboutList(list: 'education' | 'skills', value: string): Promise<void> {
    if (!this.media) {
      return;
    }
    const items = value.split('\n').map(line => line.trim()).filter(Boolean);
    this.media.about[list] = items;
    await this.save();
  }

  addContactItem(): void {
    this.media?.contact.push({ text: '' });
  }

  async saveContactItem(item: AdminContactItem, text: string, url: string): Promise<void> {
    const trimmedText = text.trim();
    const trimmedUrl = url.trim();
    if (!trimmedText) {
      this.error = 'A contact line needs some text';
      return;
    }
    if (trimmedUrl && !/^(https?:\/\/|mailto:)/.test(trimmedUrl)) {
      this.error = 'A link must start with https://, http:// or mailto:';
      return;
    }
    item.text = trimmedText;
    if (trimmedUrl) {
      item.url = trimmedUrl;
    } else {
      delete item.url;
    }
    await this.save();
  }

  async removeContactItem(index: number): Promise<void> {
    if (!this.media || !confirm('Remove this contact line?')) {
      return;
    }
    this.media.contact.splice(index, 1);
    await this.save();
  }

  async moveContactItem(index: number, delta: number): Promise<void> {
    const items = this.media?.contact;
    if (!items) {
      return;
    }
    const target = index + delta;
    if (target < 0 || target >= items.length) {
      return;
    }
    [items[index], items[target]] = [items[target], items[index]];
    await this.save();
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
