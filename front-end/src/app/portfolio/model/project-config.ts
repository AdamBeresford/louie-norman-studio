import { MediaModel } from './media-model';

/** A project and its frames, as returned by the API in sidebar order. */
export interface ProjectConfig {
    slug: string;
    name: string;
    darkMode: boolean;
    frames: MediaModel[];
}
