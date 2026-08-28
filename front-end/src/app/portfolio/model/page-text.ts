/** The two lists shown over the about images; the first line of each is its heading. */
export interface AboutText {
    education: string[];
    skills: string[];
}

/** One contact line; a url turns it into a link. */
export interface ContactItem {
    text: string;
    url?: string;
}
