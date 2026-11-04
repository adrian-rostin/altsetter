import { LocationStrategy, PathLocationStrategy } from '@angular/common';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    // Real paths like /muscle/upper-chest (see UrlState); the server answers them with index.html.
    { provide: LocationStrategy, useClass: PathLocationStrategy },
  ],
};
