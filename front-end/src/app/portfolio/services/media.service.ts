import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { MediaModel } from '../model/media-model';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class MediaService {

  private http = inject(HttpClient);

  getPortfolioMedia(): Observable<MediaModel[]> {
    return this.http.get<MediaModel[]>(environment.baseUrl + 'portfolio/images');
  }

  getAboutImages(): Observable<string[]> {
    return this.http.get<MediaModel[]>(environment.baseUrl + 'about/images').pipe(
      map(media => media.flatMap(item => item.url ? [item.url] : []))
    );
  }
}
