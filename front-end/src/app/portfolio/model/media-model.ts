import { MediaType } from './media-type';

/** One media item as returned by the API, in display order. */
export interface MediaModel {
    url: string;
    type: MediaType;
    /** Project folder the item belongs to; null for section-level media. */
    project: string | null;
}
