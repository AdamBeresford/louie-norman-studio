import { MediaType } from './media-type';

/** One media item as returned by the API, in display order. */
export interface MediaModel {
    /** Signed link to the object; null for text frames, which have none. */
    url: string | null;
    type: MediaType;
    /** Project folder the item belongs to; null for section-level media. */
    project: string | null;
}
