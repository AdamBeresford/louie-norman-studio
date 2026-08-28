import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { MediaModel } from '../model/media-model';
import { ProjectConfig } from '../model/project-config';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class MediaService {

  private http = inject(HttpClient);

  /** Projects in sidebar order, each with its frames in display order. */
  getPortfolioMedia(): Observable<ProjectConfig[]> {
    return this.http.get<ProjectConfig[]>(environment.baseUrl + 'portfolio/images');
  }

  getAboutImages(): Observable<string[]> {
    return this.http.get<MediaModel[]>(environment.baseUrl + 'about/images').pipe(
      map(media => media.flatMap(item => item.url ? [item.url] : []))
    );
  }
}
