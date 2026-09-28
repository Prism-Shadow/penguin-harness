# A media library shared across the project's activities

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

The Activities list has a **Media library** button that opens every file uploaded to any live
activity of the project in one place, as a grid of thumbnails or a table. Authors can download
several files as one zip, and an activity's media picker can take a file uploaded to another
activity, which is copied into this one.

- Filter by media type (images, audio, video) and by product, search by file name, activity
  title or `product / ref`, and sort by name, newest, largest or activity. Choosing a file shows
  it beside the list with its size, type, activity and upload time, and links to its activity.
- **Download (n)** saves one file as itself, or up to 60 files, 200 MiB together, as
  `media-library-selection.zip`. Repeated names inside the zip become `name-2.ext`. Any project
  member may download; copying a file into an activity needs the project owner.
- In an asset's **Choose from media library**, **Other activities** lists the files of the
  asset's type from the project's other activities. Using one copies it into this activity's own
  uploads (same bytes, same stored name), so deleting or archiving the other activity never breaks
  the binding.
- Only uploads are listed: generated media and files in the WAF checkout are not. Archived
  activities and other projects are left out. The listing reports the newest 5000 files and says
  when it stops there.
- New routes under `/api/projects/:projectId/activities`: `GET /media-library`,
  `POST /media-library/bundle` (`{ items: [{ activityId, path }] }`), and
  `POST /:activityId/media-uploads/copy` (`{ fromActivityId, path }`). No stored data changes.
