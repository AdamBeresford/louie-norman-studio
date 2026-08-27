import { CommonModule } from '@angular/common';
import { Component, inject, input, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
  ],
})
export class HeaderComponent implements OnInit {

  darkMode = input<boolean>();
  currentRoute = '';

  private router = inject(Router);
  private route = inject(ActivatedRoute);

  ngOnInit(): void {
    const currentUrl = this.router.url;
    if (currentUrl.includes('#')) {
      this.currentRoute = currentUrl.split('#')[0];
    } else {
      this.currentRoute = currentUrl;
    }
  }

  isActive(route: string): boolean {
    return this.currentRoute === route;
  }

  isDarkMode(): string {
    return this.darkMode() ? 'dark-mode' : '';
  }
}
