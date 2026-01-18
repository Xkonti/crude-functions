We need to plan out an overhaul of the code management part. From the point of using the code within handlers there should be no difference. All code still lives in the `code` directory.

What needs to change is how we place content in the `code` directory. The idea is that we can define _directories_ and decide how they will be managed. Here's an example:

```
code/
├── utils/              ← Mounted from git://github.com/user/common-utils
├── time_entry/         ← Mounted from git://github.com/user/time-tracking
├── local_stuff/        ← Local filesystem (editable via API)
├── backend/            ← Local filesystem (editable via API)
└── shared-s3/          ← Mounted from s3://my-bucket/shared/
```

This shows that the user can define a `code source` that is represented by a directory inside `code/`. There could be any number of types of sources of code file: manual (what we current have), git repository, S3 bucket, FTP, etc... But regardless the source type, each would need to define:

- name of the directory to mount to
- how to sync contents (may contain secrets)
- type of source (manual, git, s3, etc)
- how to connect to the source (may contain secrets)

All this means that we also need to store the definitions of those sources in the database. For the sake of this plan let's focus on 2 code sources for now:

- manually managed (needs better name) - what we had so far. A directory where the user can upload/change/delete files manually through the web interface do API. No sync settings required here as the local file system is the source of truth.
- git repo - this should allow specifying the git repository and credentials in case it's a private repo. Sync options need to be present here.

For simplicity of the database table, things like sync settings as well as the source type specific settings (git link, credentials, etc) should be stored as text columns holding json data. Because sync or git data can contain sensitive data, both fields should be encrypted. It's not like those fields will be read often nor queried for inner data.

Now let's figure out the syncing. I can see multiple ways to configure syncing files from the source of truth (git repo, s3 bucket, etc) and they are not mutually exclusive as one can have all of them enabled:

- manual sync - user should be able to initiate sync manually by pressing a button. This option is always present and doesn't require any configuration. Of course this maps to having an API endpoint for triggering the sync as this is what the web ui would hit.
- interval sync - user specifies an interval at which the source files will be synced (1 minute, 5 hours, etc)
- webhook sync - server could provide a webhook. For example github could trigger git sync whenever PR is merged.

Overall this design means that there can be no "loose files" uploaded directly into the `code` directory as it should contain only the directories where each represents a `code source`.

Your task is not to implement the features but to make a plan of research and design. Then plan needs to include:

- this very set of requirements and ideas
- questions that need to be answered by me (user) ahead of time
- what needs to be researched
- what needs to be designed to ensure proper implementation
- writing the finished implementation plan into a file in `.ai` directory
