import { MediaType } from './media-type';

/** One frame of a project, as returned by the API, in display order. */
export interface MediaModel {
    /** Signed link to the object; null for text frames, which have none. */
    url: string | null;
    type: MediaType;
    /** Copy shown on a text frame; null for image and video frames. */
    text: string | null;
    /** Project the frame belongs to; null for section-level media. */
    project: string | null;
}
