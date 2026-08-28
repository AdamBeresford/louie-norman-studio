import { Routes } from '@angular/router';
import { PortfolioComponent } from './portfolio/portfolio.component';
import { AboutComponent } from './portfolio/about/about.component';
import { ContactComponent } from './portfolio/contact/contact.component';

export const routes: Routes = [
    { path: '', redirectTo: 'louieNormanStudio', pathMatch: 'full' },
    { path: 'louieNormanStudio', component: PortfolioComponent },
    { path: 'about', component: AboutComponent },
    { path: 'contact', component: ContactComponent },
    { path: 'admin', loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent) }];
