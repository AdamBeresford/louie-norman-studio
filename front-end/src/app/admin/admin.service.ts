import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type AdminFrameType = 'image' | 'video' | 'text';

/** One manifest frame, with a signed url attached to keyed frames. */
export interface AdminFrame {
    type: AdminFrameType;
    key?: string;
    url?: string;
    /** Copy shown on a text frame; line breaks are preserved as typed. */
    text?: string;
}

export interface AdminProject {
    slug: string;
    name: string;
    darkMode: boolean;
    frames: AdminFrame[];
}

/** One contact line; a url turns it into a link on the site. */
export interface AdminContactItem {
    text: string;
    url?: string;
}

/** The about page: its images, and the two lists shown over them. */
export interface AdminAbout {
    frames: AdminFrame[];
    education: string[];
    skills: string[];
}

/** The manifest as served to the admin UI. */
export interface AdminMedia {
    version: number;
    projects: AdminProject[];
    about: AdminAbout;
    contact: AdminContactItem[];
}

/** A presigned S3 POST the browser uploads a file straight to. */
export interface UploadTarget {
    url: string;
    fields: Record<string, string>;
    key: string;
    type: AdminFrameType;
}

@Injectable({
  providedIn: 'root'
})
export class AdminService {

  private http = inject(HttpClient);
  private adminUrl = environment.baseUrl + 'admin/';

  getSession(): Observable<{ authenticated: boolean }> {
    return this.http.get<{ authenticated: boolean }>(this.adminUrl + 'session');
  }

  login(password: string): Observable<{ authenticated: boolean }> {
    return this.http.post<{ authenticated: boolean }>(this.adminUrl + 'login', { password });
  }

  logout(): Observable<{ authenticated: boolean }> {
    return this.http.post<{ authenticated: boolean }>(this.adminUrl + 'logout', {});
  }

  getMedia(): Observable<AdminMedia> {
    return this.http.get<AdminMedia>(this.adminUrl + 'media');
  }

  saveManifest(media: AdminMedia): Observable<AdminMedia> {
    return this.http.put<AdminMedia>(this.adminUrl + 'manifest', media);
  }

  requestUpload(section: 'portfolio' | 'about', project: string | null, file: File): Observable<UploadTarget> {
    return this.http.post<UploadTarget>(this.adminUrl + 'upload-url', {
      section,
      project,
      filename: file.name,
      contentType: file.type,
    });
  }

  /** Upload the file bytes straight to S3; they never pass through our server. */
  uploadToS3(target: UploadTarget, file: File): Observable<string> {
    const form = new FormData();
    for (const [name, value] of Object.entries(target.fields)) {
      form.append(name, value);
    }
    form.append('file', file);
    return this.http.post(target.url, form, { responseType: 'text' });
  }

  deleteProject(slug: string): Observable<{ deleted: string }> {
    return this.http.delete<{ deleted: string }>(this.adminUrl + 'projects/' + slug);
  }

  deleteMedia(key: string): Observable<{ deleted: string }> {
    return this.http.request<{ deleted: string }>('DELETE', this.adminUrl + 'media', { body: { key } });
  }
}
