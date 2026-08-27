export interface ProjectConfig {
    /** Label shown in the sidebar. */
    name: string;
    /** URL fragment for the project; also the project's folder name in S3. */
    slug: string;
    /** Render the UI in dark mode while this project is selected. */
    darkMode?: boolean;
    /** Copy shown when the project's text frame is displayed. */
    text?: string;
}
