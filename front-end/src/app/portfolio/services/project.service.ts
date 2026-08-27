import { Injectable } from '@angular/core';
import { ProjectConfig } from '../model/project-config';

@Injectable({
  providedIn: 'root'
})
export class ProjectService {

    /** Every project, in sidebar display order. */
    readonly projects: ProjectConfig[] = [
        {
            name: 'From Stone to Stone',
            slug: 'from-stone-to-stone',
            text: 'Richard Long is both an artist and a hiker. Whilst walking, he crafts uncomplicated sculptures' +
                  ' in distant locations. These pieces serve as subtle indications of his time spent there.' +
                  ' Knowing that in time the land will take his sculptures back.\n\n' +
                  'This documentary follows a walk from the perspective of Richard Long. We witness the' +
                  ' landscape just as he would, experiencing it from his unique perspective. As he walks' +
                  ' through his cherished local spot, Dartmoor National Park, Richard Long leaves a gentle' +
                  ' reminder of his presence.'
        },
        {
            name: 'Bangers',
            slug: 'short-bangers',
            text: 'Coming Soon'
        },
        {
            name: 'Jimmy and Jill',
            slug: 'jimmy-and-jill',
            text: 'Parkgate is on the Wirral Peninsula of Cheshire, a small village road that looks over North' +
                  ' Wales, separated by the salt marshes of The River Dee. My grandparents Jimmy and Jill' +
                  ' moved here in their early 20s and started their lives together here. When I was a young boy I' +
                  ' used to visit Parkgate and remember the place very fondly. St.Thomas’s being one of these' +
                  ' places, a church my grandparents saved from destruction, renovated and built a community' +
                  ' around.\n\n' +
                  'After ten years, I revisited this memory for the first time. I went back to explore the' +
                  ' community they had touched and the legacy Jimmy and Jill both left behind.'
        },
        {
            name: 'UnDance',
            slug: 'un-dance',
            darkMode: true,
            text: 'In collaboration with ‘Studio Wayne McGregor’ - The modern ballet studio, Undance was' +
                  ' created to encourage (non)dancers to engage in undancing through Interactive projection.'
        },
        {
            name: 'Rio Ferdinand Foundation',
            slug: 'rio-ferdinand-foundation',
            darkMode: true,
            text: '15-5 is an archive to celebrate The Rio Ferdinand Foundation’s 10 year anniversary. The Rio' +
                  ' Ferdinand Foundation was founded in 2011 to help underprivileged kids get a fighting start' +
                  ' towards their future. For the archive we aimed to track their progression of their events to the' +
                  ' present day.'
        },
        {
            name: 'Interface',
            slug: 'interface',
            text: 'A study of the relationship between water and stone'
        },
    ];

    getProject(slug: string): ProjectConfig | undefined {
        return this.projects.find(project => project.slug === slug);
    }
}
